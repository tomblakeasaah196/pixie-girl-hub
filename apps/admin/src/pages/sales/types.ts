export type OrderStatus =
  | "pending_payment"
  | "partially_paid"
  | "paid"
  | "assigned"
  | "order_ready"
  | "dispatched"
  | "completed"
  | "cancellation_requested"
  | "cancelled"
  // Rare/legacy side-states — never produced by the current flow, kept so old
  // rows and refunds still render.
  | "draft"
  | "refunded"
  | "failed";

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
  | "intercompany"
  | "sales_campaign"
  | "walk_in";

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
  // Stylist Studio provenance — 'styled'/'service' drives Studio auto-open,
  // 'product' is a plain wig sale that needs no styling work.
  line_kind?: "product" | "styled" | "bundle" | "service" | null;
  styled_id?: string | null;
  service_offering_id?: string | null;
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
  // Acceptance trail — who took the money and when. Stamped server-side on
  // every payment; `recorded_by_name` is resolved from the staff profile and
  // is null for gateway captures that no human recorded.
  recorded_by: string | null;
  recorded_by_name: string | null;
  recorded_at: string;
  manual_bank_transaction_id: string | null;
  manual_bank_name: string | null;
  manual_recorded_by: string | null;
  notes: string | null;
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
  /** The order's invoice, joined into list rows for the deep-link column. */
  invoice_id?: string | null;
  invoice_number?: string | null;
  invoice_status?: string | null;
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
  /** Flexi Pay: the buyer's explicit plan choice ('full' | 'instalment'). */
  payment_plan: string | null;
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
  /** Set when the order was cancelled — surfaced in the Orders archive so an
   *  operator can see when and why before restoring. `SELECT so.*` already
   *  returns both; they were simply absent from this type. */
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  /** Pre-orders (000086): order carries a made-to-order line; ready_by is the
   *  deadline shown in the Pre-orders tab (placement + max production weeks). */
  is_preorder?: boolean;
  preorder_ready_by?: string | null;
  preorder_min_weeks?: number | null;
  preorder_max_weeks?: number | null;
  /** Pre-order confirmation returned by createOrder (000086) — present only when
   *  a line actually went in as made-to-order, so Quick Sale can toast it. */
  preorder?: {
    is_preorder: boolean;
    line_count: number;
    names?: string[];
    window_label?: string | null;
    message?: string;
  } | null;
  /** Distinct line kinds on the order (list endpoint only) — drives the
   *  register's Kind column: base product vs styled vs service vs bundle. */
  line_kinds?: Array<"product" | "styled" | "bundle" | "service"> | null;
  /** Per-line name + quantity summary (list endpoint only) — drives the
   *  register's Products column so staff can read the actual item names
   *  (styled / base product / service / bundle) without opening the order. */
  line_items?: Array<{
    name: string;
    variant: string | null;
    quantity: number;
    kind: "product" | "styled" | "bundle" | "service" | null;
  }> | null;
  /** Change Order (§6.2): how many times this order has been amended, and when
   *  the last one landed. Denormalised onto the order so the register can badge
   *  an amended row and the detail page knows to render the history card. */
  amendment_count?: number | null;
  last_amended_at?: string | null;
  /** Frozen delivery address the fulfilment reads — the Change Order modal
   *  seeds its address fields from this. */
  delivery_address_snapshot?: DeliveryAddress | null;
  customer_notes?: string | null;
  lines?: OrderLine[];
  payments?: OrderPayment[];
  discounts?: OrderDiscount[];
}

// ── Change Order (§6.2 amendments) ──────────────────────────

/** The order's frozen delivery address. All fields optional — older orders and
 *  walk-ins carry partial (or no) snapshots. */
export interface DeliveryAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  country_code?: string | null;
  zone_code?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
}

/**
 * One line in a Change Order payload. `line_id` present = keep this existing
 * line (possibly at a new quantity or price); absent = add it. The payload is
 * DECLARATIVE — it is the order's complete new line set, so an existing line
 * simply left out is the instruction to remove it.
 */
export interface AmendmentLineInput {
  line_id?: string;
  variant_id?: string;
  service_offering_id?: string;
  styled_id?: string;
  line_kind?: "product" | "styled" | "bundle" | "service";
  quantity: number;
  unit_price_ngn?: number;
  notes?: string;
  product_name_snapshot?: string;
  variant_label_snapshot?: string;
  sku_snapshot?: string;
}

