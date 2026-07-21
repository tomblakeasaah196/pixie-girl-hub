import { api, type ApiContext } from "./api";
import {
  formatCurrency,
  formatFromNgn,
  rateToNgn,
  type CurrencyInfo,
} from "./money";
import type { ContentBlock } from "./content-blocks";

/*
 * Storefront data layer - typed Hub calls + types. Replaces every Supabase
 * *.functions.ts. All pricing comes from the server (effective_price_*); the
 * UI only displays. Cart writes carry the sf_cart cookie automatically
 * (api uses credentials:"include").
 */

// A currency CODE. Widened from the old "NGN" | "USD" union so the storefront
// is parametric: any currency activated in admin (GBP/EUR/…) flows through the
// same types with no code change. The active set + rates come from the server
// currency feed (see getCurrencies / lib/money).
export type Currency = string;

/** In-stock / pre-order / sold-out state, computed server-side (000086).
 *  Universal pre-orders: an out-of-stock item is offered as a pre-order with a
 *  production window (`message`, e.g. "Made to order · ships in ~4–8 weeks"). */
export type AvailabilityState = "in_stock" | "preorder" | "out_of_stock";
export interface Availability {
  state: AvailabilityState;
  available: number;
  message?: string;
  window_label?: string | null;
  min_weeks?: number | null;
  max_weeks?: number | null;
  expected_ready_date?: string | null;
  production_lead_days?: number | null;
}

export interface ProductCard {
  styled_id: string;
  name: string;
  slug: string;
  short_description?: string | null;
  cover_image_url?: string | null;
  effective_price_ngn?: string | number | null;
  effective_price_usd?: string | number | null;
  availability?: Availability | null;
}

export interface VariantOption {
  styled_variant_id: string;
  colour_id: string;
  colour_name: string;
  colour_hex: string;
  size_code: string;
  size_label: string;
  lace_code?: string | null;
  lace_label?: string | null;
  effective_price_ngn: number;
  effective_price_usd?: number | null;
  is_default?: boolean;
}

export interface ProductDetail {
  styled_id: string;
  name: string;
  slug: string;
  short_description?: string | null;
  long_description?: string | null;
  availability?: Availability | null;
  retail_price_ngn?: string | number | null;
  retail_price_usd?: string | number | null;
  cover_image_url?: string | null;
  gallery: {
    url: string;
    alt_text?: string | null;
    styled_colour_id?: string | null;
  }[];
  colours: {
    colour_id: string;
    name: string;
    hex: string;
    is_default?: boolean;
    images?: { url: string }[];
  }[];
  variants: VariantOption[];
  size_tiers: {
    size_code: string;
    label: string;
    circumference_in?: string | null;
    guidance_text?: string | null;
  }[];
  lace_sizes: {
    lace_code: string;
    label: string;
    description?: string | null;
  }[];
  size_guide?: {
    title: string;
    guide_md?: string | null;
    video_url?: string | null;
  } | null;
  /** "As seen on Instagram" — the most recent proven (posted) Social Studio
   *  post tagging this product, or null if none has been proven yet. */
  social_proof?: {
    platform: "instagram" | "facebook" | "tiktok" | "youtube";
    url: string;
    thumbnail_url: string | null;
    author_handle: string | null;
  } | null;
  /** Merchandised video clips (YouTube/Reels/TikTok/direct upload) — shown
   *  alongside the photo gallery on the product detail page. */
  videos: {
    video_id: string;
    /** null → base-product video (shown for every colour); otherwise scoped to
     *  the matching colour swatch, like that colour's pictures. */
    styled_colour_id?: string | null;
    source: "youtube" | "instagram_reel" | "tiktok" | "direct_upload";
    external_ref: string;
    embed_url: string;
    thumbnail_url?: string | null;
    title?: string | null;
    caption?: string | null;
    duration_seconds?: number | null;
    is_primary?: boolean;
  }[];
  /** "You May Also Love" — curated + auto-filled related products. */
  related_products: ProductCard[];
}

export interface CartItem {
  cart_item_id: string;
  styled_variant_id?: string | null;
  bundle_id?: string | null;
  product_id?: string | null;
  unstyled?: boolean;
  quantity: number;
  product_name_snapshot: string;
  variant_label_snapshot?: string | null;
  thumbnail_url_snapshot?: string | null;
  unit_price_ngn: string | number;
  unit_display_price?: string | number | null;
  display_currency?: string;
  /** In-stock / pre-order / sold-out state for this line, resolved to the base
   *  product behind it server-side (000086). */
  availability?: Availability | null;
}

