"use client";

/**
 * Client-side helpers for POSTing to the Hub's public landing endpoints.
 *
 * All calls go to the same origin (`/api/public/...`) because the sales
 * subdomain is fronted by an edge that proxies `/api/*` to the Hub
 * backend. The host-→-brand resolver on the Hub already knows the brand
 * from the inbound Host header — no client-side branding needed.
 */

export async function postSignup(args: {
  slug: string;
  email?: string;
  phone?: string;
  notify_via?: "email" | "whatsapp" | "sms" | "both";
  source?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `/api/public/sale/${encodeURIComponent(args.slug)}/signup`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: args.email,
          phone: args.phone,
          notify_via: args.notify_via || "email",
          source: args.source || "landing",
        }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: err || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "Network error" };
  }
}

export async function postCheckout(args: {
  slug: string;
  contact: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    instagram_handle?: string;
    notes?: string;
    gift?: {
      recipient_name: string;
      recipient_phone?: string;
      message?: string;
      ship_to_recipient?: boolean;
      recipient_address?: {
        line1: string;
        line2?: string;
        city: string;
        state?: string;
        country?: string;
      };
    };
    address?: {
      line1: string;
      line2?: string;
      city: string;
      state?: string;
      country?: string;
      /** ISO-2 country (e.g. "GB") OR the NG delivery-zone code
       *  (state "NG-AB", Lagos LGA "NG-LA-AGEGE"). Drives the server-side
       *  delivery quote. */
      country_code?: string;
      zone_code?: string;
      landmark?: string;
    };
    consent: {
      whatsapp_opt_in: boolean;
      marketing_opt_in: boolean;
      terms_accepted: boolean;
    };
  };
  /** "delivery" ships to the address; "pickup" collects in store (no address,
   *  no delivery fee). Defaults to delivery on the Hub. */
  fulfilment_type?: "delivery" | "pickup";
  cart: Array<{
    bundle_id?: string;
    product_id?: string;
    styled_variant_id?: string;
    size_code?: string;
    quantity: number;
    unit_price_ngn: number;
  }>;
  utm?: Record<string, string>;
  payment_gateway: "paystack" | "nomba";
  /** Buyer-chosen display currency from the landing currency toggle. Drives
   *  gateway rail selection on the Hub (USD → Nomba). Order stays NGN-based. */
  display_currency?: "NGN" | "USD";
  client_idempotency_key: string;
  coupon_code?: string;
  /** Bypass the near-duplicate guard after the buyer has confirmed intent. */
  force_new_order?: boolean;
}) {
  const res = await fetch(
    `/api/public/sale/${encodeURIComponent(args.slug)}/checkout`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(args),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let parsed: { error?: { code?: string; message?: string; user_message?: string; retryable?: boolean; reference?: string; order_id?: string; support?: { whatsapp?: string; email?: string; message?: string } } } = {};
    try { parsed = JSON.parse(body); } catch { /* raw text fallback */ }
    const e = parsed?.error;
    // Attach structured fields so the checkout UI can render a proper error card.
    const msg = e?.user_message || e?.message || body || `HTTP ${res.status}`;
    const err = Object.assign(new Error(msg), {
      code: e?.code,
      retryable: e?.retryable ?? true,
      reference: e?.reference,
      order_id: e?.order_id,
      support: e?.support ?? null,
      existing_orders: (parsed as { error?: { existing_orders?: unknown } })?.error?.existing_orders ?? null,
    });
    throw err;
  }
  return res.json();
}

/** A single applied/next-rung deal component in the cart quote. */
export interface QuoteComponent {
  applied: boolean;
  discount_ngn: string;
  label?: string | null;
  // present on some components
  filled_positions?: number;
  per_item_ngn?: string;
  raw_wig_quantity?: number;
  tier_id?: string | null;
  next?: Record<string, unknown> | null;
}

export interface CartQuote {
  slug: string;
  currency: string;
  subtotal_ngn: string;
  components: {
    position_ladder: QuoteComponent;
    stacking_bonus: QuoteComponent;
    quantity_tier: QuoteComponent;
    bulk_tier: QuoteComponent;
  };
  cart: {
    total_quantity: number;
    styled_wig_units: number;
    raw_wig_quantity: number;
    distinct_bundles: number;
  };
  gross_discount_ngn: string;
  total_discount_ngn: string;
  final_total_ngn: string;
  clamped: boolean;
}

/**
 * Server-authoritative cart quote. The landing cart posts its current items on
 * every change to get the running total with EVERY deal rule applied (per-wig
 * position ladder + bundle stacking bonus + quantity-tier ladder +
 * reseller/bulk tiers, stacked and clamped at the margin floor). Prices are
 * resolved server-side — the client never computes the discount itself.
 */
export async function postQuote(args: {
  slug: string;
  cart: Array<{
    bundle_id?: string;
    product_id?: string;
    styled_variant_id?: string;
    unstyled?: boolean;
    size_code?: string;
    quantity: number;
  }>;
}): Promise<CartQuote | null> {
  try {
    const res = await fetch(
      `/api/public/sale/${encodeURIComponent(args.slug)}/quote`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ cart: args.cart }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: CartQuote };
    return json?.data ?? null;
  } catch {
    return null;
  }
}

export async function fetchOrderStatus(
  slug: string,
  orderId: string,
): Promise<{
  order_id: string;
  order_number: string;
  status: string;
  total_ngn: string;
  currency: string;
} | null> {
  try {
    const res = await fetch(
      `/api/public/sale/${encodeURIComponent(slug)}/order/${encodeURIComponent(orderId)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data ?? null;
  } catch {
    return null;
  }
}
