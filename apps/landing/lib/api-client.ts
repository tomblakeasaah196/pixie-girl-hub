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
    const res = await fetch(`/api/public/sale/${encodeURIComponent(args.slug)}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: args.email,
        phone: args.phone,
        notify_via: args.notify_via || "email",
        source: args.source || "landing",
      }),
    });
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
    gift?: { recipient_name: string; recipient_phone?: string; message?: string };
    address: {
      line1: string;
      line2?: string;
      city: string;
      state: string;
      country?: string;
      lat?: number;
      lng?: number;
    };
    consent: {
      whatsapp_opt_in: boolean;
      marketing_opt_in: boolean;
      terms_accepted: boolean;
    };
  };
  cart: Array<{
    bundle_id?: string;
    product_id?: string;
    quantity: number;
    unit_price_ngn: number;
  }>;
  utm?: Record<string, string>;
  payment_gateway: "paystack" | "opay" | "nomba" | "stripe";
  client_idempotency_key: string;
}) {
  const res = await fetch(`/api/public/sale/${encodeURIComponent(args.slug)}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(err || `HTTP ${res.status}`);
  }
  return res.json();
}
