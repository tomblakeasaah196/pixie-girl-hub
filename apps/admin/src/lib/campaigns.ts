/**
 * Sales Campaigns v2 — data layer.
 *
 * Typed TanStack Query hooks for the admin builder, detail dashboard,
 * landing editor and the new entities (bundles, tiers, cart upsells,
 * ambassadors, VIP grants, Praxis assist). Per-brand resources carry the
 * active brand key in their query key so a brand switch refetches.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";

export function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

export type CampaignStatus =
  | "draft"
  | "pending_approval"
  | "scheduled"
  | "live"
  | "paused"
  | "ended"
  | "archived";

export type PublicState = "before" | "live" | "ended";

export type DiscountType =
  | "percentage"
  | "fixed_amount"
  | "buy_x_get_y"
  | "bundle"
  | "free_shipping";

export interface Campaign {
  campaign_id: string;
  slug: string;
  name: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  status: CampaignStatus;
  discount_type: DiscountType;
  discount_value: number;
  min_order_value_ngn: number | null;
  customer_segment_id: string | null;
  first_time_buyers_only: boolean;
  product_scope: "all" | "specific_products" | "specific_categories";
  landing_hero_title: string | null;
  landing_hero_subtitle: string | null;
  landing_hero_image_url: string | null;
  landing_cta_text: string | null;
  landing_blocks: LandingBlock[] | null;
  countdown_message: string | null;
  signup_for_notifications: boolean;
  ended_message: string | null;
  ended_redirect_to: string | null;
  meta_title: string | null;
  meta_description: string | null;
  og_image_url: string | null;
  total_usage_limit: number | null;
  total_visitors: number;
  total_unique_visitors: number;
  total_signups: number;
  total_add_to_cart: number;
  total_orders: number;
  total_revenue_ngn: number;
  total_discount_given_ngn: number;
  total_usage_count: number;
  voice_profile_override: VoiceProfile | null;
  ai_assist_pct: number;
  show_viewer_count_policy: "smart" | "on" | "off" | null;
  viewer_count_floor: number | null;
  vip_early_access_minutes: number;
  last_call_surge_minutes: number;
  vip_top_n: number;
  vip_lifetime_threshold_ngn: number | null;
  next_campaign_slug: string | null;
  exit_intent_enabled: boolean;
  exit_intent_code: string | null;
  exit_intent_discount_ngn: number | null;
  abandonment_recovery_enabled: boolean;
  allow_multi_currency_display: boolean;
  public_state?: PublicState;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LandingBlock {
  key: string;
  type?: string;
  enabled?: boolean;
  props?: Record<string, unknown>;
  drafted_by_ai?: boolean;
  rationale?: string;
}

export interface VoiceProfile {
  tone?: string;
  tagline_pace?: string;
  banned_words?: string[];
  no_fabricated_reviews?: boolean;
  exclamation_policy?: "never" | "rare" | "ok";
  sample_paragraphs?: string[];
}

export interface Bundle {
  bundle_id: string;
  slug: string;
  name: string;
  description: string | null;
  hero_image_url: string | null;
  category_id: string | null;
  is_fixed_composition: boolean;
  default_per_item_discount_ngn: number;
  default_preorder_loss_pct: number;
  status: "active" | "archived" | "draft";
  display_order: number;
  ai_assist_pct: number;
  created_at: string;
  updated_at: string;
}

export interface BundleItem {
  bundle_item_id: string;
  bundle_id: string;
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
  per_item_discount_ngn: number | null;
  display_position: number;
  product_name?: string;
  variant_sku?: string;
  unit_price_ngn?: number;
  hero_image_url?: string;
}

export interface CampaignBundleLink {
  link_id: string;
  campaign_id: string;
  bundle_id: string;
  bundle_slug: string;
  bundle_name: string;
  bundle_hero_image_url: string | null;
  per_item_discount_ngn: number | null;
  campaign_bundle_price_ngn: number | null;
  preorder_enabled: boolean;
  preorder_loss_pct: number | null;
  preorder_lead_weeks: number | null;
  starting_stock: number | null;
  current_stock_snapshot: number | null;
  is_featured: boolean;
  display_order: number;
}

export interface QuantityTier {
  tier_id: string;
  campaign_id: string;
  min_quantity: number;
  fixed_discount_ngn: number;
  label: string | null;
  scope_bundle_ids: string[];
  scope_product_ids: string[];
  display_order: number;
  is_active: boolean;
}

export interface CartUpsell {
  upsell_id: string;
  campaign_id: string;
  rung: number;
  trigger_type: "cart_qty" | "cart_value" | "specific_bundle";
  min_cart_qty: number | null;
  min_cart_value_ngn: number | null;
  trigger_bundle_id: string | null;
  offer_label: string;
  offer_subline: string | null;
  reward_type: "fixed_amount" | "percentage" | "suggest_bundle";
  reward_value: number | null;
  reward_bundle_id: string | null;
  display_order: number;
  is_active: boolean;
  shown_count: number;
  converted_count: number;
}

export interface AmbassadorContact {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  instagram_handle: string | null;
  email: string | null;
  phone: string | null;
  ambassador_profile?: Record<string, unknown>;
}

export interface CampaignAmbassador {
  ambassador_link_id: string;
  campaign_id: string;
  contact_id: string;
  utm_source: string;
  commission_pct: number | null;
  visits_count: number;
  orders_count: number;
  revenue_ngn: number;
  earned_commission_ngn: number;
  share_link: string | null;
  qr_url: string | null;
  first_name?: string | null;
  last_name?: string | null;
  instagram_handle?: string | null;
  email?: string | null;
}

export interface VipGrant {
  grant_id: string;
  campaign_id: string;
  contact_id: string;
  rank: number;
  total_spend_ngn: number;
  promoted_to_platinum: boolean;
  gift_task_id: string | null;
  gift_status: "pending" | "approved" | "dispatched" | "delivered" | "rejected";
  praxis_gift_suggestion: string | null;
  thank_you_sent_at: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  instagram_handle?: string | null;
}

export interface PraxisDraft<T = unknown> {
  section?: string;
  draft?: T | null;
  voice_used?: VoiceProfile;
  pending_acceptance: boolean;
  drafted_by_ai: boolean;
  reason?: string;
}

export interface PraxisLayout {
  layout: Array<{ key: string; rationale: string }>;
  pending_acceptance: boolean;
  drafted_by_ai: boolean;
  reason?: string;
}

export interface PraxisPricingResult {
  ok: boolean;
  reason?: string;
  results: Array<{
    label: string;
    target_price_ngn: string;
    proposed_price_ngn: string;
    below_floor: boolean;
    breakdown: Record<string, unknown>;
  }>;
  breaches?: Array<{ label: string; proposed_price_ngn: string; floor_ngn: number | null }>;
  pending_acceptance: boolean;
  drafted_by_ai: boolean;
}

// ════════════════════════════════════════════════════════════
// Campaigns — collection + single
// ════════════════════════════════════════════════════════════

export function useCampaignList(filters: {
  status?: string;
  q?: string;
  active_on?: string;
  page?: number;
  page_size?: number;
} = {}) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.q) qs.set("q", filters.q);
  if (filters.active_on) qs.set("active_on", filters.active_on);
  if (filters.page) qs.set("page", String(filters.page));
  if (filters.page_size) qs.set("page_size", String(filters.page_size));
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["campaigns", "list", brand, qs.toString()],
    queryFn: () =>
      api.get<{ data: Campaign[]; meta: Record<string, unknown> }>(
        `/sales-campaigns?${qs.toString()}`,
      ),
    staleTime: 30_000,
  });
}

export function useCampaign(id: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && id),
    queryKey: ["campaigns", "one", brand, id],
    queryFn: () => api.get<Campaign>(`/sales-campaigns/${id}`),
    staleTime: 15_000,
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: Partial<Campaign> & { slug: string; name: string; starts_at: string; ends_at: string; discount_type: DiscountType; discount_value: number }) =>
      api.post<Campaign>("/sales-campaigns", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "list", brand] }),
  });
}

export function useUpdateCampaign(id: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (patch: Partial<Campaign>) =>
      api.patch<Campaign>(`/sales-campaigns/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", "one", brand, id] });
      qc.invalidateQueries({ queryKey: ["campaigns", "list", brand] });
    },
  });
}

export function useCampaignTransition(id: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (action: "submit" | "approve" | "reject" | "launch" | "pause" | "resume" | "end") =>
      api.post<Campaign>(`/sales-campaigns/${id}/${action}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", "one", brand, id] });
      qc.invalidateQueries({ queryKey: ["campaigns", "list", brand] });
    },
  });
}

export function useDuplicateCampaign() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; name?: string; slug?: string }) =>
      api.post<Campaign>(`/sales-campaigns/${args.id}/duplicate`, args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "list", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Bundles (catalogue) + campaign attachment
// ════════════════════════════════════════════════════════════

export function useBundleList(q?: string) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["campaigns", "bundles", brand, q || ""],
    queryFn: () => api.get<{ data: Bundle[] }>(`/sales-campaigns/bundles?${qs}`),
  });
}

export function useBundle(id: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && id),
    queryKey: ["campaigns", "bundle", brand, id],
    queryFn: () => api.get<Bundle & { items: BundleItem[] }>(`/sales-campaigns/bundles/${id}`),
  });
}

export function useCreateBundle() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: Partial<Bundle> & { slug: string; name: string }) =>
      api.post<Bundle>("/sales-campaigns/bundles", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "bundles", brand] }),
  });
}

export function useUpdateBundle(id: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (patch: Partial<Bundle>) => api.patch<Bundle>(`/sales-campaigns/bundles/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", "bundle", brand, id] });
      qc.invalidateQueries({ queryKey: ["campaigns", "bundles", brand] });
    },
  });
}

export function useAddBundleItem(bundleId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: Partial<BundleItem>) =>
      api.post<BundleItem>(`/sales-campaigns/bundles/${bundleId}/items`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "bundle", brand, bundleId] }),
  });
}

export function useRemoveBundleItem(bundleId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (itemId: string) => api.delete<void>(`/sales-campaigns/bundles/${bundleId}/items/${itemId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "bundle", brand, bundleId] }),
  });
}

export function useCampaignBundles(campaignId: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "campaign-bundles", brand, campaignId],
    queryFn: () =>
      api.get<{ data: CampaignBundleLink[] }>(`/sales-campaigns/${campaignId}/bundles`),
  });
}

export function useAttachCampaignBundle(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: Partial<CampaignBundleLink> & { bundle_id: string }) =>
      api.post<CampaignBundleLink>(`/sales-campaigns/${campaignId}/bundles`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "campaign-bundles", brand, campaignId] }),
  });
}

export function useDetachCampaignBundle(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (linkId: string) =>
      api.delete<void>(`/sales-campaigns/${campaignId}/bundles/${linkId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "campaign-bundles", brand, campaignId] }),
  });
}

// ════════════════════════════════════════════════════════════
// Quantity tiers
// ════════════════════════════════════════════════════════════
export function useCampaignTiers(campaignId: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "tiers", brand, campaignId],
    queryFn: () => api.get<{ data: QuantityTier[] }>(`/sales-campaigns/${campaignId}/tiers`),
  });
}

export function useUpsertTier(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: Partial<QuantityTier> & { min_quantity: number; fixed_discount_ngn: number }) =>
      api.post<QuantityTier>(`/sales-campaigns/${campaignId}/tiers`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "tiers", brand, campaignId] }),
  });
}

export function useDeleteTier(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (tierId: string) =>
      api.delete<void>(`/sales-campaigns/${campaignId}/tiers/${tierId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "tiers", brand, campaignId] }),
  });
}

// ════════════════════════════════════════════════════════════
// Cart upsells
// ════════════════════════════════════════════════════════════
export function useCampaignUpsells(campaignId: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "upsells", brand, campaignId],
    queryFn: () => api.get<{ data: CartUpsell[] }>(`/sales-campaigns/${campaignId}/upsells`),
  });
}

export function useUpsertUpsell(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: Partial<CartUpsell>) =>
      api.post<CartUpsell>(`/sales-campaigns/${campaignId}/upsells`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "upsells", brand, campaignId] }),
  });
}

export function useDeleteUpsell(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (upsellId: string) =>
      api.delete<void>(`/sales-campaigns/${campaignId}/upsells/${upsellId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "upsells", brand, campaignId] }),
  });
}

// ════════════════════════════════════════════════════════════
// Ambassadors
// ════════════════════════════════════════════════════════════
export function useAmbassadorContacts(q?: string) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["campaigns", "ambassadors", brand, q || ""],
    queryFn: () => api.get<{ data: AmbassadorContact[] }>(`/sales-campaigns/ambassadors?${qs}`),
  });
}

export function usePromoteAmbassador() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { contactId: string; profile?: Record<string, unknown> }) =>
      api.post<AmbassadorContact>(`/sales-campaigns/ambassadors/${args.contactId}/promote`, args.profile || {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "ambassadors", brand] }),
  });
}

export function useCampaignAmbassadors(campaignId: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "campaign-ambassadors", brand, campaignId],
    queryFn: () => api.get<{ data: CampaignAmbassador[] }>(`/sales-campaigns/${campaignId}/ambassadors`),
  });
}

export function useAttachAmbassador(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: { contact_id: string; utm_source: string; commission_pct?: number | null }) =>
      api.post<CampaignAmbassador>(`/sales-campaigns/${campaignId}/ambassadors`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "campaign-ambassadors", brand, campaignId] }),
  });
}

// ════════════════════════════════════════════════════════════
// VIP grants
// ════════════════════════════════════════════════════════════
export function useVipGrants(campaignId: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "vip", brand, campaignId],
    queryFn: () => api.get<{ data: VipGrant[] }>(`/sales-campaigns/${campaignId}/vip-grants`),
  });
}

export function useGrantVip(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: { top_n?: number }) =>
      api.post<{ granted: number; lifetime_promoted: number }>(`/sales-campaigns/${campaignId}/vip-grants`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "vip", brand, campaignId] }),
  });
}

export function useUpdateGiftStatus(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { grantId: string; gift_status: VipGrant["gift_status"] }) =>
      api.patch<VipGrant>(`/sales-campaigns/${campaignId}/vip-grants/${args.grantId}`, {
        gift_status: args.gift_status,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns", "vip", brand, campaignId] }),
  });
}

// ════════════════════════════════════════════════════════════
// Praxis assist
// ════════════════════════════════════════════════════════════
export function usePraxisDraftCopy(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (body: { section: string; brief?: string; campaign_theme?: string; product_focus?: string; topics?: string[]; tone_override?: string }) =>
      api.post<PraxisDraft<Record<string, unknown>>>(`/sales-campaigns/${campaignId}/praxis/draft-copy`, body),
  });
}

export function usePraxisSuggestLayout(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (body: { campaign_type?: string; duration_hours?: number; product_focus?: string }) =>
      api.post<PraxisLayout>(`/sales-campaigns/${campaignId}/praxis/suggest-layout`, body),
  });
}

export function usePraxisSuggestPricing(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (body: { target_margin_pct: number; include_charm_rounding?: boolean; inputs: Array<Record<string, unknown>> }) =>
      api.post<PraxisPricingResult>(`/sales-campaigns/${campaignId}/praxis/suggest-pricing`, body),
  });
}

export function usePraxisDryRun(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (body: { question: string; proposed_price_ngn?: number; floor_ngn?: number }) =>
      api.post<{ answer: string; citations: string[]; drafted_by_ai: boolean }>(`/sales-campaigns/${campaignId}/praxis/dry-run-pricing`, body),
  });
}

export function usePraxisAnalyticsQna(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (body: { question: string }) =>
      api.post<{ answer: string; metrics: Record<string, unknown>; drafted_by_ai: boolean }>(`/sales-campaigns/${campaignId}/praxis/analytics-qna`, body),
  });
}

export function usePraxisAccept(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (body: { action_key: string; prompt?: string; draft: unknown; accepted: unknown }) =>
      api.post<void>(`/sales-campaigns/${campaignId}/praxis/accept`, body),
  });
}

// ════════════════════════════════════════════════════════════
// Landing + share kit + metrics + signups
// ════════════════════════════════════════════════════════════
export function useCampaignMetrics(campaignId: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "metrics", brand, campaignId],
    queryFn: () => api.get<{
      campaign_id: string;
      status: CampaignStatus;
      public_state: PublicState;
      rollups: Record<string, number>;
    }>(`/sales-campaigns/${campaignId}/metrics`),
    refetchInterval: 15_000,
  });
}

export function useCampaignDailyMetrics(campaignId: string | undefined, from?: string, to?: string) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "metrics-daily", brand, campaignId, qs.toString()],
    queryFn: () => api.get<{ data: Array<Record<string, unknown>> }>(`/sales-campaigns/${campaignId}/metrics/daily?${qs}`),
  });
}

export function useShareKit(campaignId: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "share-kit", brand, campaignId],
    queryFn: () => api.get<{
      base_url: string;
      links: Record<string, string>;
      copy: Record<string, string>;
    }>(`/sales-campaigns/${campaignId}/share-kit`),
  });
}

export function useCampaignSignups(campaignId: string | undefined, page = 1) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "signups", brand, campaignId, page],
    queryFn: () => api.get<{
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    }>(`/sales-campaigns/${campaignId}/signups?page=${page}`),
  });
}

export function useLandingPreview(campaignId: string | undefined, state?: PublicState) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (state) qs.set("state", state);
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "preview", brand, campaignId, state || "auto"],
    queryFn: () => api.get<Record<string, unknown>>(`/sales-campaigns/${campaignId}/preview?${qs}`),
  });
}
