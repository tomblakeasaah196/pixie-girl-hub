export type OrderStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "in_production"
  | "awaiting_dispatch"
  | "partially_fulfilled"
  | "fulfilled"
  | "completed"
  | "cancelled"
  | "cancellation_requested";

export type QuoteStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "accepted"
  | "rejected"
  | "expired"
  | "converted"
  | "cancelled";

export type SalesChannel =
  | "storefront"
  | "pos"
  | "woocommerce"
  | "instagram"
  | "whatsapp"
  | "wholesale"
  | "partner"
  | "stylist_routed"
  | "subscription"
  | "phone"
  | "event"
  | "public_form"
  | "facebook"
  | "tiktok"
  | "intercompany";

export type FulfilmentType = "walk_in" | "dispatch" | "digital" | "collection";

export type PaymentMethod =
  | "paystack_card"
  | "paystack_transfer"
  | "paystack_ussd"
  | "opay"
  | "nomba_terminal"
  | "bank_transfer"
  | "cash"
  | "pos_card"
  | "pay_on_delivery"
  | "wallet"
  | "points"
  | "subscription_recurring";

export type PaymentPath =
  | "tokenized_link"
  | "customer_account"
  | "staff_recorded"
  | "pos"
  | "intercompany"
  | "subscription_charge";

export type CancellationCategory =
  | "changed_mind"
  | "wrong_item"
  | "delay"
  | "price"
  | "other";

export interface OrderLine {
  line_id: string;
  order_id: string;
  product_id: string;
  variant_id: string;
  product_name_snapshot: string;
  variant_label_snapshot: string | null;
  sku_snapshot: string | null;
  quantity: number;
  unit_price_ngn: string;
  unit_cost_ngn: string | null;
  line_discount_ngn: string;
  tax_rate: string;
  tax_amount_ngn: string;
  line_total_ngn: string;
  display_order: number;
  notes: string | null;
}

export interface OrderPayment {
  payment_id: string;
  payment_number: string;
  order_id: string;
  method: PaymentMethod;
  provider: string | null;
  provider_reference: string | null;
  amount_ngn: string;
  paid_currency: string | null;
  paid_amount: string | null;
  fx_rate_used: string | null;
  fee_ngn: string | null;
  payment_path: PaymentPath | null;
  status: string;
  captured_at: string;
  created_at: string;
}

export interface OrderDiscount {
  discount_id: string;
  order_id: string;
  source: string;
  source_reference: string | null;
  sales_campaign_id: string | null;
  applied_to_line_id: string | null;
  amount_ngn: string;
  discount_type: string | null;
  applied_at: string;
}

export interface SalesOrder {
  order_id: string;
  order_number: string;
  contact_id: string;
  contact_name?: string;
  contact_phone?: string | null;
  contact_whatsapp?: string | null;
  contact_email?: string | null;
  sales_channel: SalesChannel;
  order_type: FulfilmentType;
  is_custom_order: boolean;
  sales_campaign_id: string | null;
  status: OrderStatus;
  subtotal_ngn: string;
  discount_amount_ngn: string;
  tax_amount_ngn: string;
  shipping_fee_ngn: string;
  total_ngn: string;
  amount_paid_ngn: string;
  balance_due_ngn: string;
  display_currency: string | null;
  display_total: string | null;
  fx_rate_used: string | null;
  coupon_code: string | null;
  payment_model: string | null;
  required_deposit_pct: string | null;
  required_deposit_ngn: string | null;
  deposit_met_at: string | null;
  public_tracking_token: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  lines?: OrderLine[];
  payments?: OrderPayment[];
  discounts?: OrderDiscount[];
}

export interface QuotationLine {
  line_id: string;
  quotation_id: string;
  variant_id: string;
  product_name_snapshot: string;
  variant_label_snapshot: string | null;
  sku_snapshot: string | null;
  quantity: number;
  unit_price_ngn: string;
  line_discount_ngn: string;
  tax_rate: string;
  tax_amount_ngn: string;
  line_total_ngn: string;
  notes: string | null;
}

export interface Quotation {
  quotation_id: string;
  quotation_number: string;
  contact_id: string;
  contact_name?: string;
  deal_id: string | null;
  status: QuoteStatus;
  subtotal_ngn: string;
  discount_amount_ngn: string;
  tax_amount_ngn: string;
  shipping_fee_ngn: string;
  total_ngn: string;
  delivery_type: FulfilmentType | null;
  valid_until: string | null;
  payment_terms: string | null;
  notes: string | null;
  internal_notes: string | null;
  sent_via: string | null;
  sent_at: string | null;
  converted_sales_order_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  lines?: QuotationLine[];
}

export interface TimelineEvent {
  event_id: string;
  event_code: string;
  label: string;
  // shared.order_timeline_events stores the customer/internal payloads and the
  // event time as `occurred_at` (NOT `created_at`). Reading the wrong field is
  // what rendered "Invalid Date" in the order timeline.
  customer_payload: Record<string, unknown> | null;
  internal_payload: Record<string, unknown> | null;
  is_customer_visible: boolean;
  recorded_by: string | null;
  occurred_at: string;
  recorded_at?: string;
}

export interface SalesKpis {
  orders_mtd: number;
  revenue_mtd: string;
  pending_payment_count: number;
  avg_order_value: string;
  open_quotes: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; page_size: number; total: number; has_more: boolean };
}

// ── Input types ─────────────────────────────────────────────

export interface OrderCreateInput {
  contact_id: string;
  sales_channel: SalesChannel;
  order_type?: FulfilmentType;
  is_custom_order?: boolean;
  lines: Array<{
    variant_id: string;
    quantity: number;
    unit_price_ngn?: number;
    notes?: string;
  }>;
  sales_campaign_id?: string;
  campaign_slug?: string;
  coupon_code?: string;
  redeem_points?: number;
  bundle_id?: string;
  client_idempotency_key?: string;
  shipping_fee_ngn?: number;
  required_deposit_pct?: number;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

export interface PaymentCreateInput {
  method: PaymentMethod;
  amount_ngn: number;
  provider?: string;
  provider_reference?: string;
  paid_currency?: string;
  paid_amount?: number;
  fx_rate_used?: number;
  fee_ngn?: number;
  payment_path?: PaymentPath;
  client_idempotency_key?: string;
}

export interface PaymentLinkInput {
  amount_ngn?: number;
  currency?: string;
}

export interface QuotationCreateInput {
  contact_id: string;
  deal_id?: string;
  lines: Array<{
    variant_id: string;
    quantity: number;
    unit_price_ngn?: number;
    line_discount_ngn?: number;
    notes?: string;
  }>;
  valid_until?: string;
  payment_terms?: string;
  notes?: string;
  internal_notes?: string;
  delivery_type?: FulfilmentType;
  coupon_code?: string;
  shipping_fee_ngn?: number;
}

export interface QuotationSendInput {
  sent_via?: "whatsapp" | "email" | "instagram_dm" | "pdf_print" | "sms";
}

export interface QuotationConvertInput {
  sales_channel?: SalesChannel;
}

export interface CancellationRequestInput {
  reason: string;
  reason_category?: CancellationCategory;
  requested_by_contact_id?: string;
}
