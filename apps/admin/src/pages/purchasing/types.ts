export type PoStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "in_production"
  | "quality_check"
  | "ready_to_ship"
  | "in_transit"
  | "arrived_lagos"
  | "cleared_customs"
  | "partially_received"
  | "received"
  | "closed"
  | "cancelled";

export interface Supplier {
  supplier_id: string;
  supplier_code: string;
  supplier_name: string;
  country: string | null;
  email: string | null;
  phone: string | null;
  currency: string;
  is_active: boolean;
  contact_count?: number;
  product_count?: number;
}

export interface PoLine {
  line_id: string;
  po_id: string;
  variant_id: string | null;
  description: string;
  quantity: number;
  unit_price_original: string;
  currency: string;
  line_total_original: string | null;
  unit_price_ngn: string | null;
  line_total_ngn: string | null;
  // Wig attributes
  factory_order_ref: string | null;
  manufacturing_location: string | null;
  lace_type: string | null;
  hair_color: string | null;
  hair_texture: string | null;
  cap_size: string | null;
  baby_hair: string | null;
  hair_length: string | null;
  density: string | null;
  expected_photo_url: string | null;
}

export interface PurchaseOrder {
  po_id: string;
  po_number: string;
  supplier_id: string;
  supplier_name?: string;
  status: PoStatus;
  currency: string;
  total_original: string | null;
  total_ngn: string | null;
  factory_account_id: string | null;
  is_factory_order: boolean;
  factory_shipment_id: string | null;
  created_at: string;
  updated_at: string;
  lines?: PoLine[];
}

export interface PoPaginated {
  data: PurchaseOrder[];
  total: number;
  page: number;
  page_size: number;
}

export interface GoodsReceivedNote {
  grn_id: string;
  grn_number: string;
  po_id: string | null;
  po_number?: string;
  received_by: string | null;
  received_at: string;
  status: "draft" | "posted";
  notes: string | null;
}

export interface GrnPaginated {
  data: GoodsReceivedNote[];
  total: number;
  page: number;
  page_size: number;
}

export interface SupplierInvoice {
  invoice_id: string;
  invoice_number: string;
  supplier_id: string;
  supplier_name?: string;
  invoice_ref: string | null;
  invoice_date: string;
  due_date: string | null;
  currency: string;
  total_original: string;
  total_ngn: string | null;
  match_status: "unmatched" | "matched" | "mismatch" | "manual_review";
  payment_status: "unpaid" | "partial" | "paid";
  status: "draft" | "approved" | "voided";
  created_at: string;
}

export interface InvoicePaginated {
  data: SupplierInvoice[];
  total: number;
  page: number;
  page_size: number;
}
