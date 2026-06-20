/**
 * Marketing & Email Campaigns — typed client + TanStack hooks.
 *
 * Two backends behind one Hub module ("Marketing & Email Campaigns"):
 *   • Ad Analytics — `src/modules/marketing` (mounted /api/v1/marketing,
 *     permission key `ad_analytics`): ad accounts, ad campaigns, attribution.
 *   • Email Campaigns — `src/modules/email_campaigns` (mounted
 *     /api/v1/email-campaigns, permission key `email_campaigns`): templates,
 *     segments, campaigns, A/B, stats.
 *
 * The campaign builder always sends via email (the only delivery the backend
 * guarantees); WhatsApp is an optional secondary channel surfaced as a toggle.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";
import type { Tone } from "@/components/ui/primitives";

export function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

interface Paginated<T> {
  data: T[];
  meta?: Record<string, unknown>;
}

// ════════════════════════════════════════════════════════════
// Ad Analytics — types
// ════════════════════════════════════════════════════════════

export type AdPlatform = "google_ads" | "meta_ads";
export type AdStatus = "draft" | "active" | "paused" | "ended" | "removed";

export interface AdAccount {
  ad_account_id: string;
  business: string;
  platform: AdPlatform;
  external_account_id: string;
  display_name: string;
  currency: string;
  created_at?: string;
}

export interface AdCampaign {
  ad_campaign_id: string;
  business: string;
  ad_account_id: string;
  platform: AdPlatform;
  external_campaign_id: string | null;
  name: string;
  objective: string | null;
  status: AdStatus;
  budget_amount: number | null;
  budget_currency: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttributionRow {
  ad_campaign_id: string;
  name: string;
  platform: AdPlatform;
  spend_ngn: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue_ngn?: number;
  orders?: number;
  roas?: number;
}

export interface AttributionReport {
  ads?: AttributionRow[];
  sales?: Array<Record<string, unknown>>;
  rows?: AttributionRow[];
  totals?: Record<string, number>;
  [k: string]: unknown;
}

// ── Ad accounts ─────────────────────────────────────────────

export function useAdAccounts() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["marketing", "ad-accounts", brand],
    queryFn: () => api.get<AdAccount[]>("/marketing/ad-accounts"),
    staleTime: 60_000,
  });
}

export function useConnectAdAccount() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: {
      platform: AdPlatform;
      external_account_id: string;
      display_name: string;
      currency?: string;
    }) => api.post<AdAccount>("/marketing/ad-accounts", input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["marketing", "ad-accounts", brand] }),
  });
}

export function useRevokeAdAccount() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/marketing/ad-accounts/${id}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["marketing", "ad-accounts", brand] }),
  });
}

// ── Ad campaigns ────────────────────────────────────────────

export function useAdCampaigns(status?: string) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  qs.set("page_size", "100");
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["marketing", "ad-campaigns", brand, qs.toString()],
    // The list endpoint returns { data, page, page_size, total } (no `meta`),
    // so the api client unwraps it to a bare array; normalise either shape.
    queryFn: async () => {
      const r = await api.get<AdCampaign[] | Paginated<AdCampaign>>(
        `/marketing/ad-campaigns?${qs}`,
      );
      return Array.isArray(r) ? r : (r?.data ?? []);
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useCreateAdCampaign() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: {
      ad_account_id: string;
      platform: AdPlatform;
      name: string;
      objective?: string;
      status?: AdStatus;
      budget_amount?: number;
      budget_currency?: string;
      external_campaign_id?: string;
      push?: boolean;
    }) => api.post<AdCampaign>("/marketing/ad-campaigns", body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["marketing", "ad-campaigns", brand] }),
  });
}

export function useSetAdCampaignStatus() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; status: AdStatus }) =>
      api.post<AdCampaign>(`/marketing/ad-campaigns/${args.id}/status`, {
        status: args.status,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["marketing", "ad-campaigns", brand] }),
  });
}

export function useRecordSpend() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: {
      id: string;
      metric_date?: string;
      spend_ngn?: number;
      impressions?: number;
      clicks?: number;
      conversions?: number;
      conversion_value_ngn?: number;
    }) => {
      const { id, ...body } = args;
      return api.post<unknown>(`/marketing/ad-campaigns/${id}/spend`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing", "ad-campaigns", brand] });
      qc.invalidateQueries({ queryKey: ["marketing", "attribution", brand] });
    },
  });
}

export function useAttribution(from?: string, to?: string) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["marketing", "attribution", brand, qs.toString()],
    queryFn: () => api.get<AttributionReport>(`/marketing/attribution?${qs}`),
    staleTime: 60_000,
  });
}

// ════════════════════════════════════════════════════════════
// Email Campaigns — types
// ════════════════════════════════════════════════════════════

export type EmailCampaignType =
  | "one_off"
  | "recurring"
  | "triggered"
  | "milestone"
  | "ab_test";

export type EmailCampaignStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "paused"
  | "cancelled"
  | "completed";

export interface EmailTemplate {
  template_id: string;
  template_key: string;
  display_name: string;
  subject_line: string;
  html_body?: string;
  available_variables?: string[];
  from_name?: string | null;
  from_email?: string | null;
  reply_to_email?: string | null;
  status: "draft" | "review" | "approved" | "archived";
  is_active?: boolean;
  created_at?: string;
}

/** Merge tokens the backend actually substitutes at send (see render() in
 *  email-campaigns.service): customer_name + email. */