export type AmendmentReasonCategory =
  | "wrong_item"
  | "customer_change"
  | "price_correction"
  | "delivery_change"
  | "stock_substitution"
  | "other";

export interface AmendmentPreviewInput {
  lines: AmendmentLineInput[];
  shipping_fee_ngn?: number;
  order_type?: FulfilmentType;
  delivery_address?: DeliveryAddress;
  customer_notes?: string;
}

export interface AmendmentInput extends AmendmentPreviewInput {
  reason: string;
  reason_category?: AmendmentReasonCategory;
  acknowledge_warnings?: boolean;
  /** Default true — the customer hears about the change unless suppressed. */
  notify_customer?: boolean;
}

/** A consequence the operator must positively acknowledge before committing.
 *  Not an error: each one describes a real, permitted effect of amending an
 *  order this far along. */
export interface AmendmentWarning {
  code: string;
  message: string;
  details?: unknown;
}

/** One entry in the change list — what actually moved on the order. */
export interface AmendmentLineChange {
  action: "added" | "removed" | "quantity" | "price";
  line_id?: string;
  name: string;
  quantity?: number;
  unit_price_ngn?: string;
  from?: number;
  to?: number;
}

export interface AmendmentMoney {
  subtotal_ngn: string;
  discount_amount_ngn: string;
  tax_amount_ngn: string;
  shipping_fee_ngn: string;
  total_ngn: string;
}

export interface AmendmentDeliverySnapshot {
  order_type: string;
  shipping_fee_ngn: string;
  address: DeliveryAddress | null;
}

/** Dry run: everything the change would do, computed without writing. */
export interface AmendmentPreview {
  order_id: string;
  order_number: string;
  status: OrderStatus;
  /** The sale journal is already on the books — the change posts a GL delta. */
  revenue_recognised: boolean;
  changed: boolean;
  before: AmendmentMoney;
  after: AmendmentMoney;
  /** Positive = the customer owes more; negative = a credit is due. */
  difference_ngn: string;
  amount_paid_ngn: string;
  balance_after_ngn: string;
  line_changes: AmendmentLineChange[];
  lines_after: Array<{
    line_id: string | null;
    product_name_snapshot: string;
    variant_label_snapshot: string | null;
    sku_snapshot: string | null;
    quantity: number;
    unit_price_ngn: string;
    line_discount_ngn: string;
    tax_amount_ngn: string;
    line_total_ngn: string;
    line_kind: string | null;
  }>;
  delivery_before: AmendmentDeliverySnapshot;
  delivery_after: AmendmentDeliverySnapshot;
  delivery_changed: boolean;
  warnings: AmendmentWarning[];
  summary: string;
}

/** A committed change, as stored and replayed on the order's history card. */
export interface OrderAmendment {
  amendment_id: string;
  order_id: string;
  amendment_number: number;
  reason: string;
  reason_category: AmendmentReasonCategory;
  subtotal_before_ngn: string;
  discount_before_ngn: string;
  tax_before_ngn: string;
  shipping_before_ngn: string;
  total_before_ngn: string;
  subtotal_after_ngn: string;
  discount_after_ngn: string;
  tax_after_ngn: string;
  shipping_after_ngn: string;
  total_after_ngn: string;
  difference_ngn: string;
  amount_paid_ngn: string;
  balance_after_ngn: string;
  lines_before: AmendmentPreview["lines_after"];
  lines_after: AmendmentPreview["lines_after"];
  line_changes: AmendmentLineChange[];
  delivery_before: AmendmentDeliverySnapshot | null;
  delivery_after: AmendmentDeliverySnapshot | null;
  effects: {
    warnings?: AmendmentWarning[];
    stock?: {
      returned?: Array<{ variant_id: string; quantity: number }>;
      released?: Array<{ variant_id: string; quantity: number }>;
      reserved?: Array<{ variant_id: string; quantity: number }>;
      deducted?: Array<{ variant_id: string; quantity: number }>;
      preorder?: Array<{ variant_id: string; quantity: number }>;
      cogs_added_ngn?: string;
    };
    gl?: { posted?: boolean; entry_id?: string | null; reason?: string };
    invoice?: {
      invoice_id?: string;
      invoice_number?: string;
      status?: string;
      revised?: boolean;
    };
    studio?: { cancelled_job_ids?: string[]; left_open_job_ids?: string[] };
    logistics?: {
      delivery_id?: string | null;
      delivery_number?: string;
      resynced?: boolean;
      address_updated?: boolean;
      reason?: string;
    };
    status?: { moved_to?: string; settled_by_amendment?: boolean };
  } | null;
  order_status_before: string;
  revenue_recognised: boolean;
  journal_entry_id: string | null;
  customer_notified: boolean;
  amended_by: string | null;
  amended_by_name: string | null;
  amended_by_display_name?: string | null;
  created_at: string;
}

