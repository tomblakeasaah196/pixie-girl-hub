/**
 * Public landing types — shape of the response from
 * /api/public/sale/:slug on the Hub backend (see
 * src/modules/sales_campaigns/campaigns.public.service.js +
 * campaigns.service.buildLandingPayload).
 *
 * Kept generous (most fields optional) because the backend payload is
 * still evolving and the landing renders state-by-state.
 */

// Landing Studio config type (published landing pages)
export type ChannelOption = "email" | "whatsapp" | "both";

export interface SocialLink {
  platform: string;
  href: string;
  label?: string;
}

export interface LandingTheme {
  ink: string;
  paper: string;
  primary: string;
  primaryDeep: string;
  accent: string;
  muted: string;
  glow: string;
}

export interface RevealThreeD {
  enabled: boolean;
  brandType: "pixiegirl" | "faitlynhair";
  variant: "text-dual" | "logo-static";
  rotationSpeed: number;
  glowIntensity: number;
}

export interface LandingConfig {
  brandName: string;
  legalName: string;
  tagline: string;
  welcomeLine: string;
  domain: string;
  storefront: string;
  address: string;
  theme: LandingTheme;
  three: { primary: string; accent: string; ink: string; metal: string };
  background: { type: "color" | "image"; imageUrl: string | null };
  logo: {
    url: string | null;
    headerTint: string | null;
    footerTint: string | null;
    headerScale: number;
    footerScale: number;
  };
  hero: {
    imageUrl: string | null;
    eyebrow: string;
    headline: string;
    headlineAccent: string;
    body: string;
    ctaLabel: string;
    launchSeasonLabel: string;
  };
  invitation: {
    eyebrow: string;
    heading: string;
    headingAccent: string;
    body: string;
    seatsTotal: number;
    seatsClaimedBase: number;
    perks: { numeral: string; label: string }[];
    formTitle: string;
    formTitleAccent: string;
    formEyebrow: string;
    referralNote: string;
  };
  form: {
    collectName: boolean;
    collectEmail: boolean;
    collectWhatsapp: boolean;
    collectReferral: boolean;
    channels: ChannelOption[];
    submitLabel: string;
    footnote: string;
  };
  galleryEyebrow: string;
  galleryHeading: string;
  gallery: { url: string; caption?: string }[];
  pillars: { numeral: string; title: string; body: string }[];
  socials: SocialLink[];
  reveal: {
    enabled: boolean;
    tagline: string;
    showScarcity: boolean;
    threeD?: RevealThreeD;
  };
}

export function hexToTriplet(hex: string | null | undefined): string {
  const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
  if (!hex || !HEX_RE.test(hex)) return "0 0 0";
  const h = hex.replace("#", "");
  return `${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)}`;
}

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
  category_id?: string | null;
  name?: string;
  campaign_price_ngn?: number | null;
  regular_price_ngn?: number | null;
  is_featured?: boolean;
  stock_remaining?: number | null;
  image_url?: string | null;
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
}