export interface Cart {
  cart_id?: string;
  items: CartItem[];
  applied_coupon_id?: string | null;
  applied_coupon_code?: string | null;
}

export interface Quote {
  lines: {
    cart_item_id: string;
    name: string;
    variant_label?: string | null;
    quantity: number;
    unit_price_ngn: string;
    line_total_ngn: string;
  }[];
  subtotal_ngn: string;
  discount_ngn?: string;
  delivery_ngn: string;
  total_ngn: string;
  display_currency: Currency;
  subtotal_display?: string | null;
  discount_display?: string | null;
  delivery_display?: string | null;
  total_display?: string | null;
  fx_rate_used?: number | null;
  applied_coupon_code?: string | null;
}

const SF = "/api/public/storefront";

// --- Catalogue ---
export const getProducts = (qs = "", ctx?: ApiContext) =>
  api.get<ProductCard[] | { data: ProductCard[] }>(`${SF}/products${qs}`, ctx);
export const getProduct = (slug: string, ctx?: ApiContext) =>
  api.get<ProductDetail>(`${SF}/products/${slug}`, ctx);
export const getShades = (ctx?: ApiContext) =>
  api.get<
    {
      shade_id: string;
      name: string;
      slug: string;
      short_description?: string;
      cover_image_url?: string;
      product_count?: number;
    }[]
  >(`${SF}/shades`, ctx);
export const getShade = (slug: string, ctx?: ApiContext) =>
  api.get<{ name: string; long_description?: string; products: ProductCard[] }>(
    `${SF}/shades/${slug}`,
    ctx,
  );
export const getCollections = (ctx?: ApiContext) =>
  api.get<
    {
      collection_id: string;
      name: string;
      slug: string;
      description?: string;
      display_image_url?: string;
    }[]
  >(`${SF}/collections`, ctx);
export const getCollection = (slug: string, ctx?: ApiContext) =>
  api.get<{ name: string; description?: string; products: ProductCard[] }>(
    `${SF}/collections/${slug}`,
    ctx,
  );
export const getBundles = (ctx?: ApiContext) =>
  api.get<
    {
      bundle_id: string;
      bundle_code: string;
      display_name: string;
      description?: string;
      pricing_model?: string;
      discount_value?: string | number | null;
      bundle_price_ngn?: string;
      hero_image_url?: string;
      components?: {
        name?: string;
        slug?: string;
        image_url?: string;
        quantity?: number;
        role?: string;
        price_ngn?: string;
      }[];
      /** Bundle-level in-stock / pre-order / sold-out state (000086). */
      availability?: Availability | null;
    }[]
  >(`${SF}/bundles`, ctx);
export const getBundleDetail = (slug: string, ctx?: ApiContext) =>
  api.get<{
    bundle_id: string;
    bundle_code: string;
    display_name: string;
    description?: string;
    bundle_price_ngn?: string;
    hero_image_url?: string;
    components: {
      name?: string;
      slug?: string;
      image_url?: string;
      quantity?: number;
      role?: string;
      price_ngn?: string;
    }[];
    /** Bundle-level in-stock / pre-order / sold-out state (000086). */
    availability?: Availability | null;
  }>(`${SF}/bundles/${slug}`, ctx);

// --- Services (bookable offerings) ---
export interface ServiceCard {
  service_id: string;
  name: string;
  slug: string;
  short_description?: string | null;
  base_price_ngn?: string | number | null;
  base_price_usd?: string | number | null;
  compare_at_price_ngn?: string | number | null;
  price_is_from?: boolean;
  duration_minutes?: number | null;
  tags?: string[] | null;
  cover_image_url?: string | null;
  deposit_required?: boolean;
  deposit_pct?: number | null;
}
export interface ServiceDetail extends ServiceCard {
  long_description?: string | null;
  sale_mode?: "book" | "buy" | "enquire";
  location_type?: string | null;
  buffer_minutes?: number | null;
  cancellation_policy?: string | null;
  whats_included?: string[] | null;
  faqs?: { q: string; a: string }[] | null;
}
export interface BookingInput {
  full_name: string;
  phone?: string;
  email?: string;
  preferred_date?: string;
  preferred_time?: string;
  notes?: string;
  source?: string;
}
export const getServices = (ctx?: ApiContext) =>
  api.get<ServiceCard[]>(`/api/public/services`, ctx);
