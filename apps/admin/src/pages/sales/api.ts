import { api } from "@/lib/api";
import type {
  SalesOrder,
  Quotation,
  SalesKpis,
  TimelineEvent,
  OrderCreateInput,
  PaymentCreateInput,
  PaymentLinkInput,
  QuotationCreateInput,
  QuotationSendInput,
  QuotationConvertInput,
  CancellationRequestInput,
  PaginatedResponse,
  FlexiPaySettings,
  FlexiPaySettingsPatch,
  PosTerminalReconciliation,
  PosReconOrderCandidate,
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
  contact_id?: string;
  sales_channel?: string;
  sales_campaign_id?: string;
  search?: string;
  /** Flexi Pay (PR-3): committed instalment orders with a balance still due. */
  part_paid?: boolean;
  /** Pre-orders tab (000086): orders carrying a made-to-order line. */
  preorder?: boolean;
  page?: number;
  page_size?: number;
}

export const listOrders = ({
  search,
  part_paid,
  preorder,
  ...rest
}: OrderListParams = {}) =>
  api.get<PaginatedResponse<SalesOrder>>(
    `${S}/orders${qs({
      ...rest,
      q: search,
      part_paid: part_paid || undefined,
      preorder: preorder || undefined,
    })}`,
  );

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
  api.post<{ checkout_url: string }>(
    `${S}/orders/${orderId}/payment-link`,
    input,
  );

export const cancelOrder = (id: string) =>
  api.post<SalesOrder>(`${S}/orders/${id}/cancel`);

export const generateReceipt = (id: string) =>
  api.post<{ url: string }>(`${S}/orders/${id}/receipt`);

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

/** The Studio job attached to this order (paginated list; first row is what we want). */
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

export const getOrderServiceJob = (orderId: string) =>
  api.get<PaginatedResponse<OrderServiceJob>>(
    `/service-jobs${qs({ sales_order_id: orderId, page_size: 1 })}`,
  );

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

export const acceptQuotation = (id: string) =>
  api.post<Quotation>(`${S}/quotations/${id}/accept`);

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
