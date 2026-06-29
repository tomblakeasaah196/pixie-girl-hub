/**
 * Sales Campaigns v2 — data layer.
 *
 * Typed TanStack Query hooks for the admin builder, detail dashboard,
 * landing editor and the new entities (bundles, tiers, cart upsells,
 * ambassadors, VIP grants, Praxis assist). Per-brand resources carry the
 * active brand key in their query key so a brand switch refetches.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LandingConfig } from "@landing-kit";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";

export function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

/**
 * GET a list endpoint and ALWAYS return a `{ data }` envelope.
 *
 * lib/api unwraps a bare `{ data }` body (one with no sibling `meta`) down to
 * the inner value, so these non-paginated campaign sub-lists arrive as a plain
 * array. The components read `query.data?.data`, which on a bare array is
 * `undefined` — so the list rendered empty even though rows existed (e.g. the
 * "No products added yet" after a successful add). Normalising here restores the
 * `{ data }` shape the components expect, and passes through a `{ data, meta }`
 * wrapper untouched when the endpoint is paginated.
 */
async function getListEnvelope<T>(
  path: string,
): Promise<{ data: T[]; meta?: unknown }> {
  const res = await api.get<{ data: T[]; meta?: unknown } | T[]>(path);
  if (Array.isArray(res)) return { data: res };
  return res ?? { data: [] };
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
  discount_type: DiscountType | null;
  discount_value: number | null;
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
  exit_intent_title: string | null;
  exit_intent_body: string | null;
  exit_intent_button: string | null;
  abandonment_recovery_enabled: boolean;
  allow_multi_currency_display: boolean;
  /** Static NGN-per-USD rate the landing page uses for its currency toggle.
   *  NULL = no USD display, toggle is hidden. Customer-facing only — order
   *  settlement uses the LIVE FX rate captured at payment. */
  ngn_per_usd_rate: number | null;
  delivery_weeks: number | null;
  preorder_extra_weeks: number;
  /** Free-shipping threshold: when cart goods subtotal ≥ this amount, delivery
   *  is automatically zeroed. NULL = no threshold. */
  free_shipping_threshold_ngn: number | null;
  position_ladder: PositionLadderItem[] | null;
  stacking_bonus: StackingBonus | null;
  bulk_tiers: BulkTier[] | null;
  /** Payment gateways this campaign offers at checkout. At least one stays on.
   *  USD always settles on Nomba regardless — dropping it only affects NGN. */
  allowed_payment_gateways: PaymentGateway[];
  public_state?: PublicState;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export type PaymentGateway = "paystack" | "nomba";

export interface PositionLadderItem {
  position: number;
  discount_ngn: number;
  label?: string;
}

export interface StackingBonus {
  min_distinct_bundles: number;
  discount_ngn: number;
  label?: string;
}

export interface BulkTier {
  min_qty: number;
  discount_per_item_ngn: number;
  label?: string;
}

export interface CampaignProduct {
  link_id: string;
  campaign_id: string;
  product_id: string | null;
  category_id: string | null;
  styled_id: string | null;
  include_exclude: "include" | "exclude";
  campaign_price_ngn: number | null;
  campaign_price_usd: number | null;
  regular_price_ngn: number | null;
  regular_price_usd: number | null;
  image_url: string | null;
  short_description: string | null;
  long_description: string | null;
  display_order: number;
  is_featured: boolean;
  preorder_enabled: boolean;
  styled_name?: string | null;
  styled_slug?: string | null;
  product_name?: string | null;
  resolved_image_url?: string | null;
  // Live styled fallbacks (rows added before the snapshot existed).
  styled_short_description?: string | null;
  styled_long_description?: string | null;
  styled_retail_price_ngn?: number | null;
  styled_retail_price_usd?: number | null;
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
  styled_id: string | null;
  quantity: number;
  per_item_discount_ngn: number | null;
  display_position: number;
  product_name?: string;
  variant_sku?: string;
  unit_price_ngn?: number;
  hero_image_url?: string;
  styled_name?: string | null;
  styled_slug?: string | null;
  display_name?: string;
}

/**
 * One row in the Catalogue → Bundles tab — the importable source list for the
 * campaign builder. Comes from retention.bundle_offers (the single source of
 * truth); importing attaches the campaign to this bundle by reference.
 */
export interface CatalogueBundleSource {
  bundle_offer_id: string;
  bundle_code: string;
  display_name: string;
  description: string | null;
  hero_image_url: string | null;
  pricing_model: string;
  bundle_price_ngn: number | null;
  bundle_price_usd: number | null;
  discount_value: number | null;
  component_count: number;
  components_total_ngn: number;
  is_active: boolean;
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
  breaches?: Array<{
    label: string;
    proposed_price_ngn: string;
    floor_ngn: number | null;
  }>;
  pending_acceptance: boolean;
  drafted_by_ai: boolean;
}

// ════════════════════════════════════════════════════════════
// Campaigns — collection + single
// ════════════════════════════════════════════════════════════

export function useCampaignList(
  filters: {
    status?: string;
    q?: string;
    active_on?: string;
    page?: number;
    page_size?: number;
  } = {},
) {
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
    mutationFn: (
      body: Partial<Campaign> & {
        slug: string;
        name: string;
        starts_at: string;
        ends_at: string;
        discount_type?: DiscountType | null;
        discount_value?: number | null;
      },
    ) => api.post<Campaign>("/sales-campaigns", body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["campaigns", "list", brand] }),
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
    mutationFn: (
      action:
        | "submit"
        | "approve"
        | "reject"
        | "launch"
        | "pause"
        | "resume"
        | "end",
    ) => api.post<Campaign>(`/sales-campaigns/${id}/${action}`, {}),
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
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["campaigns", "list", brand] }),
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
    queryFn: () =>
      api.get<{ data: Bundle[] }>(`/sales-campaigns/bundles?${qs}`),
  });
}

