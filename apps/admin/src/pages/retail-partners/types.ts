/**
 * Retail / Consignment Partners (V2.2 §6.29, guide §2.21) — types.
 *
 * Field truth: migrations/template/000029_business_retail_partners.sql.template
 * (+ the contact/variant/location name JOINs the repo adds for display).
 * pg NUMERIC columns arrive as strings; integers arrive as numbers.
 */

export type PartnerStatus =
  | "pending_approval"
  | "active"
  | "suspended"
  | "terminated";

export type SettlementFrequency =
  | "weekly"
  | "fortnightly"
  | "monthly"
  | "quarterly";

export type MovementType =
  | "dispatch_to_partner"
  | "partner_sale"
  | "partner_return"
  | "partner_damage"
  | "partner_count_adjustment"
  | "recall_to_warehouse";

export type SettlementStatus =
  | "draft"
  | "reviewed"
  | "approved"
  | "invoiced"
  | "paid"
  | "disputed"
  | "closed";

export interface RetailPartner {
  partner_id: string;
  partner_code: string;
  contact_id: string;
  display_name: string;
  margin_share_pct: string; // NUMERIC(5,2) — % of sale value the partner keeps
  payment_terms_days: number;
  credit_limit_ngn: string | null;
  settlement_frequency: SettlementFrequency;
  status: PartnerStatus;
  onboarded_at: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  contract_document_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined from shared.contacts
  email: string | null;
  primary_phone: string | null;
  company_name: string | null;
}

export interface ConsignmentLocation {
  consignment_location_id: string;
  partner_id: string;
  stock_location_id: string;
  display_name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  manager_name: string | null;
  manager_phone: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ConsignmentStockRow {
  consignment_stock_id: string;
  consignment_location_id: string;
  partner_id: string;
  variant_id: string;
  qty_on_hand: number;
  qty_sold_since_last_settlement: number;
  qty_returned_since_last_settlement: number;
  agreed_retail_price_ngn: string | null;
  last_movement_at: string | null;
  updated_at: string;
  // Joined
  sku: string | null;
  variant_name: string | null;
  location_name: string | null;
  partner_name: string | null;
}

/** GET /retail-partners/:id returns the partner + its locations + stock. */
export interface PartnerDetail extends RetailPartner {
  locations: ConsignmentLocation[];
  stock: ConsignmentStockRow[];
}

export interface ConsignmentMovement {
  movement_id: string;
  movement_number: string;
  consignment_location_id: string;
  partner_id: string;
  variant_id: string;
  movement_type: MovementType;
  /** Signed: positive adds to the partner, negative removes. */
  quantity: number;
  unit_retail_price_ngn: string | null;
  partner_share_ngn: string | null;
  brand_share_ngn: string | null;
  reported_sale_at: string | null;
  reported_customer_name: string | null;
  settlement_id: string | null;
  stock_movement_id: string | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string;
  // Joined
  sku: string | null;
  variant_name: string | null;
  location_name: string | null;
  partner_name: string | null;
}

export interface PartnerSettlement {
  settlement_id: string;
  settlement_number: string;
  partner_id: string;
  period_start: string;
  period_end: string;
  total_gross_sales_ngn: string;
  total_returns_ngn: string;
  total_net_sales_ngn: string;
  total_partner_share_ngn: string;
  total_brand_share_ngn: string;
  total_damages_ngn: string;
  units_sold: number;
  units_returned: number;
  status: SettlementStatus;
  approved_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  invoice_id: string | null;
  settlement_document_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  partner_name: string | null;
}

export interface SettlementLine {
  line_id: string;
  settlement_id: string;
  variant_id: string | null;
  consignment_location_id: string | null;
  units_sold: number;
  units_returned: number;
  units_damaged: number;
  gross_sales_ngn: string;
  partner_share_ngn: string;
  brand_share_ngn: string;
  notes: string | null;
  display_order: number;
  // Joined
  sku: string | null;
  variant_name: string | null;
  location_name: string | null;
}

export interface SettlementDetail extends PartnerSettlement {
  lines: SettlementLine[];
}

/** Minimal stock-location shape used for the warehouse pick + chained
 *  partner_consignment location create (backend: stock module). */
export interface StockLocationLite {
  location_id: string;
  location_code: string;
  display_name: string;
  location_type: string;
  is_active: boolean;
}

/** Minimal contact shape for the partner↔contact link. */
export interface ContactHit {
  contact_id: string;
  display_name: string;
  company_name: string | null;
  email: string | null;
  primary_phone: string | null;
}

// ── Input payloads (mirror partners.validator.js — .strict(): only send set keys) ──

export interface PartnerCreateInput {
  contact_id: string;
  display_name: string;
  margin_share_pct?: number;
  payment_terms_days?: number;
  credit_limit_ngn?: number;
  settlement_frequency?: SettlementFrequency;
  onboarded_at?: string; // YYYY-MM-DD
  notes?: string;
}

export type PartnerUpdateInput = Partial<Omit<PartnerCreateInput, "contact_id" | "onboarded_at">>;

export interface LocationCreateInput {
  stock_location_id: string;
  display_name: string;
  address?: string;
  city?: string;
  state?: string;
  manager_name?: string;
  manager_phone?: string;
}

export interface MovementInput {
  consignment_location_id: string;
  variant_id: string;
  movement_type: MovementType;
  units: number;
  unit_retail_price_ngn?: number;
  reported_sale_at?: string; // YYYY-MM-DD
  reported_customer_name?: string;
  warehouse_location_id?: string;
  notes?: string;
}

export interface SettlementGenerateInput {
  partner_id: string;
  period_start: string; // YYYY-MM-DD
  period_end: string; // YYYY-MM-DD
}

// ── Display maps ──────────────────────────────────────────

export const FREQUENCY_LABEL: Record<SettlementFrequency, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = {
  pending_approval: "Pending approval",
  active: "Active",
  suspended: "Suspended",
  terminated: "Terminated",
};

export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  dispatch_to_partner: "Dispatch to partner",
  partner_sale: "Partner sale",
  partner_return: "Partner return",
  partner_damage: "Damage",
  partner_count_adjustment: "Count adjustment",
  recall_to_warehouse: "Recall to warehouse",
};

export const SETTLEMENT_STATUS_LABEL: Record<SettlementStatus, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  approved: "Approved",
  invoiced: "Invoiced",
  paid: "Paid",
  disputed: "Disputed",
  closed: "Closed",
};

/** pg NUMERIC → number for arithmetic/format (never for writing back). */
export const num = (v: string | number | null | undefined): number =>
  v == null || v === "" ? 0 : Number(v);
