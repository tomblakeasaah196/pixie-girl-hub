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
  page?: number;
  page_size?: number;
}

export const listOrders = ({ search, ...rest }: OrderListParams = {}) =>
  api.get<PaginatedResponse<SalesOrder>>(
    `${S}/orders${qs({ ...rest, q: search })}`,
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
  api.download(
    `${S}/reports/export${qs({ ...params })}`,
    "sales-report.xlsx",
  );

// ── KPIs ────────────────────────────────────────────────────

export const getSalesKpis = () => api.get<SalesKpis>(`/dashboards/kpis/sales`);

export const listDeliveryPendingOrders = (params: Omit<OrderListParams, "status"> = {}) =>
  api.get<PaginatedResponse<SalesOrder>>(
    `${S}/orders${qs({ ...params, fee_pending: "true" })}`,
  );

export const setOrderDeliveryFee = (id: string, fee_ngn: number) =>
  api.patch<SalesOrder>(`${S}/orders/${id}/delivery-fee`, { fee_ngn });

// ── Contact search ─────────────────────────────────────────

export const searchContacts = (q: string, limit = 6) =>
  api.get<PaginatedResponse<{ contact_id: string; display_name: string; email: string | null; primary_phone: string | null }>>(
    `/contacts?q=${encodeURIComponent(q)}&page_size=${limit}`
  );

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