export function useBundle(id: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && id),
    queryKey: ["campaigns", "bundle", brand, id],
    queryFn: () =>
      api.get<Bundle & { items: BundleItem[] }>(
        `/sales-campaigns/bundles/${id}`,
      ),
  });
}

// NOTE: bundle authoring (create / update / add-item / remove-item) lives in
// Catalogue → Bundles (the retention SSOT) — there are intentionally no
// campaign-side write hooks for bundles. Campaigns only read + attach.

export function useCampaignBundles(campaignId: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "campaign-bundles", brand, campaignId],
    queryFn: () =>
      getListEnvelope<CampaignBundleLink>(
        `/sales-campaigns/${campaignId}/bundles`,
      ),
  });
}

export function useAttachCampaignBundle(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: Partial<CampaignBundleLink> & { bundle_id: string }) =>
      api.post<CampaignBundleLink>(
        `/sales-campaigns/${campaignId}/bundles`,
        body,
      ),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["campaigns", "campaign-bundles", brand, campaignId],
      }),
  });
}

export function useDetachCampaignBundle(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (linkId: string) =>
      api.delete<void>(`/sales-campaigns/${campaignId}/bundles/${linkId}`),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["campaigns", "campaign-bundles", brand, campaignId],
      }),
  });
}

// ════════════════════════════════════════════════════════════
// One-shot "publish X to a campaign" helpers (called from catalogue UI)
// ════════════════════════════════════════════════════════════

export function useAddStyledToCampaign() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({
      campaignId,
      styledId,
    }: {
      campaignId: string;
      styledId: string;
    }) =>
      api.post<{ data: CampaignProduct[] }>(
        `/sales-campaigns/${campaignId}/products/batch`,
        { items: [{ styled_id: styledId }] },
      ),
    onSuccess: (_data, { campaignId }) => {
      qc.invalidateQueries({
        queryKey: ["campaigns", "products", brand, campaignId],
      });
    },
  });
}

export function useAddBundleToCampaign() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({
      campaignId,
      campaignSlug,
      bundleOfferId,
    }: {
      campaignId: string;
      campaignSlug: string;
      bundleOfferId: string;
    }) =>
      api.post<{ bundle: Bundle; link: CampaignBundleLink }>(
        `/sales-campaigns/${campaignId}/bundles/import`,
        { source_bundle_offer_id: bundleOfferId, campaign_slug: campaignSlug },
      ),
    onSuccess: (_data, { campaignId }) => {
      qc.invalidateQueries({
        queryKey: ["campaigns", "campaign-bundles", brand, campaignId],
      });
      qc.invalidateQueries({ queryKey: ["campaigns", "bundles", brand] });
    },
  });
}

