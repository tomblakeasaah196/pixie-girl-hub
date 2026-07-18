/**
 * Social Studio — typed client + TanStack hooks.
 *
 * Mirrors `src/modules/social_media/social.routes.js` (mounted /api/v1/social,
 * permission key `social`). Manual-first, proof-of-publish: a creator plans a
 * month as one content plan (submitted for a single CEO approval), posts
 * natively, then proves it here with a link + screenshot.
 *
 * Per-brand resources carry the active brand key in their query key so a brand
 * switch refetches (canon §4.1). The X-Brand-Context header is attached by the
 * api client automatically.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";
import type { Tone } from "@/components/ui/primitives";
import type { MetricSpec } from "@/lib/social-platforms-api";

export function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ════════════════════════════════════════════════════════════
// Types — mirror the backend columns
// ════════════════════════════════════════════════════════════

export type SocialPlatform = "instagram" | "facebook" | "tiktok" | "youtube";

export type PostType =
  | "image"
  | "carousel"
  | "video"
  | "reel"
  | "story"
  | "short";

export type PostStatus =
  | "draft"
  | "assigned"
  | "scheduled"
  | "posted"
  | "flagged"
  | "archived";

export type PlanStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "changes_requested";

export interface SocialAccount {
  account_id: string;
  business: string;
  // Not SocialPlatform: the Accounts registry can carry any key from the
  // (admin-extensible) social platform registry — see social-platforms-api.ts
  // — while SocialPlatform below stays the narrower set Board/Calendar
  // posting still supports.
  platform: string;
  handle: string;
  profile_url: string | null;
  is_active?: boolean;
  connected_at?: string;
  created_at?: string;
  // Apify metrics (migration 000342)
  follower_count: number | null;
  bio: string | null;
  avatar_url: string | null;
  // Values are typed per the platform's metric spec: count/decimal -> number,
  // text -> string, bool -> boolean (see migration 000356).
  metrics: Record<string, number | string | boolean>;
  scrape_enabled: boolean;
  last_scraped_at: string | null;
  last_scrape_status: "ok" | "error" | null;
  last_scrape_error: string | null;
  // Joined from shared.social_platforms (social.repo.js#ACCOUNT_COLUMNS)
  platform_display_name: string;
  platform_brand_color: string;
  platform_icon_glyph: string;
  platform_supports_bio: boolean;
  platform_metrics_schema: MetricSpec[];
}

export interface SocialPost {
  post_id: string;
  business: string;
  account_id: string;
  // Any key from the platform registry — quick-logged posts may belong to a
  // platform an admin added from the UI, not just the canonical four.
  platform: string;
  post_type: PostType;
  caption: string | null;
  hashtags: string[];
  media_urls: string[];
  tagged_product_ids: string[];
  status: PostStatus;
  scheduled_for: string | null;
  published_at: string | null;
  external_post_id: string | null;
  external_url: string | null;
  created_by?: string | null;
  assigned_to: string | null;
  plan_id: string | null;
  proof_screenshot_url: string | null;
  oembed_html: string | null;
  oembed_thumbnail_url: string | null;
  oembed_author_handle: string | null;
  oembed_verified_at: string | null;
  handle_mismatch: boolean;
  creative_rating: number | null;
  creative_rated_by: string | null;
  creative_rated_at: string | null;
  performance_score: string | null;
  performance_computed_at: string | null;
  flag_reason: string | null;
  nudge_count: number;
  last_nudged_at: string | null;
  created_at: string;
  updated_at: string;
  /** Only present on the single-post GET (getPost embeds it); absent on list rows. */
  metrics?: PostMetric[];
}

export interface ContentPlan {
  plan_id: string;
  business: string;
  period_start: string;
  period_end: string;
  status: PlanStatus;
  post_count: number;
  workflow_instance_id: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  posts?: SocialPost[];
}

export interface SocialTarget {
  target_id: string;
  business: string;
  platform: SocialPlatform;
  user_id: string | null;
  period_month: string;
  target_count: number;
  set_by: string;
}

export interface PerformanceRow {
  platform: string;
  posted_count: number;
  pending_count: number;
  flagged_count: number;
  on_time_count: number;
  avg_performance_score: string | null;
  avg_creative_rating: string | null;
  target_count: number | null;
  attainment_pct: number | null;
  on_time_pct: number | null;
}

export interface TeamRow extends PerformanceRow {
  user_id: string;
  display_name: string;
}

