import { api } from "@/lib/api";
import type {
  SalesOrder,
  Quotation,
  SalesKpis,
  CollectionsSummary,
  TimelineEvent,
  OrderCreateInput,
  PaymentCreateInput,
  PaymentLinkInput,
  QuotationCreateInput,
  QuotationSendInput,
  QuotationConvertInput,
  QuotationAcceptInput,
  QuotationPayLink,
  CancellationRequestInput,
  PaginatedResponse,
  FlexiPaySettings,
  FlexiPaySettingsPatch,
  PosTerminalReconciliation,
  PosReconOrderCandidate,
  OrderStatus,
  AmendmentPreview,
  AmendmentPreviewInput,
  AmendmentInput,
  AmendOrderResult,
  OrderAmendment,
  OrderCouponPreview,
  ApplyOrderCouponInput,
  ApplyOrderCouponResult,
} from "./types";

const S = "/sales";

function qs(params: Record<string, unknown>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ── Orders ──────────────────────────────────────────────────

export interface OrderListParams {
  status?: string;
  /** Hide one status from the working list — the Orders table passes
   *  'cancelled' so archived rows only appear in the Archive drawer.
   *  Ignored by the API when an explicit `status` is also set. */
  exclude_status?: string;
  contact_id?: string;
  sales_channel?: string;
  sales_campaign_id?: string;
  search?: string;
  /** Active collection orders: money received and a balance still due. */
  part_paid?: boolean;
  /** Every ACTIVE order with a balance still due — part-paid AND ₦0-paid.
   *  Excludes draft / cancel-requested / cancelled / refunded / failed. */
  outstanding_balance?: boolean;
  /** Pre-orders tab (000086): orders carrying a made-to-order line. */
  preorder?: boolean;
  page?: number;
  page_size?: number;
}

export const listOrders = ({
  search,
  part_paid,
  outstanding_balance,
  preorder,
  ...rest
}: OrderListParams = {}) =>
  api.get<PaginatedResponse<SalesOrder>>(
    `${S}/orders${qs({
      ...rest,
      q: search,
      part_paid: part_paid || undefined,
      outstanding_balance: outstanding_balance || undefined,
      preorder: preorder || undefined,
    })}`,
  );

/** Collections headline for the Orders list — live outstanding balance, its
 *  part-paid / ₦0-paid split, and the dead-order balances that are excluded. */
export const getCollectionsSummary = () =>
  api.get<CollectionsSummary>(`${S}/orders/collections-summary`);

export const getOrder = (id: string) =>
  api.get<SalesOrder>(`${S}/orders/${id}`);

export const createOrder = (input: OrderCreateInput) =>
  api.post<SalesOrder>(`${S}/orders`, input);

export const updateOrder = (id: string, input: Record<string, unknown>) =>
  api.patch<SalesOrder>(`${S}/orders/${id}`, input);

export const addPayment = (orderId: string, input: PaymentCreateInput) =>
  api.post<SalesOrder>(`${S}/orders/${orderId}/payments`, input);

export const createPaymentLink = (
  orderId: string,
  input: PaymentLinkInput = {},
) =>
  api.post<{
    /** The gateway checkout itself — for paying on the spot (in-store QR). */
    checkout_url: string;
    /** The link to SEND the customer: the order's pay page, which expires if
     *  the order changes (then it shows the updated balance). */
    share_url?: string | null;
    /** What the checkout charges: its currency and amount in that currency
     *  (e.g. "USD" / "249.99"). */
    currency?: string;
    charge_amount?: string;
  }>(`${S}/orders/${orderId}/payment-link`, input);

/** A draft Quick Sale cart line, as the USD preview prices it. */
export interface UsdQuoteLine {
  variant_id?: string;
  styled_id?: string;
  service_offering_id?: string;
  line_kind?: string;
  unit_price_ngn: number;
  quantity: number;
}

/** Quick Sale "≈ $ total": the draft cart priced in dollars by the Hub's USD
 *  engine (catalogue USD prices, catalogue rate) — the figure the USD pay
 *  link will lock. Null when no rate/USD price can price it. */
export const usdQuote = (input: {
  lines: UsdQuoteLine[];
  total_ngn: number;
  shipping_fee_ngn?: number;
}) =>
  api.post<{
    currency: "USD";
    usd_total: string;
    goods_usd: string;
    delivery_usd: string;
    lines: string[];
  } | null>(`${S}/usd-quote`, input);

export const cancelOrder = (id: string, reason?: string) =>
  api.post<SalesOrder>(`${S}/orders/${id}/cancel`, reason ? { reason } : {});

/** A line the archive restore can no longer re-hold from stock. */
export interface RestoreShortLine {
  line_id: string;
  variant_id: string;
  name: string | null;
  wanted: number;
  available: number;
}

/**
 * Result of restoring a cancelled order. The dry run returns 200 with
 * `requires_confirmation: true` when some lines can no longer be re-held — the
 * caller shows the warning, then calls again with `confirm: true` to bring those
 * lines back as pre-orders. Genuine refusals (not cancelled, deposit forfeited)
 * throw an ApiError instead.
 */
export interface RestoreOrderResult {
  requires_confirmation: boolean;
  order_number?: string;
  short_lines?: RestoreShortLine[];
  message?: string;
  restored_to?: string;
  preorder_line_count?: number;
}

export const restoreOrder = (id: string, confirm = false) =>
  api.post<RestoreOrderResult>(`${S}/orders/${id}/restore`, { confirm });

// ── Change Order (§6.2 amendments) ──────────────────────────

/**
 * Dry run — what the change would do, computed by the same code that will
 * commit it. Writes nothing, so the modal can call it freely as the operator
 * edits the cart.
 */
export const previewAmendment = (
  id: string,
  input: AmendmentPreviewInput,
) =>
  api.post<AmendmentPreview>(`${S}/orders/${id}/amendment/preview`, input);

/**
 * Commit the change. Two-phase like the archive restore: without
 * `acknowledge_warnings` a consequential change answers 200 with
 * `requires_confirmation: true` and the warnings, having written nothing.
 * Genuine refusals (completed order, pending cancellation, unknown variant)
 * throw an ApiError instead.
 */
export const amendOrder = (id: string, input: AmendmentInput) =>
  api.post<AmendOrderResult>(`${S}/orders/${id}/amendment`, input);

/** Every change made to this order, newest first. */
export const listAmendments = (id: string) =>
  api.get<PaginatedResponse<OrderAmendment>>(`${S}/orders/${id}/amendments`);

// Manual fulfilment-stage move (assigned / order_ready / dispatched / completed).
// Payment + cancellation states are managed automatically by the backend.
export const setOrderStatus = (id: string, status: string) =>
  api.post<SalesOrder>(`${S}/orders/${id}/status`, { status });

export const generateReceipt = (id: string) =>
  api.post<{ url: string }>(`${S}/orders/${id}/receipt`);

/** Email-only "your pre-order has arrived" notice to the customer. */
export const notifyPreorderArrival = (id: string) =>
  api.post<{ sent: boolean; to: string; notified_at: string | null }>(
    `${S}/orders/${id}/preorder-arrival-email`,
  );

// ── Pre-order history modal ("Fulfilled pre-orders") ────────
export interface PreorderHistoryOrder {
  order_id: string;
  order_number: string;
  status: OrderStatus | string;
  total_ngn: string | number;
  contact_name?: string | null;
  preorder_ready_by?: string | null;
  preorder_fulfilled_at?: string | null;
  preorder_arrival_notified_at?: string | null;
  preorder_min_weeks?: number | null;
  preorder_max_weeks?: number | null;
}
export interface PreorderAllocationRun {
  mode: string;
  variants_scanned: number;
  orders_fulfilled: number;
  units_deducted: number;
  units_reserved: number;
  ok: boolean;
  started_at: string;
  finished_at?: string | null;
}
export interface PreorderHistoryResponse {
  fulfilled: PreorderHistoryOrder[];
  waiting: PreorderHistoryOrder[];
  last_run: PreorderAllocationRun | null;
}
export interface PreorderBackfillResult {
  ok: boolean;
  variants_scanned: number;
  orders_fulfilled: number;
  units_deducted: number;
  units_reserved: number;
}

/** Fulfilled + still-waiting pre-orders, plus the last reconcile run. */
export const getPreorderHistory = () =>
  api.get<PreorderHistoryResponse>(`${S}/preorders/history`);

/** Run the pre-order reconcile for the active brand, on demand (notifies ops+sales). */
export const runPreorderBackfill = () =>
  api.post<PreorderBackfillResult>(`${S}/preorders/backfill`);

/** Live on/off state of the customer message a manual fulfilment move fires. */
export interface StatusAutomationState {
  /** Comms Studio automation this move triggers (e.g. "order_ready"). */
  event_key: string;
  /** An automation row exists for this event on the active brand. */
  configured: boolean;
  /** Switched On in Messaging settings — i.e. this message will actually send. */
  is_active: boolean;
  /** Configured channel_preference ("whatsapp" | "email" | …), when known. */
  channel: string | null;
}

/**
 * On/off state of the message each manual status move fires, keyed by target
 * status. Only message-bearing moves appear (order_ready, dispatched);
 * assigned/completed send nothing and are absent. Powers the drawer's impact
 * modal so it shows a definite "will send"/"won't send — it's off".
 */
export type StatusAutomationMap = Partial<
  Record<OrderStatus, StatusAutomationState>
>;

export const getStatusAutomations = () =>
  api.get<StatusAutomationMap>(`${S}/orders/status-automations`);

export const getOrderTimeline = (id: string) =>
  api.get<TimelineEvent[]>(`${S}/orders/${id}/timeline`);

export const getOrderInvoice = (orderId: string) =>
  api.get<
    PaginatedResponse<{
      invoice_id: string;
      invoice_number: string;
      status: string;
      sent_at: string | null;
      sent_via: string | null;
      first_viewed_at: string | null;
    }>
  >(`/invoicing/invoices${qs({ order_id: orderId, page_size: 1 })}`);

export const sendOrderInvoice = (
  invoiceId: string,
  input: { sent_via?: string } = {},
) => api.post(`/invoicing/invoices/${invoiceId}/send`, input);

/** Every reminder scheduled or sent for this invoice — powers the Comms log. */
export interface InvoiceReminder {
  reminder_id: string;
  reminder_type: string;
  channel: "whatsapp" | "email" | "sms" | "in_app";
  recipient_address: string;
  status: string;
  scheduled_for: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failure_reason: string | null;
}

export const getInvoiceReminders = (invoiceId: string) =>
  api.get<{ data: InvoiceReminder[] }>(
    `/invoicing/invoices/${invoiceId}/reminders`,
  );

// ── Order rollup (Studio + Delivery + Customer history) ─────

/** One Studio job attached to this order. An order with three hairs has three. */
export interface OrderServiceJob {
  job_id: string;
  job_number: string;
  status: string;
  assigned_staff_user_id: string | null;
  assigned_stylist_id: string | null;
  /** Stylist display name, joined server-side from shared.users. */
  assigned_staff_name: string | null;
  assigned_at: string | null;
  started_at: string | null;
  expected_completion_at: string | null;
  sla_due_at: string | null;
  completed_at: string | null;
  ready_at: string | null;
  returned_at: string | null;
  handed_at: string | null;
  qc_at: string | null;
  quality_rating: number | null;
  rework_count: number | null;
  agreed_cost_ngn: string | null;
  service_type_id: string | null;
  hair_description: string | null;
  created_at: string;
}

/**
 * How much of the order's studio work is finished.
 *
 * An order can carry several hairs — one job each — and nothing customer-facing
 * happens until every one of them is done. `ready` is the server's own gate, so
 * the screen never has to re-derive the rule.
 */
export interface StudioProgress {
  /** Jobs opened for this order. 0 = a plain product sale, no styling. */
  total: number;
  /** Finished and out of the studio. */
  done: number;
  /** Still on someone's bench — any of these holds the whole order. */
  outstanding: number;
  /** total > 0 and nothing outstanding. */
  ready: boolean;
}

export interface OrderServiceJobResponse {
  data: OrderServiceJob[];
  meta: { count: number; studio: StudioProgress };
}

// Read the order's Stylist Studio jobs THROUGH the order (sales.view), not the
// service_jobs list endpoint (which is stylist own-scoped). A salesperson is
// never the assigned stylist, so the old path returned an empty list for them
// and the Order drawer misreported "Studio: not opened yet".
export const getOrderServiceJob = (orderId: string) =>
  api.get<OrderServiceJobResponse>(`${S}/orders/${orderId}/service-job`);

/** The delivery attached to this order. */
export interface OrderDelivery {
  delivery_id: string;
  delivery_number: string;
  delivery_type: string;
  status: string;
  courier_id: string | null;
  courier_tracking_ref: string | null;
  courier_tracking_url: string | null;
  is_pay_on_delivery: boolean | null;
  scheduled_for: string | null;
  first_attempted_at: string | null;
  delivered_at: string | null;
  destination_summary: string | null;
  recipient_name: string | null;
}

export const getOrderDelivery = (orderId: string) =>
  api.get<PaginatedResponse<OrderDelivery>>(
    `/logistics/deliveries${qs({ order_id: orderId, page_size: 1 })}`,
  );

/** Recent orders for a contact (for the customer-history strip on OrderDetail). */
export const getContactRecentOrders = (contactId: string, pageSize = 6) =>
  api.get<PaginatedResponse<SalesOrder>>(
    `${S}/orders${qs({ contact_id: contactId, page_size: pageSize })}`,
  );

// ── Quotations ──────────────────────────────────────────────

export interface QuoteListParams {
  status?: string;
  contact_id?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

export const listQuotations = ({ search, ...rest }: QuoteListParams = {}) =>
  api.get<PaginatedResponse<Quotation>>(`${S}/quotations${qs(rest)}`);

export const getQuotation = (id: string) =>
  api.get<Quotation>(`${S}/quotations/${id}`);

export const createQuotation = (input: QuotationCreateInput) =>
  api.post<Quotation>(`${S}/quotations`, input);

export const sendQuotation = (id: string, input: QuotationSendInput = {}) =>
  api.post<Quotation>(`${S}/quotations/${id}/send`, input);

export const acceptQuotation = (
  id: string,
  input: QuotationAcceptInput = {},
) => api.post<Quotation>(`${S}/quotations/${id}/accept`, input);

/**
 * Mint (idempotently) the quote's customer-facing pay link. Sending it is what
 * lets the customer pay the quote directly; the order is created from the quote
 * when that payment confirms.
 */
export const getQuotationPayLink = (id: string) =>
  api.get<QuotationPayLink>(`${S}/quotations/${id}/pay-link`);

export const rejectQuotation = (id: string, reason?: string) =>
  api.post<Quotation>(`${S}/quotations/${id}/reject`, { reason });

export const convertQuotation = (
  id: string,
  input: QuotationConvertInput = {},
) => api.post<SalesOrder>(`${S}/quotations/${id}/convert`, input);

// ── Cancellations ───────────────────────────────────────────

export const requestCancellation = (
  orderId: string,
  input: CancellationRequestInput,
) => api.post<unknown>(`${S}/orders/${orderId}/cancellation`, input);

// ── Reports ─────────────────────────────────────────────────

export interface SalesReportParams {
  from?: string;
  to?: string;
  status?: string;
  sales_channel?: string;
}

/** Download the styled Sales Report .xlsx for a period (authed file download). */
export const exportSalesReport = (params: SalesReportParams = {}) =>
  api.download(`${S}/reports/export${qs({ ...params })}`, "sales-report.xlsx");

// ── Flexi Pay settings (Sales → Payments tab) ───────────────

export const getPaymentSettings = () =>
  api.get<FlexiPaySettings>(`${S}/payment-settings`);

export const updatePaymentSettings = (patch: FlexiPaySettingsPatch) =>
  api.put<FlexiPaySettings>(`${S}/payment-settings`, patch);

// ── KPIs ────────────────────────────────────────────────────

export const getSalesKpis = () => api.get<SalesKpis>(`/dashboards/kpis/sales`);

export const listDeliveryPendingOrders = (
  params: Omit<OrderListParams, "status"> = {},
) =>
  api.get<PaginatedResponse<SalesOrder>>(
    `${S}/orders${qs({ ...params, fee_pending: "true" })}`,
  );

export const setOrderDeliveryFee = (id: string, fee_ngn: number) =>
  api.patch<SalesOrder>(`${S}/orders/${id}/delivery-fee`, { fee_ngn });

export const setSpecificInstructions = (id: string, specific_instructions: string) =>
  api.patch<SalesOrder>(`${S}/orders/${id}/specific-instructions`, { specific_instructions });

// ── Contact search ─────────────────────────────────────────

export const searchContacts = (q: string, limit = 6) =>
  api.get<
    PaginatedResponse<{
      contact_id: string;
      display_name: string;
      email: string | null;
      primary_phone: string | null;
    }>
  >(`/contacts?q=${encodeURIComponent(q)}&page_size=${limit}`);

// ── Catalogue helpers (for product picker) ──────────────────

export const searchProducts = (search: string) =>
  api.get<
    PaginatedResponse<{ product_id: string; name: string; slug: string }>
  >(`/catalogue/products?q=${encodeURIComponent(search)}&page_size=10`);

export const getProductVariants = (productId: string) =>
  api.get<
    Array<{
      variant_id: string;
      sku: string;
      variant_name: string;
      price_storefront_ngn: string | null;
      price_pos_ngn: string | null;
      is_active: boolean;
    }>
  >(`/catalogue/products/${productId}/variants`);

export const searchStyledProducts = (search: string) =>
  api.get<
    PaginatedResponse<{
      styled_product_id: string;
      name: string;
      styled_code: string;
      retail_price_ngn: string | null;
    }>
  >(`/catalogue/styled-products?q=${encodeURIComponent(search)}&page_size=10`);

export const searchBundles = (_search: string) =>
  api.get<
    Array<{
      bundle_id: string;
      bundle_code: string;
      display_name: string;
      bundle_price_ngn: string | null;
      pricing_model: string;
    }>
  >(`/retention/bundles?active=true`);

export const getStyledProduct = (id: string) =>
  api.get<{
    styled_product_id: string;
    base_product_id: string;
    base_variant_id: string;
    name: string;
    retail_price_ngn: string | null;
  }>(`/catalogue/styled-products/${id}`);

export const getBundle = (id: string) =>
  api.get<{
    bundle_id: string;
    display_name: string;
    bundle_price_ngn: string | null;
    components: Array<{
      bundle_product_id: string;
      product_id: string | null;
      variant_id: string | null;
      quantity: number;
      role: string;
    }>;
  }>(`/retention/bundles/${id}`);

// ── POS Reconciliation (Sales → POS Reconciliation tab) ─────

const POS = "/pos";

export interface PosReconListParams {
  page?: number;
  page_size?: number;
}

export const listPosReconciliation = (params: PosReconListParams = {}) =>
  api.get<PaginatedResponse<PosTerminalReconciliation>>(
    `${POS}/reconciliation${qs({ ...params })}`,
  );

/** Cross-brand — terminal not yet resolved to a brand (CEO only, backend-enforced). */
export const listPosReconciliationUnresolved = (
  params: PosReconListParams = {},
) =>
  api.get<PaginatedResponse<PosTerminalReconciliation>>(
    `${POS}/reconciliation/unresolved${qs({ ...params })}`,
  );

export interface PosReconSuggestionsResponse {
  data: PosReconOrderCandidate[];
  recon: PosTerminalReconciliation;
}

/** `brand` is required when the row's own resolved_brand is still null. */
export const getPosReconciliationSuggestions = (id: string, brand?: string) =>
  api.get<PosReconSuggestionsResponse>(
    `${POS}/reconciliation/${id}/suggestions${qs({ brand })}`,
  );

// match/ignore respond with a single-envelope { data: row }, which the API
// client auto-unwraps to the bare row (only a sibling `meta` key keeps a
// `{ data, ... }` shape intact) — type these as the unwrapped shape so a
// future caller that reads the resolved value doesn't hit the same
// undefined-access bug the suggestions endpoint had.
export const matchPosReconciliation = (
  id: string,
  input: { brand: string; order_id: string },
) =>
  api.post<PosTerminalReconciliation>(
    `${POS}/reconciliation/${id}/match`,
    input,
  );

export const ignorePosReconciliation = (id: string, note: string) =>
  api.post<PosTerminalReconciliation>(
    `${POS}/reconciliation/${id}/ignore`,
    { note },
  );

/** Manual-search fallback (decision 1A) — reuses the normal order list,
 *  scoped to the brand active in X-Brand-Context. Not filtered by
 *  sales_channel: Quick Sale (which replaced the old POS module) never
 *  tags an order with the legacy 'pos' channel, so that filter matched
 *  nothing — a terminal payment can settle any open order's balance. */
export const searchPosReconcilableOrders = (search: string) =>
  api.get<PaginatedResponse<SalesOrder>>(
    `/sales/orders${qs({ q: search, page_size: 10 })}`,
  );

// ── Post-hoc coupon (§6.23.2) ───────────────────────────────

/**
 * What would this code do to this order? Read-only, so the payment form can
 * call it the moment staff stop typing.
 *
 * An unusable code answers 200 with `valid: false` and a sentence rather than
 * throwing — mistyping a code at the counter is ordinary behaviour, not an
 * error condition, and the panel renders the reason inline either way.
 */
export const previewOrderCoupon = (id: string, coupon_code: string) =>
  api.post<OrderCouponPreview>(`${S}/orders/${id}/coupon/preview`, {
    coupon_code,
  });

/**
 * Commit the waiver. Reduces the order total, records the discount and the
 * coupon redemption, reconciles the invoice and the GL, and settles the order
 * outright when the waiver clears the balance — one transaction.
 *
 * Capped at the outstanding balance, so a code worth more than the balance
 * waives the balance and no more. Unlike the preview, an unusable code here
 * throws an ApiError: by this point it is a real refusal.
 */
export const applyOrderCoupon = (id: string, input: ApplyOrderCouponInput) =>
  api.post<ApplyOrderCouponResult>(`${S}/orders/${id}/coupon`, input);