// ════════════════════════════════════════════════════════════
// Campaign products (styled-product links)
// ════════════════════════════════════════════════════════════

export function useCampaignProducts(campaignId: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "products", brand, campaignId],
    queryFn: () =>
      getListEnvelope<CampaignProduct>(
        `/sales-campaigns/${campaignId}/products`,
      ),
  });
}

export function useAddProductsBatch(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (
      items: Array<{
        styled_id?: string | null;
        product_id?: string | null;
        image_url?: string | null;
        regular_price_ngn?: number | null;
        regular_price_usd?: number | null;
        campaign_price_usd?: number | null;
        short_description?: string | null;
        long_description?: string | null;
        include_exclude?: string;
        is_featured?: boolean;
      }>,
    ) =>
      api.post<{ data: CampaignProduct[] }>(
        `/sales-campaigns/${campaignId}/products/batch`,
        { items },
      ),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["campaigns", "products", brand, campaignId],
      }),
  });
}

export function useRemoveCampaignProduct(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (linkId: string) =>
      api.delete<void>(`/sales-campaigns/${campaignId}/products/${linkId}`),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["campaigns", "products", brand, campaignId],
      }),
  });
}

/**
 * List the brand's catalogue bundles (retention bundle_offers) available to
 * import into the active campaign. Same source the user manages under
 * Catalogue → Bundles, so what they pick here matches what they see there.
 */
export function useCatalogueBundleSources() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["campaigns", "catalogue-bundles", brand],
    queryFn: () =>
      getListEnvelope<CatalogueBundleSource>(
        "/sales-campaigns/catalogue-bundles",
      ),
  });
}

/**
 * Import a single catalogue bundle into a campaign — attaches the campaign to
 * the Catalogue bundle_offer by reference (no copy). Later edits to the bundle
 * in Catalogue → Bundles reflect on the campaign live.
 */
export function useImportCatalogueBundle(
  campaignId: string | undefined,
  campaignSlug: string | undefined,
) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (source_bundle_offer_id: string) =>
      api.post<{
        bundle: Bundle;
        link: CampaignBundleLink;
      }>(`/sales-campaigns/${campaignId}/bundles/import`, {
        source_bundle_offer_id,
        campaign_slug: campaignSlug,
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["campaigns", "campaign-bundles", brand, campaignId],
      });
      qc.invalidateQueries({ queryKey: ["campaigns", "bundles", brand] });
    },
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
    queryFn: () =>
      getListEnvelope<QuantityTier>(`/sales-campaigns/${campaignId}/tiers`),
  });
}

export function useUpsertTier(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (
      body: Partial<QuantityTier> & {
        min_quantity: number;
        fixed_discount_ngn: number;
      },
    ) => api.post<QuantityTier>(`/sales-campaigns/${campaignId}/tiers`, body),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["campaigns", "tiers", brand, campaignId],
      }),
  });
}

export function useDeleteTier(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (tierId: string) =>
      api.delete<void>(`/sales-campaigns/${campaignId}/tiers/${tierId}`),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["campaigns", "tiers", brand, campaignId],
      }),
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
    queryFn: () =>
      getListEnvelope<CartUpsell>(`/sales-campaigns/${campaignId}/upsells`),
  });
}

export function useUpsertUpsell(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: Partial<CartUpsell>) =>
      api.post<CartUpsell>(`/sales-campaigns/${campaignId}/upsells`, body),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["campaigns", "upsells", brand, campaignId],
      }),
  });
}

export function useDeleteUpsell(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (upsellId: string) =>
      api.delete<void>(`/sales-campaigns/${campaignId}/upsells/${upsellId}`),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["campaigns", "upsells", brand, campaignId],
      }),
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
    queryFn: () =>
      getListEnvelope<AmbassadorContact>(
        `/sales-campaigns/ambassadors?${qs}`,
      ),
  });
}

export function usePromoteAmbassador() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: {
      contactId: string;
      profile?: Record<string, unknown>;
    }) =>
      api.post<AmbassadorContact>(
        `/sales-campaigns/ambassadors/${args.contactId}/promote`,
        args.profile || {},
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["campaigns", "ambassadors", brand] }),
  });
}

export function useCampaignAmbassadors(campaignId: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "campaign-ambassadors", brand, campaignId],
    queryFn: () =>
      getListEnvelope<CampaignAmbassador>(
        `/sales-campaigns/${campaignId}/ambassadors`,
      ),
  });
}

