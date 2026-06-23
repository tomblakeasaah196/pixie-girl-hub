/**
 * Public landing types — shape of the response from
 * /api/public/sale/:slug on the Hub backend (see
 * src/modules/sales_campaigns/campaigns.public.service.js +
 * campaigns.service.buildLandingPayload).
 *
 * Kept generous (most fields optional) because the backend payload is
 * still evolving and the landing renders state-by-state.
 */

// ── Landing Studio config (published landing pages) ─────────────────
// The contract + helpers live in the shared @landing-kit package so the
// public page renders identically to the studio preview. Re-exported here
// so existing imports from "@/lib/types" keep working unchanged.
export type {
  ChannelOption,
  SocialLink,
  LandingTheme,
  RevealThreeD,
  LandingConfig,
} from "@landing-kit";
export { hexToTriplet, withDefaults, defaultConfig } from "@landing-kit";

export type LandingState = "before" | "live" | "ended";

export interface Hero {
  title?: string | null;
  subtitle?: string | null;
  image_url?: string | null;
  cta_text?: string | null;
}

export interface LandingBlock {
  key: string;
  type?: string;
  enabled?: boolean;
  props?: Record<string, unknown>;
  drafted_by_ai?: boolean;
  rationale?: string;
}

export interface LandingProduct {
  product_id?: string;
  styled_id?: string;
  category_id?: string | null;
  name?: string;
  short_description?: string | null;
  long_description?: string | null;
  campaign_price_ngn?: number | null;
  campaign_price_usd?: number | null;
  regular_price_ngn?: number | null;
  regular_price_usd?: number | null;
  is_featured?: boolean;
  stock_remaining?: number | null;
  image_url?: string | null;
}

export interface PositionLadderItem {
  position: number;
  discount_ngn: number;
  label?: string;
}

export interface StackingBonusConfig {
  min_distinct_bundles: number;
  discount_ngn: number;
  label?: string;
}

export interface BulkTierConfig {
  min_qty: number;
  discount_per_item_ngn: number;
  label?: string;
}

export interface LandingBundle {
  link_id: string;
  bundle_id: string;
  bundle_slug: string;
  bundle_name: string;
  bundle_hero_image_url?: string | null;
  campaign_bundle_price_ngn?: number | null;
  per_item_discount_ngn?: number | null;
  total_retail_ngn?: number | null;
  total_savings_ngn?: number | null;
  preorder_enabled?: boolean;
  preorder_price_ngn?: number | null;
  preorder_lead_weeks?: number | null;
  current_stock_snapshot?: number | null;
  starting_stock?: number | null;
  is_featured?: boolean;
}

export interface QuantityTier {
  tier_id: string;
  min_quantity: number;
  fixed_discount_ngn: number;
  label?: string | null;
}

export interface CartUpsellRung {
  upsell_id: string;
  rung: number;
  trigger_type: "cart_qty" | "cart_value" | "specific_bundle";
  min_cart_qty?: number | null;
  min_cart_value_ngn?: number | null;
  trigger_bundle_id?: string | null;
  offer_label: string;
  offer_subline?: string | null;
  reward_type: "fixed_amount" | "percentage" | "suggest_bundle";
  reward_value?: number | null;
  reward_bundle_id?: string | null;
}

export interface BrandPublic {
  business_key: string;
  display_name: string;
  storefront_domain?: string | null;
  sales_subdomain?: string | null;
  support_email?: string | null;
  /** Brand voice surfaced for footer microcopy. */
  praxis_voice_profile?: Record<string, unknown> | null;
  /** Smart-viewer policy defaults; per-campaign overrides land on the campaign. */
  show_viewer_count_policy?: "smart" | "on" | "off" | null;
  viewer_count_floor?: number | null;
}

export interface LandingPayload {
  slug: string;
  name: string;
  state: LandingState;
  starts_at: string;
  ends_at: string;
  hero: Hero;
  countdown_to: string | null;
  countdown_message?: string | null;
  signup_for_notifications: boolean;
  blocks: LandingBlock[];
  products: LandingProduct[];
  bundles?: LandingBundle[];
  tiers?: QuantityTier[];
  upsells?: CartUpsellRung[];
  ended?: { message?: string | null; redirect_to?: string | null } | null;
  next_campaign?: { slug: string; name: string; starts_at: string } | null;
  seo: {
    meta_title?: string | null;
    meta_description?: string | null;
    og_image_url?: string | null;
  };
  brand?: BrandPublic;
  /** Optional per-campaign overrides resolved server-side. */
  show_viewer_count_policy?: "smart" | "on" | "off" | null;
  viewer_count_floor?: number | null;
  exit_intent_enabled?: boolean;
  exit_intent_code?: string | null;
  exit_intent_discount_ngn?: number | null;
  abandonment_recovery_enabled?: boolean;
  allow_multi_currency_display?: boolean;
  /** Last-call surge window in minutes. Public renderer flips into the
   *  surge variant during the final N minutes before ends_at. */
  last_call_surge_minutes?: number;
  /** VIP early-access window (before public Live). */
  vip_early_access_minutes?: number;
  /** Delivery timeline — weeks for in-stock products. */
  delivery_weeks?: number | null;
  /** Extra weeks added for preorder items. */
  preorder_extra_weeks?: number;
  /** Per-position discount ladder for individual wig purchases. */
  position_ladder?: PositionLadderItem[] | null;
  /** Auto-apply bonus for combining bundles. */
  stacking_bonus?: StackingBonusConfig | null;
  /** Reseller/bulk tiers visible on landing page. */
  bulk_tiers?: BulkTierConfig[] | null;
  /** Static "1 USD = N NGN" rate the customer-facing currency toggle uses.
   *  Customer display only — order settlement uses the LIVE FX rate at
   *  payment. NULL = NGN-only, the toggle is hidden. */
  ngn_per_usd_rate?: number | null;
  /** Top-level discount + per-position ladder echo — surfaced so featured
   *  product cards can render a "save ₦X / wig" estimate. */
  discount_type?: string | null;
  discount_value?: number | null;
}