export interface PostMetric {
  metric_id: string;
  post_id: string;
  metric_date: string;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  video_views: number;
  link_clicks: number;
}

export interface PostRowInput {
  account_id?: string;
  platform: SocialPlatform;
  post_type: PostType;
  caption?: string;
  hashtags?: string[];
  media_urls?: string[];
  tagged_product_ids?: string[];
  scheduled_for?: string;
  assigned_to?: string;
}

export interface PostCreateInput extends PostRowInput {
  plan_id?: string;
  status?: "draft" | "assigned" | "scheduled";
}

export type PostUpdateInput = Partial<Omit<PostCreateInput, "plan_id" | "status">>;

export interface AccountConnectInput {
  platform: string;
  handle: string;
  profile_url?: string;
}

interface Paginated<T> {
  data: T[];
  meta?: { page?: number; page_size?: number; total?: number; has_more?: boolean };
}

function unwrapList<T>(r: T[] | Paginated<T>): T[] {
  return Array.isArray(r) ? r : (r?.data ?? []);
}

/** Current month as YYYY-MM, the shape every period_month query param wants. */
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// ════════════════════════════════════════════════════════════
// Accounts (handle registry — no OAuth tokens)
// ════════════════════════════════════════════════════════════

export function useSocialAccounts() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["social", "accounts", brand],
    queryFn: () => api.get<SocialAccount[]>("/social/accounts"),
    staleTime: 60_000,
  });
}

export function useConnectAccount() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: AccountConnectInput) =>
      api.post<SocialAccount>("/social/accounts", input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["social", "accounts", brand] }),
  });
}

export interface AssignableStaff {
  user_id: string;
  display_name: string;
}

/** The "assign to" picker's data source — active staff on this brand. */
export function useAssignableStaff() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["social", "staff", brand],
    queryFn: () => api.get<AssignableStaff[]>("/social/staff"),
    staleTime: 5 * 60_000,
  });
}

export function useRevokeAccount() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/social/accounts/${id}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["social", "accounts", brand] }),
  });
}

/** "Sync now" — trigger this one account's Apify scrape immediately instead
 *  of waiting for the twice-daily cron. */
export function useSyncAccount() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<SocialAccount>(`/social/accounts/${id}/sync`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["social", "accounts", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Content plans (the monthly batch, submitted as ONE approval)
// ════════════════════════════════════════════════════════════

export function usePlans(status?: PlanStatus) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["social", "plans", brand, status ?? "all"],
    queryFn: () =>
      api.get<ContentPlan[]>(
        `/social/plans${status ? `?status=${status}` : ""}`,
      ),
    staleTime: 20_000,
  });
}

export function usePlan(id: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && id),
    queryKey: ["social", "plan", brand, id],
    queryFn: () => api.get<ContentPlan>(`/social/plans/${id}`),
  });
}

function invalidatePlan(qc: ReturnType<typeof useQueryClient>, brand: string | null, id?: string) {
  qc.invalidateQueries({ queryKey: ["social", "plans", brand] });
  if (id) qc.invalidateQueries({ queryKey: ["social", "plan", brand, id] });
  qc.invalidateQueries({ queryKey: ["social", "posts", brand] });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: { period_start: string; period_end: string }) =>
      api.post<ContentPlan>("/social/plans", body),
    onSuccess: () => invalidatePlan(qc, brand),
  });
}

export function useAddPostsToPlan() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { planId: string; rows: PostRowInput[] }) =>
      api.post<SocialPost[]>(`/social/plans/${args.planId}/posts`, {
        rows: args.rows,
      }),
    onSuccess: (_d, args) => invalidatePlan(qc, brand, args.planId),
  });
}

export function useSubmitPlan() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ContentPlan>(`/social/plans/${id}/submit`, {}),
    onSuccess: (_d, id) => invalidatePlan(qc, brand, id),
  });
}

export function useApprovePlan() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; notes?: string }) =>
      api.post<ContentPlan>(`/social/plans/${args.id}/approve`, {
        notes: args.notes,
      }),
    onSuccess: (_d, args) => invalidatePlan(qc, brand, args.id),
  });
}

export function useRequestPlanChanges() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; notes?: string }) =>
      api.post<ContentPlan>(`/social/plans/${args.id}/request-changes`, {
        notes: args.notes,
      }),
    onSuccess: (_d, args) => invalidatePlan(qc, brand, args.id),
  });
}