export function useAttachAmbassador(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: {
      contact_id: string;
      utm_source: string;
      commission_pct?: number | null;
    }) =>
      api.post<CampaignAmbassador>(
        `/sales-campaigns/${campaignId}/ambassadors`,
        body,
      ),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["campaigns", "campaign-ambassadors", brand, campaignId],
      }),
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
    queryFn: () =>
      getListEnvelope<VipGrant>(
        `/sales-campaigns/${campaignId}/vip-grants`,
      ),
  });
}

export function useGrantVip(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: { top_n?: number }) =>
      api.post<{ granted: number; lifetime_promoted: number }>(
        `/sales-campaigns/${campaignId}/vip-grants`,
        body,
      ),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["campaigns", "vip", brand, campaignId],
      }),
  });
}

export function useUpdateGiftStatus(campaignId: string | undefined) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: {
      grantId: string;
      gift_status: VipGrant["gift_status"];
    }) =>
      api.patch<VipGrant>(
        `/sales-campaigns/${campaignId}/vip-grants/${args.grantId}`,
        {
          gift_status: args.gift_status,
        },
      ),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["campaigns", "vip", brand, campaignId],
      }),
  });
}

// ════════════════════════════════════════════════════════════
// Praxis assist
// ════════════════════════════════════════════════════════════
export function usePraxisDraftCopy(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (body: {
      section: string;
      brief?: string;
      campaign_theme?: string;
      product_focus?: string;
      topics?: string[];
      tone_override?: string;
    }) =>
      api.post<PraxisDraft<Record<string, unknown>>>(
        `/sales-campaigns/${campaignId}/praxis/draft-copy`,
        body,
      ),
  });
}

export function usePraxisSuggestLayout(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (body: {
      campaign_type?: string;
      duration_hours?: number;
      product_focus?: string;
    }) =>
      api.post<PraxisLayout>(
        `/sales-campaigns/${campaignId}/praxis/suggest-layout`,
        body,
      ),
  });
}

export function usePraxisSuggestPricing(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (body: {
      target_margin_pct: number;
      include_charm_rounding?: boolean;
      inputs: Array<Record<string, unknown>>;
    }) =>
      api.post<PraxisPricingResult>(
        `/sales-campaigns/${campaignId}/praxis/suggest-pricing`,
        body,
      ),
  });
}

export function usePraxisDryRun(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (body: {
      question: string;
      proposed_price_ngn?: number;
      floor_ngn?: number;
    }) =>
      api.post<{ answer: string; citations: string[]; drafted_by_ai: boolean }>(
        `/sales-campaigns/${campaignId}/praxis/dry-run-pricing`,
        body,
      ),
  });
}

export function usePraxisAnalyticsQna(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (body: { question: string }) =>
      api.post<{
        answer: string;
        metrics: Record<string, unknown>;
        drafted_by_ai: boolean;
      }>(`/sales-campaigns/${campaignId}/praxis/analytics-qna`, body),
  });
}

export function usePraxisAccept(campaignId: string | undefined) {
  return useMutation({
    mutationFn: (body: {
      action_key: string;
      prompt?: string;
      draft: unknown;
      accepted: unknown;
    }) => api.post<void>(`/sales-campaigns/${campaignId}/praxis/accept`, body),
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
    queryFn: () =>
      api.get<{
        campaign_id: string;
        status: CampaignStatus;
        public_state: PublicState;
        rollups: Record<string, number>;
      }>(`/sales-campaigns/${campaignId}/metrics`),
    refetchInterval: 15_000,
  });
}

export function useCampaignDailyMetrics(
  campaignId: string | undefined,
  from?: string,
  to?: string,
) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "metrics-daily", brand, campaignId, qs.toString()],
    queryFn: () =>
      api.get<{ data: Array<Record<string, unknown>> }>(
        `/sales-campaigns/${campaignId}/metrics/daily?${qs}`,
      ),
  });
}

export function useShareKit(campaignId: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "share-kit", brand, campaignId],
    queryFn: () =>
      api.get<{
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
    queryFn: () =>
      api.get<{
        data: Array<Record<string, unknown>>;
        meta: Record<string, unknown>;
      }>(`/sales-campaigns/${campaignId}/signups?page=${page}`),
  });
}

