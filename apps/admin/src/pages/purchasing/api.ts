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

export async function listSuppliers() {
  // The endpoint returns { data, meta }; the api client passes that through.
  // Suppliers are consumed as a bare array, so normalise either shape.
  const r = await api.get<Supplier[] | { data: Supplier[] }>(`${BASE}/suppliers`);
  return Array.isArray(r) ? r : (r?.data ?? []);
}

export function getSupplier(id: string) {
  return api.get<Supplier>(`${BASE}/suppliers/${id}`);
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

export function createPo(input: {
  supplier_id: string;
  lines: Array<{
    description: string;
    quantity: number;
    unit_price_original: number;
    currency: string;
    variant_id?: string;
    lace_type?: string;
    hair_color?: string;
    hair_texture?: string;
    cap_size?: string;
    baby_hair?: string;
    hair_length?: string;
    density?: string;
    manufacturing_location?: string;
    factory_order_ref?: string;
  }>;
}) {
  return api.post<PurchaseOrder>(`${BASE}/purchase-orders`, input);
}

export function submitPo(id: string) {
  return api.post<PurchaseOrder>(`${BASE}/purchase-orders/${id}/submit`);
}

export function approvePo(id: string) {
  return api.post<PurchaseOrder>(`${BASE}/purchase-orders/${id}/approve`);
}

export function advancePo(id: string, status: string, notes?: string) {
  return api.post<PurchaseOrder>(`${BASE}/purchase-orders/${id}/advance`, {
    status,
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