export const getService = (slug: string, ctx?: ApiContext) =>
  api.get<ServiceDetail>(`/api/public/services/${slug}`, ctx);
export const requestBooking = (slug: string, body: BookingInput) =>
  api.post<{ booking_request_id?: string; message?: string }>(
    `/api/public/services/${slug}/book`,
    { ...body, source: body.source || "storefront" },
  );

// --- Reviews ---
export interface Review {
  review_id: string;
  rating: number;
  title?: string | null;
  body?: string | null;
  photo_urls: string[];
  is_verified_purchase: boolean;
  created_at: string;
  author: string;
}
export const getReviews = (slug: string, ctx?: ApiContext) =>
  api.get<{
    summary: {
      count: number;
      average: number;
      breakdown: Record<number, number>;
    };
    reviews: Review[];
  }>(`${SF}/products/${slug}/reviews`, ctx);
export const submitReview = (body: {
  product_slug: string;
  rating: number;
  title?: string;
  body?: string;
  photo_urls?: string[];
}) => api.post<{ review_id: string; status: string; message: string }>(
  `${SF}/reviews`,
  body,
);

/** Upload review photos (signed-in customer). Returns the stored public URLs
 *  to submit with submitReview({ photo_urls }). */
export const uploadReviewPhotos = (files: File[]) => {
  const form = new FormData();
  for (const f of files) form.append("photos", f);
  return api.postForm<{ photos: { url: string }[] }>(`${SF}/reviews/photos`, form);
};

export const getContentPost = (type: string, slug: string, ctx?: ApiContext) =>
  api.get<{
    title: string;
    body_md?: string;
    body_html?: string;
    cover_image_url?: string;
    content_blocks?: ContentBlock[];
    tags?: string[];
    published_at?: string;
  }>(`${SF}/content/${type}/${slug}`, ctx);
export const getContentList = (type: string, ctx?: ApiContext) =>
  api.get<
    {
      slug: string;
      title: string;
      excerpt?: string;
      cover_image_url?: string;
      tags?: string[];
      published_at?: string;
    }[]
  >(`${SF}/content/${type}`, ctx);

// Newsletter signup → becomes a CRM contact (source='website') on the Hub.
export const subscribeNewsletter = (
  email: string,
  extra?: { phone?: string; first_name?: string; notify_via?: "email" | "whatsapp" | "both" },
) =>
  api.post<{ contact_id: string; created: boolean }>(`/api/public/newsletter`, {
    email,
    ...extra,
  });

export const getInstallHub = (token: string, ctx?: ApiContext) =>
  api.get<{
    order_number: string;
    items: { name: string }[];
    care_guides: { slug: string; title: string }[];
    whatsapp_help_url?: string;
    delivery_city?: string | null;
  }>(`/api/public/install-hub/${token}`, ctx);

// --- Cart ---
export const getCart = () => api.get<Cart>(`${SF}/cart`);
export const ensureCart = () => api.post<Cart>(`${SF}/cart`);
export const addCartItem = (body: {
  styled_variant_id?: string;
  bundle_id?: string;
  product_id?: string;
  unstyled?: boolean;
  quantity?: number;
  display_currency?: Currency;
}) => api.post<CartItem>(`${SF}/cart/items`, body);
export const updateCartItem = (id: string, quantity: number) =>
  api.patch<CartItem>(`${SF}/cart/items/${id}`, { quantity });
export const removeCartItem = (id: string) =>
  api.delete<{ removed: boolean }>(`${SF}/cart/items/${id}`);
export const applyCoupon = (code: string) =>
  api.post<Cart>(`${SF}/cart/coupon`, { code });
export const quoteCart = (body: { address?: unknown; display_currency?: Currency }) =>
  api.post<Quote>(`${SF}/cart/quote`, body);

// --- Checkout / tracking ---
export interface CheckoutInput {
  contact: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    notes?: string;
    address?: {
      line1: string;
      line2?: string;
      city: string;
      state?: string;
      country?: string;
      country_code?: string;
      zone_code?: string;
    };
  };
  fulfilment_type?: "delivery" | "pickup";
  display_currency?: Currency;
  payment_gateway?: string;
  coupon_code?: string;
  customer_referral_code?: string;
  redeem_points?: number;
  client_idempotency_key: string;
}
/** Pre-order notice threaded off the created order (000086). Present only when
 *  a line went in as made-to-order. */