// ════════════════════════════════════════════════════════════
// Posts
// ════════════════════════════════════════════════════════════

export interface PostFilters {
  status?: PostStatus;
  plan_id?: string;
  assigned_to?: string;
  platform?: SocialPlatform;
  from?: string;
  to?: string;
  page_size?: number;
}

export function usePosts(filters: PostFilters = {}) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, String(v));
  if (!filters.page_size) qs.set("page_size", "200");
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["social", "posts", brand, qs.toString()],
    queryFn: async () => {
      const r = await api.get<SocialPost[] | Paginated<SocialPost>>(
        `/social/posts?${qs}`,
      );
      return unwrapList(r);
    },
    staleTime: 20_000,
  });
}

export function usePost(id: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && id),
    queryKey: ["social", "post", brand, id],
    queryFn: () => api.get<SocialPost>(`/social/posts/${id}`),
  });
}

function invalidatePost(qc: ReturnType<typeof useQueryClient>, brand: string | null, id?: string) {
  qc.invalidateQueries({ queryKey: ["social", "posts", brand] });
  if (id) qc.invalidateQueries({ queryKey: ["social", "post", brand, id] });
  qc.invalidateQueries({ queryKey: ["social", "performance", brand] });
  qc.invalidateQueries({ queryKey: ["social", "team", brand] });
}

export function useCreatePost() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: PostCreateInput) =>
      api.post<SocialPost>("/social/posts", body),
    onSuccess: () => invalidatePost(qc, brand),
  });
}

// ── Quick-log (the simplified calendar's one write) ──────────
export interface QuickLogInput {
  external_url: string;
  /** Registry platform key (not just the canonical four). */
  platform?: string;
  account_id?: string;
  /** ISO datetime of the calendar day the post belongs to. */
  published_at?: string;
}

/** Paste a link that was already posted natively -> it lands as a proven
 *  "posted" row on that day, oEmbed-enriched. No content, no screenshot. */
export function useQuickLog() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: QuickLogInput) =>
      api.post<SocialPost>("/social/posts/quick-log", body),
    onSuccess: () => invalidatePost(qc, brand),
  });
}

