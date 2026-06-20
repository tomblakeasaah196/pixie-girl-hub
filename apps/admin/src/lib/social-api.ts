/**
 * Social Media Management — typed client + TanStack hooks.
 *
 * Mirrors `src/modules/social_media/social.routes.js` (mounted /api/v1/social,
 * permission key `social`). Field/endpoint truth: the social.repo SQL
 * (shared.social_accounts / shared.social_posts / shared.social_post_metrics).
 *
 * Per-brand resources carry the active brand key in their query key so a brand
 * switch refetches (canon §4.1). The X-Brand-Context header is attached by the
 * api client automatically.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";
import type { Tone } from "@/components/ui/primitives";

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
  | "scheduled"
  | "publishing"
  | "published"
  | "partial"
  | "failed"
  | "cancelled";

export interface SocialAccount {
  account_id: string;
  business: string;
  platform: SocialPlatform;
  handle: string;
  external_account_id: string;
  scopes: string[];
  is_active?: boolean;
  connected_at?: string;
  created_at?: string;
}

export interface SocialPost {
  post_id: string;
  business: string;
  account_id: string;
  platform: SocialPlatform;
  post_type: PostType;
  caption: string | null;
  hashtags: string[];
  media_urls: string[];
  tagged_product_ids: string[];
  status: PostStatus;
  scheduled_for: string | null;
  published_at: string | null;
  external_post_id: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
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
}

export interface PostCreateInput {
  account_id: string;
  platform: SocialPlatform;
  post_type: PostType;
  caption?: string;
  hashtags?: string[];
  media_urls?: string[];
  tagged_product_ids?: string[];
  scheduled_for?: string;
  /** Force the intent: a "planned draft" sends status:"draft" + scheduled_for
   *  (its calendar date). Omit to infer from scheduled_for. */
  status?: "draft" | "scheduled";
}

export interface AccountConnectInput {
  platform: SocialPlatform;
  handle: string;
  external_account_id: string;
  scopes?: string[];
}

interface Paginated<T> {
  data: T[];
  meta?: { page?: number; page_size?: number; total?: number; has_more?: boolean };
}

// ════════════════════════════════════════════════════════════
// Accounts
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

export function useRevokeAccount() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/social/accounts/${id}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["social", "accounts", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Posts
// ════════════════════════════════════════════════════════════

export function usePosts(
  filters: { status?: string; page?: number; page_size?: number } = {},
) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.page) qs.set("page", String(filters.page));
  qs.set("page_size", String(filters.page_size ?? 100));
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["social", "posts", brand, qs.toString()],
    // Endpoint returns { data, page, page_size, total } (no `meta`) → the api
    // client unwraps to a bare array; normalise either shape to an array.
    queryFn: async () => {
      const r = await api.get<SocialPost[] | Paginated<SocialPost>>(
        `/social/posts?${qs}`,
      );
      return Array.isArray(r) ? r : (r?.data ?? []);
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

export function useCreatePost() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: PostCreateInput) =>
      api.post<SocialPost>("/social/posts", body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["social", "posts", brand] }),
  });
}

export function usePublishPost() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; external_post_id?: string }) =>
      api.post<SocialPost>(`/social/posts/${args.id}/publish`, {
        external_post_id: args.external_post_id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social", "posts", brand] });
      qc.invalidateQueries({ queryKey: ["social", "post", brand] });
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social", "posts", brand] });
      qc.invalidateQueries({ queryKey: ["social", "post", brand] });
    },
  });
}

export function usePostMetrics(postId: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && postId),
    queryKey: ["social", "metrics", brand, postId],
    queryFn: () => api.get<PostMetric[]>(`/social/posts/${postId}/metrics`),
  });
}

export function useRefreshMetrics() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<unknown>(`/social/posts/${id}/metrics/refresh`, {}),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["social", "metrics", brand, id] });
      qc.invalidateQueries({ queryKey: ["social", "posts", brand] });
    },
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
  scheduled: "info",
  publishing: "warn",
  published: "success",
  partial: "warn",
  failed: "danger",
  cancelled: "neutral",
};

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  partial: "Partial",
  failed: "Failed",
  cancelled: "Cancelled",
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