// ════════════════════════════════════════════════════════════
// Landing image upload (hero / look-book) → returns a public URL
// ════════════════════════════════════════════════════════════
export async function uploadCampaignImage(
  campaignId: string,
  file: File,
): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const { url } = await api.postForm<{ url: string }>(
    `/sales-campaigns/${campaignId}/upload-image`,
    form,
  );
  return url;
}

// ════════════════════════════════════════════════════════════
// Public landing (no auth) — /api/public/sale/:slug
// ════════════════════════════════════════════════════════════
export interface PublicLanding {
  slug: string;
  name: string;
  state: PublicState;
  hero: {
    title: string | null;
    subtitle: string | null;
    image_url: string | null;
    cta_text: string | null;
  };
  countdown_to: string | null;
  countdown_message: string | null;
  signup_for_notifications: boolean;
  /** Static NGN-per-USD rate the customer-facing currency toggle uses.
   *  NULL = NGN only on this campaign (toggle hidden). */
  ngn_per_usd_rate: number | null;
  /** Top-level discount and per-position ladder — surfaced so the landing
   *  page can render a "save ₦X per wig" estimate on each product card. */
  discount_type?: DiscountType | null;
  discount_value?: number | null;
  position_ladder?: PositionLadderItem[] | null;
  blocks: LandingBlock[];
  products: Array<Record<string, unknown>>;
  ended: { message: string | null; redirect_to: string | null } | null;
  seo: {
    meta_title: string | null;
    meta_description: string | null;
    og_image_url: string | null;
  };
  /** Brand public identity attached by the API (withBrandInfo). Present once
   *  the campaign resolves to a brand; drives the public page's theme. */
  brand?: {
    business_key: string;
    display_name: string | null;
    storefront_domain: string | null;
    sales_subdomain: string | null;
  } | null;
}

/** Public landing payload. `brand` is required when not served from the sales
 *  subdomain (e.g. admin "Live view") so the API can resolve the campaign. */
export function usePublicLanding(slug: string | undefined, brand?: string) {
  const qs = brand ? `?brand=${encodeURIComponent(brand)}` : "";
  return useQuery({
    enabled: Boolean(slug),
    queryKey: ["public-landing", slug, brand || ""],
    queryFn: () => api.get<PublicLanding>(`/sale/${slug}${qs}`, "public"),
    retry: false,
  });
}

/** Detail payload for the landing-page product modal — gallery, long
 *  description, variants, and the brand's head-size guide + video. */
export interface PublicProductDetail {
  styled_id: string;
  name: string;
  slug: string;
  short_description: string | null;
  long_description: string | null;
  retail_price_ngn: number | null;
  anchor_price_ngn: number | null;
  gallery: Array<{
    url: string;
    alt_text: string | null;
    is_primary: boolean;
    display_order: number | null;
  }>;
  variants: Array<{
    variant_id: string;
    colour_name: string;
    colour_hex: string | null;
    colour_premium_ngn: number;
    size_code: string;
    size_label: string;
    size_premium_ngn: number;
    lace_code: string | null;
    lace_label: string | null;
    lace_premium_ngn: number;
    effective_price_ngn: number;
    is_default: boolean;
  }>;
  size_tiers: Array<{
    size_code: string;
    label: string;
    premium_ngn: number;
    circumference_in: string | null;
    guidance_text: string | null;
  }>;
  lace_sizes: Array<{
    lace_code: string;
    label: string;
    premium_ngn: number;
  }>;
  size_guide: {
    title: string;
    guide_md: string | null;
    video_url: string | null;
  } | null;
}

export function useProductDetail(
  slug: string | undefined,
  styledId: string | null,
  brand?: string,
) {
  const qs = brand ? `?brand=${encodeURIComponent(brand)}` : "";
  return useQuery({
    enabled: Boolean(slug && styledId),
    queryKey: ["public-product", slug, styledId, brand || ""],
    queryFn: () =>
      api.get<PublicProductDetail>(
        `/sale/${slug}/product/${styledId}${qs}`,
        "public",
      ),
    retry: false,
  });
}

/**
 * Absolute URL to a campaign's public sale page.
 *
 * Prefers the brand's configured sales subdomain (Settings → Business Setup →
 * Public Identity), then the storefront domain, so links like "View live page"
 * open the live sale site rather than the admin hub. Falls back to a
 * host-relative path (with a ?brand= hint so the API can resolve the brand)
 * only when neither domain is configured — e.g. local dev.
 */
