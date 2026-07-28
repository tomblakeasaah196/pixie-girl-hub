import { api } from "@/lib/api";
import type {
  Supplier,
  PurchaseOrder,
  PoPaginated,
  GoodsReceivedNote,
  GrnPaginated,
  SupplierInvoice,
  InvoicePaginated,
} from "./types";

const BASE = "/purchasing";

// ── Suppliers ─────────────────────────────────────────────

// The backend supplier row uses display_name / country_of_origin /
// default_currency; the UI type uses supplier_name / country / currency. Map
// them so the list/detail don't render "—" for a supplier that clearly has a
// name in the API response.
function normalizeSupplier(raw: Supplier): Supplier {
  const r = raw as Supplier & {
    display_name?: string;
    country_of_origin?: string | null;
    default_currency?: string;
  };
  return {
    ...raw,
    supplier_name: r.supplier_name ?? r.display_name ?? "",
    country: r.country ?? r.country_of_origin ?? null,
    currency: r.currency ?? r.default_currency ?? "",
  };
}

export async function listSuppliers() {
  // The endpoint returns { data, meta }; the api client passes that through.
  // Suppliers are consumed as a bare array, so normalise either shape.
  const r = await api.get<Supplier[] | { data: Supplier[] }>(`${BASE}/suppliers`);
  const rows = Array.isArray(r) ? r : (r?.data ?? []);
  return rows.map(normalizeSupplier);
}

export async function getSupplier(id: string) {
  const r = await api.get<Supplier>(`${BASE}/suppliers/${id}`);
  return normalizeSupplier(r);
}

export function createSupplier(input: {
  supplier_name: string;
  country?: string;
  email?: string;
  phone?: string;
  currency?: string;
}) {
  return api.post<Supplier>(`${BASE}/suppliers`, input);
}

export function updateSupplier(
  id: string,
  input: Partial<{
    supplier_name: string;
    country: string;
    email: string;
    phone: string;
    currency: string;
    is_active: boolean;
  }>,
) {
  return api.patch<Supplier>(`${BASE}/suppliers/${id}`, input);
}

// ── Purchase Orders ───────────────────────────────────────

export function listPos(params?: {
  status?: string;
  supplier_id?: string;
  page?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.supplier_id) qs.set("supplier_id", params.supplier_id);
  if (params?.page) qs.set("page", String(params.page));
  const q = qs.toString();
  return api.get<PoPaginated>(`${BASE}/purchase-orders${q ? `?${q}` : ""}`);
}

export function getPo(id: string) {
  return api.get<PurchaseOrder>(`${BASE}/purchase-orders/${id}`);
}

/**
 * Create a purchase order. This mirrors the API's schema exactly — it is
 * `.strict()`, so an unknown key (the old `unit_price_original`, `currency`,
 * `quantity` per line) rejected the whole request and no PO could ever be
 * created.
 *
 * `product_id` on a line is the BASE product being bought; the server resolves
 * it to that product's stock variant, which is what lets Goods Reception
 * receive the delivery against this order.
 */
export function createPo(input: {
  supplier_id: string;
  title: string;
  description?: string;
  po_currency: string;
  fx_rate?: number;
  shipping?: number;
  delivery_location_id?: string;
  expected_delivery?: string;
  payment_terms_days?: number;
  shipping_terms?: string;
  lines: Array<{
    product_id?: string;
    variant_id?: string;
    description: string;
    supplier_sku?: string;
    qty_ordered: number;
    unit_price: number;
    tax_rate?: number;
    notes?: string;
  }>;
}) {
  return api.post<PurchaseOrder>(`${BASE}/purchase-orders`, input);
}

/** Outstanding lines for a PO, resolved to base products — what Goods
 *  Reception prefills its form from. */
export function poReceivingPlan(id: string) {
  return api.get<PoReceivingPlan>(
    `${BASE}/purchase-orders/${id}/receiving-plan`,
  );
}

export interface PoReceivingPlanLine {
  line_id: string;
  variant_id: string | null;
  product_id: string | null;
  product_name: string | null;
  variant_name: string | null;
  sku: string | null;
  description: string;
  qty_ordered: number;
  qty_received: number;
  qty_outstanding: number;
}

export interface PoReceivingPlan {
  po_id: string;
  po_number: string;
  status: string;
  supplier_name: string | null;
  delivery_location_id: string | null;
  expected_delivery: string | null;
  lines: PoReceivingPlanLine[];
}

export function submitPo(id: string) {
  return api.post<PurchaseOrder>(`${BASE}/purchase-orders/${id}/submit`);
}

export function approvePo(id: string) {
  return api.post<PurchaseOrder>(`${BASE}/purchase-orders/${id}/approve`);
}

// The API reads `to_status`; sending `status` failed validation, so advancing
// a PO never worked either.
export function advancePo(id: string, status: string, notes?: string) {
  return api.post<PurchaseOrder>(`${BASE}/purchase-orders/${id}/advance`, {
    to_status: status,
    notes,
  });
}

export function cancelPo(id: string, reason?: string) {
  return api.post<PurchaseOrder>(`${BASE}/purchase-orders/${id}/cancel`, {
    reason,
  });
}

// ── GRNs ─────────────────────────────────────────────────

export function listGrns(params?: { page?: number }) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  const q = qs.toString();
  return api.get<GrnPaginated>(
    `${BASE}/goods-received-notes${q ? `?${q}` : ""}`,
  );
}

export function getGrn(id: string) {
  return api.get<GoodsReceivedNote>(`${BASE}/goods-received-notes/${id}`);
}

export function createGrn(input: {
  po_id: string;
  notes?: string;
  lines?: Array<{ po_line_id: string; quantity_received: number }>;
}) {
  return api.post<GoodsReceivedNote>(`${BASE}/goods-received-notes`, input);
}

export function postGrn(id: string) {
  return api.post<GoodsReceivedNote>(`${BASE}/goods-received-notes/${id}/post`);
}

// ── Supplier Invoices ─────────────────────────────────────

export function listSupplierInvoices(params?: {
  page?: number;
  status?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.status) qs.set("status", params.status);
  const q = qs.toString();
  return api.get<InvoicePaginated>(
    `${BASE}/supplier-invoices${q ? `?${q}` : ""}`,
  );
}

export function getSupplierInvoice(id: string) {
  return api.get<SupplierInvoice>(`${BASE}/supplier-invoices/${id}`);
}

export function createSupplierInvoice(input: {
  supplier_id: string;
  invoice_ref?: string;
  invoice_date: string;
  currency: string;
  total_original: number;
}) {
  return api.post<SupplierInvoice>(`${BASE}/supplier-invoices`, input);
}

export function matchSupplierInvoice(id: string) {
  return api.post<SupplierInvoice>(`${BASE}/supplier-invoices/${id}/match`);
}

export function approveSupplierInvoice(id: string) {
  return api.post<SupplierInvoice>(`${BASE}/supplier-invoices/${id}/approve`);
}

export function paySupplierInvoice(
  id: string,
  payment_method: string,
  payment_reference?: string,
) {
  return api.post<SupplierInvoice>(`${BASE}/supplier-invoices/${id}/pay`, {
    payment_method,
    payment_reference,
  });
}
