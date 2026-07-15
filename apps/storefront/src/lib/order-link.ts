import { api } from "@/lib/api";

/**
 * Order-link checkout API (the short `/o/<slug>` link a staffer shares from a
 * Smartcomm chat). The cart lives on the Hub in shared.smartcomm_order_links;
 * this storefront page resolves the slug, lets the customer pick + check out,
 * and redirects to the payment gateway. All three endpoints are public (no
 * login) and already live on the Hub:
 *   - GET  /api/public/order-link/:slug          → checkout context
 *   - POST /api/public/order-form                → raise the order
 *   - POST /api/public/pay/:tracking_token       → gateway checkout link
 */

export interface OrderLinkLine {
  variant_id: string;
  quantity: number;
}

export interface OrderLinkItem {
  kind: "base" | "styled" | "bundle" | "service";
  ref_id: string | null;
  name: string | null;
  product_code: string | null;
  image_url: string | null;
  qty: number;
  price_ngn: string | null;
  note: string | null;
  // Resolved sellable variant line(s); empty when the item can't be sold
  // (deleted/out-of-stock, non-live styled, broken bundle) — excluded from the
  // order and flagged for manual follow-up. Services carry no lines (bookings).
  lines: OrderLinkLine[];
  bundle_id?: string;
  service_id?: string;
  duration_minutes?: number | null;
}

export interface OrderLinkAddress {
  line1: string | null;
  line2: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  country_code: string | null;
  landmark: string | null;
}

export interface OrderLinkContact {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  primary_phone: string | null;
  whatsapp_number: string | null;
  email: string | null;
}

export interface OrderLinkContext {
  status?: "active" | "ordered";
  brand: string;
  slug?: string;
  link_id?: string;
  sales_channel: string | null;
  expires_at: string | null;
  fx_rate_ngn_per_usd?: number | null;
  contact: OrderLinkContact | null;
  require_contact_form?: boolean;
  delivery_address: OrderLinkAddress | null;
  items: OrderLinkItem[];
  notes: string | null;
  // Present when the link was already used (single-use).
  order_number?: string | null;
  ordered_at?: string | null;
}

export interface OrderFormResult {
  order_id: string | null;
  order_number: string | null;
  total_ngn: string | null;
  payment_plan: "full" | "instalment" | null;
  pay_now_ngn: string | null;
  // Gateway checkout URL minted server-side for an order-link checkout — the
  // page redirects straight here (Nomba). Null only when the gateway couldn't
  // be reached; the page then retries via the tracking token.
  payment_url: string | null;
  public_tracking_token: string | null;
  contact_id: string;
  booking_count: number;
}

export interface PayLinkResult {
  provider?: string;
  reference?: string;
  checkout_url?: string;
  amount_ngn?: string;
}

export interface OrderFormBody {
  first_name?: string;
  last_name?: string;
  phone: string;
  email?: string;
  whatsapp_number?: string;
  instagram_handle?: string;
  address?: {
    line1: string;
    area?: string;
    city?: string;
    state?: string;
    country?: string;
    country_code?: string;
    landmark?: string;
  };
  order_link_slug?: string;
  service_bookings?: {
    service_id: string;
    qty: number;
    price_ngn?: string;
    requested_for?: string;
    note?: string;
  }[];
  fulfilment_type: "delivery" | "pickup";
  zone_code?: string;
  delivery_address?: string;
  sales_channel: string;
  items: OrderLinkLine[];
  bundle_id?: string;
  payment_plan: "full" | "instalment";
  // Buyer's gateway pick (nomba | paystack) — server prefers it on the
  // active chain and falls over automatically if it's down.
  payment_gateway?: string;
  client_idempotency_key?: string;
}

/** Checkout-safe payment config for a brand+channel (Flexi Pay + gateways). */
export interface PayConfig {
  instalments_enabled: boolean;
  plan_display_name?: string;
  plan_terms?: string[];
  // Buyer-pickable gateways actually active for this brand (NGN chain),
  // in the server's preference order.
  gateways?: string[];
}

export const getPayConfig = (brand: string, channel: string) =>
  api.get<PayConfig>(
    `/api/public/pay/config/${encodeURIComponent(brand)}?channel=${encodeURIComponent(channel)}`,
  );

export const getOrderLink = (slug: string) =>
  api.get<OrderLinkContext>(
    `/api/public/order-link/${encodeURIComponent(slug)}`,
  );

export const submitOrderLinkOrder = (body: OrderFormBody) =>
  api.post<OrderFormResult>(`/api/public/order-form`, body);

export const createOrderPayLink = (token: string, amountNgn?: number) =>
  api.post<PayLinkResult>(
    `/api/public/pay/${encodeURIComponent(token)}`,
    amountNgn != null ? { amount_ngn: amountNgn } : {},
  );

export const reportOrderLinkActivity = (
  slug: string,
  cart: {
    kind: string;
    ref_id: string | null;
    name: string;
    qty: number;
    price_ngn: string | null;
  }[],
) =>
  api
    .post(`/api/public/order-link/${encodeURIComponent(slug)}/activity`, {
      cart,
    })
    .catch(() => {});