export function publicSaleUrl(
  slug: string,
  opts?: {
    salesSubdomain?: string | null;
    storefrontDomain?: string | null;
    brand?: string;
  },
): string {
  const host = (opts?.salesSubdomain || opts?.storefrontDomain || "")
    .trim()
    .replace(/\/+$/, "");
  if (host) {
    const base = /^https?:\/\//i.test(host) ? host : `https://${host}`;
    return `${base}/sale/${slug}`;
  }
  return `/sale/${slug}${opts?.brand ? `?brand=${encodeURIComponent(opts.brand)}` : ""}`;
}

/**
 * Published brand-level Landing Studio config (no auth) — the source of the
 * public sale page's theme (palette, fonts). 404s (never published) surface as
 * an error so callers can fall back to the brand defaults via `withDefaults`.
 */
export function usePublicLandingConfig(brand?: string) {
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["public-landing-config", brand || ""],
    queryFn: () =>
      api.get<LandingConfig & { business_key: string }>(
        `/landing?brand=${encodeURIComponent(brand as string)}`,
        "public",
      ),
    retry: false,
  });
}

// ════════════════════════════════════════════════════════════
// Public storefront index (no auth) — /api/public/sale
// ════════════════════════════════════════════════════════════
export interface SalesIndexCampaign {
  slug: string;
  name: string;
  hero_image_url: string | null;
  og_image_url: string | null;
  hero_subtitle: string | null;
  starts_at: string;
  ends_at: string;
  state: PublicState;
}
export interface SalesIndex {
  brand: string;
  active: SalesIndexCampaign | null;
  upcoming: SalesIndexCampaign[];
  past: SalesIndexCampaign[];
}

export function usePublicSalesIndex(brand?: string) {
  const qs = brand ? `?brand=${encodeURIComponent(brand)}` : "";
  return useQuery({
    queryKey: ["public-sales-index", brand || ""],
    queryFn: () => api.get<SalesIndex>(`/sale${qs}`, "public"),
    retry: false,
  });
}

/** Brand-level "join the list" — reuses the public newsletter endpoint, which
 *  upserts a CRM contact (source='website'). Email + phone (WhatsApp) required. */
export async function subscribeSalesList(
  input: { email: string; phone: string; first_name?: string },
  brand?: string,
): Promise<void> {
  const qs = brand ? `?brand=${encodeURIComponent(brand)}` : "";
  await api.post(`/newsletter${qs}`, input, "public");
}

export function useLandingPreview(
  campaignId: string | undefined,
  state?: PublicState,
) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (state) qs.set("state", state);
  return useQuery({
    enabled: Boolean(brand && campaignId),
    queryKey: ["campaigns", "preview", brand, campaignId, state || "auto"],
    queryFn: () =>
      api.get<Record<string, unknown>>(
        `/sales-campaigns/${campaignId}/preview?${qs}`,
      ),
  });
}

// ════════════════════════════════════════════════════════════
// Public checkout (no auth) — POST /api/public/sale/:slug/checkout
// ════════════════════════════════════════════════════════════

export interface PublicCheckoutInput {
  slug: string;
  contact: {
    first_name: string;
    last_name?: string;
    email: string;
    phone: string;
    address: {
      line1: string;
      line2?: string;
      city: string;
      state?: string;
      country?: string;
    };
    consent: {
      terms_accepted: true;
      whatsapp_opt_in?: boolean;
      marketing_opt_in?: boolean;
    };
  };
  cart: Array<{
    product_id?: string;
    bundle_id?: string;
    quantity: number;
  }>;
  client_idempotency_key: string;
  payment_gateway?: "paystack" | "nomba";
}

export interface PublicCheckoutResult {
  order_id: string;
  payment_url: string | null;
  preorder?: Record<string, unknown> | null;
  notices?: string[];
}

export function usePublicCheckout(slug: string | undefined, brand?: string) {
  return useMutation({
    mutationFn: (input: Omit<PublicCheckoutInput, "slug">) => {
      const qs = brand ? `?brand=${encodeURIComponent(brand)}` : "";
      return api.post<PublicCheckoutResult>(
        `/sale/${slug}/checkout${qs}`,
        { ...input, slug },
        "public",
      );
    },
  });
}