export const TEMPLATE_VARIABLES: { token: string; label: string }[] = [
  { token: "{{customer_name}}", label: "Customer name" },
  { token: "{{email}}", label: "Email address" },
];

export interface EmailSegment {
  segment_id: string;
  name: string;
  description: string | null;
  filter: Record<string, unknown> | null;
  created_at?: string;
}

export interface EmailCampaign {
  campaign_id: string;
  business: string;
  campaign_name: string;
  campaign_type: EmailCampaignType;
  status: EmailCampaignStatus;
  segment_id: string | null;
  default_template_id: string | null;
  from_name: string | null;
  from_email: string | null;
  reply_to_email: string | null;
  scheduled_for: string | null;
  recipients_count?: number;
  sent_count?: number;
  created_at: string;
  updated_at: string;
  /** Client-only: whether the WhatsApp companion blast is requested. */
  whatsapp_enabled?: boolean;
}

export interface EmailStats {
  campaign_id: string;
  status: EmailCampaignStatus;
  totals: {
    sent?: number;
    delivered?: number;
    opened?: number;
    clicked?: number;
    bounced?: number;
    unsubscribed?: number;
  };
  rates: {
    open_rate_pct?: number;
    click_rate_pct?: number;
    bounce_rate_pct?: number;
  };
  conversions?: { count?: number; revenue_ngn?: number };
  event_breakdown?: Record<string, number>;
}

export interface SegmentPreview {
  segment_id: string;
  count: number;
  sample: Array<{
    contact_id: string;
    display_name?: string | null;
    email?: string | null;
  }>;
}

export interface AbVariant {
  variant_id: string;
  campaign_id: string;
  variant_label: string;
  subject_line?: string | null;
  total_sent?: number;
  total_opened?: number;
  total_clicked?: number;
  open_rate_pct: number;
  click_rate_pct: number;
  conversion_rate_pct?: number;
  allocation_pct?: number;
  is_winner?: boolean;
}

export interface AbResults {
  metric: string;
  variants: AbVariant[];
  leading_variant_id: string | null;
}

// ── Templates ───────────────────────────────────────────────

export function useEmailTemplates() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["email", "templates", brand],
    queryFn: () => api.get<EmailTemplate[]>("/email-campaigns/templates"),
    staleTime: 60_000,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: {
      template_key: string;
      display_name: string;
      subject_line: string;
      html_body: string;
      from_name?: string;
      from_email?: string;
      reply_to_email?: string;
    }) => api.post<EmailTemplate>("/email-campaigns/templates", body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["email", "templates", brand] }),
  });
}

// ── Segments ────────────────────────────────────────────────

export function useEmailSegments() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["email", "segments", brand],
    queryFn: () => api.get<EmailSegment[]>("/email-campaigns/segments"),
    staleTime: 60_000,
  });
}

// ── Campaigns ───────────────────────────────────────────────

export function useEmailCampaigns(status?: string) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  qs.set("page_size", "100");
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["email", "campaigns", brand, qs.toString()],
    // Endpoint returns { data, page, page_size, total } (no `meta`) → the api
    // client unwraps to a bare array; normalise either shape to an array.
    queryFn: async () => {
      const r = await api.get<EmailCampaign[] | Paginated<EmailCampaign>>(
        `/email-campaigns?${qs}`,
      );
      return Array.isArray(r) ? r : (r?.data ?? []);
    },
    staleTime: 20_000,
    placeholderData: keepPreviousData,
  });
}

export function useEmailCampaign(id: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && id),
    queryKey: ["email", "campaign", brand, id],
    queryFn: () => api.get<EmailCampaign>(`/email-campaigns/${id}`),
  });
}

