/**
 * Marketing — Email Campaigns typed client + TanStack hooks.
 *
 * One backend: `src/modules/email_campaigns` (mounted /api/v1/email-campaigns,
 * permission key `email_campaigns`) — campaigns, templates, segments, the
 * brand frame (header/footer), A/B, stats and the exact-mail preview.
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

// Merge-token registry (recipient, loyalty, brand, sale + custom tokens):
// see @/lib/personalise — one vocabulary shared by the Marketing template
// editor and the Retention strategy builder.

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
  /** Campaign-level merge variables (sale discount, link, end date, …). */
  merge_data?: Record<string, string | number | boolean | null> | null;
  recipients_count?: number;
  sent_count?: number;
  created_at: string;
  updated_at: string;
  /** Client-only: whether the WhatsApp companion blast is requested. */
  whatsapp_enabled?: boolean;
}

/** Sale details a campaign carries → the email's countdown, discount and CTA. */
export interface CampaignMergeData {
  discount?: string;
  sale_url?: string;
  /** ISO datetime; the send pipeline derives days_left + deadline_phrase. */
  sale_ends_at?: string;
  cta_label?: string;
  [key: string]: string | number | boolean | null | undefined;
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

export function useUpdateEmailCampaign(id: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (patch: {
      campaign_name?: string;
      segment_id?: string | null;
      default_template_id?: string | null;
      from_name?: string | null;
      from_email?: string | null;
      reply_to_email?: string | null;
      scheduled_for?: string | null;
      merge_data?: CampaignMergeData;
    }) => api.patch<EmailCampaign>(`/email-campaigns/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email", "campaigns", brand] });
      qc.invalidateQueries({ queryKey: ["email", "campaign", brand, id] });
    },
  });
}

/** The exact mail a campaign sends — rendered by the send pipeline itself. */
export interface CampaignPreview {
  campaign_id: string;
  subject: string;
  html: string;
  sample_recipient: { name: string; email: string; is_real: boolean };
}

export function useCampaignPreview(id: string | undefined, enabled = true) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && id && enabled),
    queryKey: ["email", "preview", brand, id],
    queryFn: () => api.get<CampaignPreview>(`/email-campaigns/${id}/preview`),
    retry: false,
  });
}

// ── Brand frame (header/footer around every campaign mail) ──
export interface EmailFrame {
  show_logo: boolean;
  tagline: string;
  footer_note: string;
  show_address: boolean;
  show_contact: boolean;
  instagram_url: string;
  tiktok_url: string;
}

export function useEmailFrame() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["email", "frame", brand],
    queryFn: () =>
      api.get<{ frame: EmailFrame; defaults: EmailFrame }>(
        "/email-campaigns/frame",
      ),
    staleTime: 60_000,
  });
}

export function useSaveEmailFrame() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (patch: Partial<EmailFrame>) =>
      api.put<{ frame: EmailFrame; defaults: EmailFrame }>(
        "/email-campaigns/frame",
        patch,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email", "frame", brand] });
      qc.invalidateQueries({ queryKey: ["email", "frame-shell", brand] });
      qc.invalidateQueries({ queryKey: ["email", "preview", brand] });
    },
  });
}

/** The framed shell (real header/footer, brand tokens resolved) with a
 *  `<!--PGH_BODY-->` marker the editor swaps for what's being written. */
export function useFrameShell() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["email", "frame-shell", brand],
    queryFn: () =>
      api.get<{ shell_html: string; tokens: Record<string, string> }>(
        "/email-campaigns/frame/shell",
      ),
    staleTime: 60_000,
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

/** Live count + sample for an ad-hoc filter — powers the segment modal's
 *  "who's in" preview before anything is saved. */
export function usePreviewAudience(filter: Record<string, unknown>) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["email", "audience-preview", brand, JSON.stringify(filter)],
    queryFn: () =>
      api.post<{
        count: number;
        sample: Array<{
          contact_id: string;
          display_name?: string | null;
          email?: string | null;
        }>;
      }>("/email-campaigns/segments/preview", { filter }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
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

export const EMAIL_STATUS_TONE: Record<EmailCampaignStatus, Tone> = {
  draft: "neutral",
  scheduled: "info",
  sending: "warn",
  sent: "success",
  paused: "warn",
  cancelled: "danger",
  completed: "success",
};