/** Remove a logged link (undo a wrong paste). */
export function useDeletePost() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/social/posts/${id}`),
    onSuccess: (_d, id) => invalidatePost(qc, brand, id),
  });
}

/** Best-effort on-demand refresh of a post's embed card + reactions. */
export function useRefreshReactions() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<SocialPost>(`/social/posts/${id}/refresh-reactions`, {}),
    onSuccess: (_d, id) => invalidatePost(qc, brand, id),
  });
}

export function useUpdatePost() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; input: PostUpdateInput }) =>
      api.patch<SocialPost>(`/social/posts/${args.id}`, args.input),
    onSuccess: (_d, args) => invalidatePost(qc, brand, args.id),
  });
}

export function useReschedulePost() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; scheduled_for: string }) =>
      api.post<SocialPost>(`/social/posts/${args.id}/reschedule`, {
        scheduled_for: args.scheduled_for,
      }),
    onSuccess: (_d, args) => invalidatePost(qc, brand, args.id),
  });
}

/** Proof of publish: paste the live link + upload a screenshot. */
export function useSubmitProof() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; external_url: string; screenshot: File }) => {
      const form = new FormData();
      form.set("external_url", args.external_url);
      form.set("screenshot", args.screenshot);
      return api.postForm<SocialPost>(`/social/posts/${args.id}/proof`, form);
    },
    onSuccess: (_d, args) => invalidatePost(qc, brand, args.id),
  });
}

export function useRateCreative() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; rating: number }) =>
      api.post<SocialPost>(`/social/posts/${args.id}/rate`, {
        rating: args.rating,
      }),
    onSuccess: (_d, args) => invalidatePost(qc, brand, args.id),
  });
}

export function useRecordMetrics() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: {
      id: string;
      metric_date?: string;
      metrics: Partial<
        Pick<
          PostMetric,
          | "impressions"
          | "reach"
          | "likes"
          | "comments"
          | "shares"
          | "saves"
          | "video_views"
          | "link_clicks"
        >
      >;
    }) =>
      api.post<PostMetric>(`/social/posts/${args.id}/metrics`, {
        metric_date: args.metric_date,
        metrics: args.metrics,
      }),
    onSuccess: (_d, args) => invalidatePost(qc, brand, args.id),
  });
}

export function useSnoozePost() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) => api.post<{ snoozed: boolean }>(`/social/posts/${id}/snooze`, {}),
    onSuccess: (_d, id) => invalidatePost(qc, brand, id),
  });
}

// ════════════════════════════════════════════════════════════
// Targets, Performance, Team
// ════════════════════════════════════════════════════════════

export function useTargets(periodMonth: string) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && periodMonth),
    queryKey: ["social", "targets", brand, periodMonth],
    queryFn: () => api.get<SocialTarget[]>(`/social/targets?period_month=${periodMonth}`),
  });
}

export function useSetTarget() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: {
      platform: SocialPlatform;
      user_id?: string | null;
      period_month: string;
      target_count: number;
    }) => api.post<SocialTarget>("/social/targets", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social", "targets", brand] });
      qc.invalidateQueries({ queryKey: ["social", "performance", brand] });
      qc.invalidateQueries({ queryKey: ["social", "team", brand] });
    },
  });
}

export function usePerformance(periodMonth: string) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && periodMonth),
    queryKey: ["social", "performance", brand, periodMonth],
    queryFn: () =>
      api.get<PerformanceRow[]>(`/social/performance?period_month=${periodMonth}`),
  });
}

export function useTeam(periodMonth: string) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && periodMonth),
    queryKey: ["social", "team", brand, periodMonth],
    queryFn: () => api.get<TeamRow[]>(`/social/team?period_month=${periodMonth}`),
  });
}

export function useCreatorDrilldown(userId: string | undefined, periodMonth: string) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && userId && periodMonth),
    queryKey: ["social", "team", "drilldown", brand, userId, periodMonth],
    queryFn: () =>
      api.get<SocialPost[]>(`/social/team/${userId}?period_month=${periodMonth}`),
  });
}

// ════════════════════════════════════════════════════════════
// Presentation metadata
// ════════════════════════════════════════════════════════════

export const PLATFORM_META: Record<
  SocialPlatform,
  { label: string; charLimit: number }
> = {
  instagram: { label: "Instagram", charLimit: 2200 },
  facebook: { label: "Facebook", charLimit: 63206 },
  tiktok: { label: "TikTok", charLimit: 2200 },
  youtube: { label: "YouTube", charLimit: 5000 },
};

export const ALL_PLATFORMS: SocialPlatform[] = [
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
];

/** Instagram is the brand's non-negotiable channel; the rest follow. This is
 *  the display order for the canonical four — registry extras sort after. */
export const PLATFORM_ORDER: SocialPlatform[] = [
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
];

/** Canonical-four look fallback, used only when the platform registry hasn't
 *  supplied a display name / brand colour / glyph for a platform (the
 *  registry — joined onto every account row — is the source of truth). */
export const PLATFORM_UI: Record<
  SocialPlatform,
  { label: string; glyph: string; color: string }
> = {
  instagram: { label: "Instagram", glyph: "IG", color: "#E1306C" },
  facebook: { label: "Facebook", glyph: "f", color: "#1877F2" },
  tiktok: { label: "TikTok", glyph: "TT", color: "#25F4EE" },
  youtube: { label: "YouTube", glyph: "YT", color: "#FF0000" },
};

const HOST_PLATFORM: [RegExp, SocialPlatform][] = [
  [/(^|\.)instagram\.com$/i, "instagram"],
  [/(^|\.)(facebook\.com|fb\.watch)$/i, "facebook"],
  [/(^|\.)tiktok\.com$/i, "tiktok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/i, "youtube"],
];

/** Which canonical platform a pasted URL belongs to, or null. Mirrors
 *  social-proof.service.js#detectPlatform. Registry-added platforms are
 *  matched by accountForUrl below instead. */
export function detectPlatformFromUrl(url: string): SocialPlatform | null {
  let host: string;
  try {
    host = new URL(url.trim()).hostname;
  } catch {
    return null;
  }
  for (const [re, platform] of HOST_PLATFORM) if (re.test(host)) return platform;
  return null;
}

// ── Registry-driven presentation (accounts are the source of truth) ────

export interface PlatformLook {
  label: string;
  glyph: string;
  color: string;
}

const NEUTRAL_LOOK_COLOR = "#80706b";

/** Per-platform look map built from the registered accounts (each row carries
 *  its registry platform's display name / brand colour / glyph), with the
 *  canonical-four constants as fallback for platforms with no account yet. */
export function buildPlatformLooks(
  accounts: SocialAccount[],
): Map<string, PlatformLook> {
  const m = new Map<string, PlatformLook>(Object.entries(PLATFORM_UI));
  for (const a of accounts) {
    if (a.platform_brand_color || !m.has(a.platform)) {
      m.set(a.platform, {
        label: a.platform_display_name || a.platform,
        color: a.platform_brand_color || NEUTRAL_LOOK_COLOR,
        glyph:
          a.platform_icon_glyph ||
          (a.platform_display_name || a.platform).slice(0, 2).toUpperCase(),
      });
    }
  }
  return m;
}

export function lookFor(
  looks: Map<string, PlatformLook>,
  platform: string,
): PlatformLook {
  return (
    looks.get(platform) ?? {
      label: platform,
      color: NEUTRAL_LOOK_COLOR,
      glyph: platform.slice(0, 2).toUpperCase(),
    }
  );
}

/** Distinct platforms with an active registered handle, canonical four first
 *  (Instagram leading), registry extras after alphabetically. This — not a
 *  hardcoded list — is what the Calendar/Performance surfaces render. */
export function registeredPlatforms(accounts: SocialAccount[]): string[] {
  const active = new Set(
    accounts.filter((a) => a.is_active !== false).map((a) => a.platform),
  );
  const canonical = PLATFORM_ORDER.filter((p) => active.has(p));
  const extras = [...active]
    .filter((p) => !(PLATFORM_ORDER as string[]).includes(p))
    .sort();
  return [...canonical, ...extras];
}

/** Resolve a pasted URL to the registered account it belongs to: canonical
 *  host detection first, then a host match against each account's profile_url
 *  (which is how a registry-added platform like Pinterest resolves). Mirrors
 *  the backend's quickLog resolution so the composer can preview the outcome. */
export function accountForUrl(
  url: string,
  accounts: SocialAccount[],
): SocialAccount | null {
  const active = accounts.filter((a) => a.is_active !== false);
  const canonical = detectPlatformFromUrl(url);
  if (canonical) return active.find((a) => a.platform === canonical) ?? null;
  let host: string;
  try {
    host = new URL(url.trim()).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
  for (const a of active) {
    if (!a.profile_url) continue;
    try {
      const accountHost = new URL(a.profile_url).hostname
        .replace(/^www\./i, "")
        .toLowerCase();
      if (host === accountHost || host.endsWith(`.${accountHost}`)) return a;
    } catch {
      /* malformed stored profile_url — skip */
    }
  }
  return null;
}

export const POST_TYPES: PostType[] = [
  "image",
  "carousel",
  "video",
  "reel",
  "story",
  "short",
];

export const STATUS_TONE: Record<PostStatus, Tone> = {
  draft: "neutral",
  assigned: "info",
  scheduled: "info",
  posted: "success",
  flagged: "danger",
  archived: "neutral",
};

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Draft",
  assigned: "Assigned",
  scheduled: "Scheduled",
  posted: "Posted",
  flagged: "Flagged",
  archived: "Archived",
};

export const PLAN_STATUS_TONE: Record<PlanStatus, Tone> = {
  draft: "neutral",
  pending_approval: "warn",
  approved: "success",
  changes_requested: "danger",
};

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  changes_requested: "Changes requested",
};

// ── Calendar helpers ────────────────────────────────────────
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthGrid(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay());
  const weeks: Date[][] = [];
  const cur = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Local `YYYY-MM-DD` key for grouping posts onto calendar days (avoids the
 *  UTC drift a toISOString().slice(0,10) would introduce near midnight). */
export function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO half-open window [from, to) covering one calendar month — the fetch
 *  bounds for that month's posts. */
export function monthWindow(year: number, month: number): { from: string; to: string } {
  return {
    from: new Date(year, month, 1).toISOString(),
    to: new Date(year, month + 1, 1).toISOString(),
  };
}

/** The fixed cadence: 6 posts a week, Sunday off. The month's expected number
 *  is simply its count of non-Sunday days (so Feb, 30- and 31-day months each
 *  get their own honest target with no manual setup). */
export function expectedPostsInMonth(year: number, month: number): number {
  let count = 0;
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    if (d.getDay() !== 0) count += 1; // 0 = Sunday
    d.setDate(d.getDate() + 1);
  }
  return count;
}

export function isSunday(d: Date): boolean {
  return d.getDay() === 0;
}