/** What the stock reconciler actually did — the authoritative version of the
 *  preview's promises. `substituted` is non-empty when units were drawn from a
 *  size-adjacent sibling base instead of the ordered size (rewig adjacency),
 *  which the operator needs to hear before the picklist surprises them. */
export interface AmendmentStockEffects {
  substituted?: Array<{
    /** The line as the operator sees it, e.g. "Nala Sleek Bangs — Medium". */
    name: string;
    product_name: string;
    sku: string;
    quantity: number;
  }>;
  preorder?: Array<{ variant_id: string; quantity: number; reason?: string }>;
}

/** Commit result. `requires_confirmation` mirrors the archive-restore
 *  contract: a 200 that wrote nothing, carrying the warnings to show first. */
export interface AmendOrderResult {
  requires_confirmation: boolean;
  order_number?: string;
  order?: SalesOrder;
  amendment?: OrderAmendment;
  warnings?: AmendmentWarning[];
  stock?: AmendmentStockEffects;
  difference_ngn?: string;
  balance_after_ngn?: string;
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
  // A line sells EITHER a product variant OR a service offering (Stylist Studio).
  lines: Array<{
    variant_id?: string;
    service_offering_id?: string;
    styled_id?: string;
    line_kind?: "product" | "styled" | "bundle" | "service";
    quantity: number;
    unit_price_ngn?: number;
    notes?: string;
    // Snapshot overrides — record the shop-facing name/SKU (a styled product
    // or bundle) instead of whatever the underlying stock variant is called.
    product_name_snapshot?: string;
    variant_label_snapshot?: string;
    sku_snapshot?: string;
  }>;
  sales_campaign_id?: string;
  campaign_slug?: string;
  coupon_code?: string;
  redeem_points?: number;
  bundle_id?: string;
  client_idempotency_key?: string;
  shipping_fee_ngn?: number;
  required_deposit_pct?: number;
  /** Flexi Pay: 'instalment' raises the order on the flexible plan. */
  payment_plan?: "full" | "instalment";
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
  // Flexi Pay (D13): staff-recorded bank transfer — mandatory bank reference +
  // bank name; the recorder is stamped server-side.
  manual_bank_transaction_id?: string;
  manual_bank_name?: string;
  notes?: string;
  client_idempotency_key?: string;
}

// ── Flexi Pay settings (Sales → Payments tab) ───────────────
export interface FlexiPaySettings {
  plan_display_name: string;
  plan_terms: string[];
  min_first_payment_pct: number;
  min_topup_ngn: number;
  custom_order_deposit_pct: number;
  layaway_abandonment_days: number;
  layaway_reminder_cadence_days: number;
  auto_cancel_after_no_payment: boolean;
  abandoned_checkout_nudge_enabled: boolean;
  abandoned_checkout_nudge_hours: number;
  abandoned_checkout_expiry_hours: number;
  milestone_messages_enabled: boolean;
  channels: Record<string, boolean>;
  allow_staff_recorded_manual_payments: boolean;
}
export type FlexiPaySettingsPatch = Partial<
  Omit<FlexiPaySettings, "channels" | "plan_terms">
> & {
  channels?: Record<string, boolean>;
  plan_terms?: string[];
};

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
    // Snapshot overrides — record the shop-facing name/SKU (a styled
    // product) instead of the underlying stock variant's own name.
    product_name_snapshot?: string;
    variant_label_snapshot?: string;
    sku_snapshot?: string;
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