export interface PreorderNoticeData {
  is_preorder: boolean;
  line_count: number;
  names?: string[];
  window_label?: string | null;
  min_weeks?: number | null;
  max_weeks?: number | null;
  ready_by?: string | null;
  message?: string;
}

export const checkout = (body: CheckoutInput) =>
  api.post<{
    order_id: string;
    order_number: string;
    payment_url: string;
    public_tracking_token: string;
    preorder?: PreorderNoticeData | null;
  }>(`${SF}/checkout`, body);

export const getDeliveryQuote = (params: string) =>
  api.get<{ fee_ngn: number | null; fee_status?: string; zone_name?: string }>(
    `${SF}/delivery/quote${params}`,
  );

// Parametric currency feed: the active display currencies + their SSOT rates +
// settlement flags + the geo default. Drives the currency toolbar and the
// render-time price conversion (see lib/money).
export interface CurrencyFeed {
  base: string;
  default: string;
  currencies: CurrencyInfo[];
}
export const getCurrencies = (ctx?: ApiContext) =>
  api.get<CurrencyFeed>(`${SF}/currencies`, ctx);

export const trackOrder = (token: string, ctx?: ApiContext) =>
  api.get<unknown>(`/api/public/order-timeline/${token}`, ctx);

// --- Driver delivery confirmation (no auth, token-scoped) ---
export interface DriverDelivery {
  delivery_id: string;
  delivery_number: string;
  status: string;
  driver_name?: string | null;
  driver_phone?: string | null;
  recipient_name_snapshot?: string | null;
  recipient_phone_snapshot?: string | null;
  delivery_address_snapshot?: Record<string, unknown> | null;
  delivery_instructions?: string | null;
  scheduled_pickup_at?: string | null;
  expected_delivery_at?: string | null;
  delivered_at?: string | null;
  courier_name?: string | null;
}

export const getDriverDelivery = (token: string, ctx?: ApiContext) =>
  api.get<DriverDelivery>(`/api/public/tracking/driver/${token}`, ctx);

export const confirmDriverDelivery = (
  token: string,
  form: FormData,
  ctx?: ApiContext,
) => api.postForm<unknown>(`/api/public/tracking/driver/${token}/confirm`, form, ctx);

// --- Helpers ---
export function unwrap<T>(r: T | { data: T }): T {
  return r && typeof r === "object" && "data" in (r as object)
    ? (r as { data: T }).data
    : (r as T);
}

/**
 * Display a catalogue card's price in `currency`. Parametric: converts from the
 * NGN anchor via the active SSOT rate (landing parity — rounds up to the whole
 * unit, matching what the gateway charges), so ANY activated currency renders.
 * Before the currency feed hydrates it prefers a precomputed USD column, then
 * falls back to NGN so a price is never blank.
 */
export function priceFor(
  card: {
    effective_price_ngn?: string | number | null;
    effective_price_usd?: string | number | null;
    retail_price_ngn?: string | number | null;
    retail_price_usd?: string | number | null;
  },
  currency: Currency,
): string {
  const ngnRaw = card.effective_price_ngn ?? card.retail_price_ngn;
  const ngn = ngnRaw == null ? null : Number(ngnRaw);
  if (currency === "NGN")
    return ngn != null && Number.isFinite(ngn) ? formatFromNgn(ngn, "NGN") : "-";
  // Foreign: live-convert from NGN via the SSOT rate once the feed has loaded.
  if (ngn != null && Number.isFinite(ngn) && rateToNgn(currency) != null)
    return formatFromNgn(ngn, currency);
  // Pre-hydration / no rate: fall back to a precomputed USD column if present.
  const preRaw = card.effective_price_usd ?? card.retail_price_usd;
  const pre = preRaw == null ? null : Number(preRaw);
  if (pre != null && Number.isFinite(pre)) return formatCurrency(pre, currency);
  return ngn != null && Number.isFinite(ngn) ? formatFromNgn(ngn, "NGN") : "-";
}

/** Format an amount ALREADY denominated in `currency` (e.g. a server-provided
 *  *_display figure, or a NGN figure with currency "NGN"). No conversion. */
export function fmt(
  amount: string | number | null | undefined,
  currency: Currency,
): string {
  if (amount === null || amount === undefined) return "-";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "-";
  return formatCurrency(n, currency);
}