export function useCreateEmailCampaign() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: {
      campaign_name: string;
      campaign_type?: EmailCampaignType;
      segment_id?: string;
      default_template_id?: string;
      from_name?: string;
      from_email?: string;
      reply_to_email?: string;
      scheduled_for?: string;
    }) => api.post<EmailCampaign>("/email-campaigns", body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["email", "campaigns", brand] }),
  });
}

export function useEmailStats(id: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && id),
    queryKey: ["email", "stats", brand, id],
    queryFn: () => api.get<EmailStats>(`/email-campaigns/${id}/stats`),
  });
}

// ── Templates: update ───────────────────────────────────────
export function useUpdateTemplate() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; patch: Partial<EmailTemplate> }) =>
      api.patch<EmailTemplate>(`/email-campaigns/templates/${args.id}`, args.patch),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["email", "templates", brand] }),
  });
}

// ── Segments: save / delete / preview ───────────────────────
export function useSaveSegment() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: {
      name: string;
      description?: string;
      filter?: Record<string, unknown>;
    }) => api.post<EmailSegment>("/email-campaigns/segments", body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["email", "segments", brand] }),
  });
}

export function useDeleteSegment() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<void>(`/email-campaigns/segments/${id}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["email", "segments", brand] }),
  });
}

/** Preview is read-only but server-side (updates a cached count), so expose it
 *  as a mutation the UI triggers on demand. */
export function usePreviewSegment() {
  return useMutation({
    mutationFn: (id: string) =>
      api.get<SegmentPreview>(`/email-campaigns/segments/${id}/preview`),
  });
}

// ── Campaign audience ───────────────────────────────────────
export function useBuildAudienceFromSegment(id: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (segment_id: string) =>
      api.post<{ campaign_id: string; segment_id: string; recipients_added: number }>(
        `/email-campaigns/${id}/audience-from-segment`,
        { segment_id },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email", "campaign", brand, id] });
      qc.invalidateQueries({ queryKey: ["email", "stats", brand, id] });
    },
  });
}

export function useBuildRecipients(id: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (contact_ids?: string[]) =>
      api.post<{ added: number }>(`/email-campaigns/${id}/recipients`, {
        contact_ids,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email", "campaign", brand, id] });
      qc.invalidateQueries({ queryKey: ["email", "stats", brand, id] });
    },
  });
}

// ── A/B variants ────────────────────────────────────────────
export function useAbResults(id: string | undefined, enabled = true) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && id && enabled),
    queryKey: ["email", "ab", brand, id],
    queryFn: () => api.get<AbResults>(`/email-campaigns/${id}/ab-results`),
  });
}

export function useCreateVariant(id: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: {
      variant_label: string;
      template_id?: string;
      subject_line?: string;
      from_name?: string;
      preheader_text?: string;
      allocation_pct: number;
    }) => api.post<AbVariant>(`/email-campaigns/${id}/variants`, body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["email", "ab", brand, id] }),
  });
}

export function useDeclareWinner(id: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (variant_id: string) =>
      api.post<{ campaign_id: string; ab_winner_variant_id: string }>(
        `/email-campaigns/${id}/winner`,
        { variant_id },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email", "ab", brand, id] });
      qc.invalidateQueries({ queryKey: ["email", "campaign", brand, id] });
    },
  });
}

export function useScheduleEmailCampaign() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; scheduled_for: string }) =>
      api.post<EmailCampaign>(`/email-campaigns/${args.id}/schedule`, {
        scheduled_for: args.scheduled_for,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["email", "campaigns", brand] }),
  });
}

export function useSendEmailCampaign() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<EmailCampaign>(`/email-campaigns/${id}/send`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email", "campaigns", brand] });
      qc.invalidateQueries({ queryKey: ["email", "campaign", brand] });
    },
  });
}

export function usePauseEmailCampaign() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<EmailCampaign>(`/email-campaigns/${id}/pause`, {}),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["email", "campaigns", brand] }),
  });
}

export function useCancelEmailCampaign() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<EmailCampaign>(`/email-campaigns/${id}/cancel`, {}),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["email", "campaigns", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Presentation metadata
// ════════════════════════════════════════════════════════════

export const AD_PLATFORM_LABEL: Record<AdPlatform, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
};

export const AD_STATUS_TONE: Record<AdStatus, Tone> = {
  draft: "neutral",
  active: "success",
  paused: "warn",
  ended: "neutral",
  removed: "danger",
};

export const EMAIL_STATUS_TONE: Record<EmailCampaignStatus, Tone> = {
  draft: "neutral",
  scheduled: "info",
  sending: "warn",
  sent: "success",
  paused: "warn",
  cancelled: "danger",
  completed: "success",
};