/**
 * Accept, optionally minting the order in the same step (order-first fallback,
 * for sales settled offline rather than through the quote's own pay link).
 */
export interface QuotationAcceptInput {
  convert?: boolean;
  sales_channel?: SalesChannel;
}

/**
 * The customer-facing pay link for a quote. Paying it converts the quote to a
 * sales order at gateway confirmation — the order does not exist until then.
 */
export interface QuotationPayLink {
  quotation_id: string;
  quotation_number: string;
  status: QuoteStatus;
  total_ngn: string;
  public_pay_token: string | null;
  pay_url: string;
}

export interface CancellationRequestInput {
  reason: string;
  reason_category?: CancellationCategory;
  requested_by_contact_id?: string;
}

// ── POS Reconciliation (Sales → POS Reconciliation tab) ─────
// Unmatched in-store Nomba terminal payments, parked by the webhook fallback
// for staff to match against an open order (or ignore). Backed by the
// shared, not-brand-scoped shared.pos_terminal_reconciliation table.

export type PosReconStatus = "pending" | "matched" | "ignored";

export interface PosTerminalReconciliation {
  recon_id: string;
  webhook_id: string | null;
  provider: string;
  resolved_brand: string | null;
  nomba_terminal_id: string | null;
  alias_account_name: string | null;
  // Who paid, per the gateway (columns added in 000374 — null on older rows).
  sender_name: string | null;
  sender_bank: string | null;
  amount_ngn: string;
  transaction_time: string | null;
  provider_reference: string | null;
  status: PosReconStatus;
  matched_brand: string | null;
  matched_order_id: string | null;
  matched_by: string | null;
  matched_at: string | null;
  note: string | null;
  created_at: string;
}

/** Candidate order returned by the smart-suggestion search (sales.repo.js
 *  findReconcilablePosOrders) — same balance, same brand, near the payment time. */
export interface PosReconOrderCandidate {
  order_id: string;
  order_number: string;
  status: string;
  total_ngn: string;
  amount_paid_ngn: string;
  balance_due_ngn: string;
  created_at: string;
}

/* ── Post-hoc coupon (§6.23.2) ───────────────────────────────
   Applying a code to an order that was already placed — the discount she was
   eligible for that nobody entered at checkout. The waiver is capped at the
   order's outstanding balance, so it can settle an order but never drive it
   into credit. */

/** A code that can't be used here. A 200, not an error: mistyping a code at the
 *  counter is ordinary behaviour, and the form renders `message` inline. */
export interface OrderCouponRejected {
  valid: false;
  coupon_code: string;
  reason: string;
  /** Staff-facing sentence — already written for the counter, show it as-is. */
  message: string;
}

/** What a code is worth on this order, and what it would actually take off. */
export interface OrderCouponQuote {
  valid: true;
  order_id: string;
  order_number: string;
  coupon_code: string;
  display_name: string;
  description: string | null;
  discount_type:
    | "percentage"
    | "fixed_amount"
    | "free_shipping"
    | "buy_x_get_y";
  /** The code's face value on this order, BEFORE the balance cap. */
  coupon_value_ngn: string;
  /** What it actually waives — this is the figure that gets committed. */
  discount_ngn: string;
  /** True when the code was worth more than the balance and got trimmed. */
  capped_to_balance: boolean;
  capped_by_ngn: string | null;
  total_before_ngn: string;
  total_after_ngn: string;
  balance_before_ngn: string;
  balance_after_ngn: string;
  /** The waiver clears the balance outright — the order settles on apply. */
  settles_order: boolean;
}

export type OrderCouponPreview = OrderCouponQuote | OrderCouponRejected;

export interface ApplyOrderCouponInput {
  coupon_code: string;
  /** Free text for the audit note — "loyalty voucher, missed at checkout". */
  reason?: string;
}

export interface ApplyOrderCouponResult {
  order: SalesOrder;
  quote: OrderCouponQuote;
  effects: {
    gl: { posted: boolean; entry_id: string | null; reason?: string };
    status: {
      moved_to: string;
      settled_by_coupon?: boolean;
      unchanged?: boolean;
    };
    invoice:
      | {
          invoice_id: string;
          invoice_number: string;
          status: string;
          total_ngn: string;
        }
      | { revised: false };
  };
}
