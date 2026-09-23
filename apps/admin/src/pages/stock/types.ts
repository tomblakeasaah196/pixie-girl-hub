export interface StockLocation {
  location_id: string;
  location_code: string;
  display_name: string;
  location_type: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  available_for_storefront: boolean;
  available_for_pos: boolean;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockLevel {
  level_id: string;
  variant_id: string;
  location_id: string;
  on_hand: number;
  reserved: number;
  available: number;
  last_movement_at: string | null;
  sku?: string;
  variant_name?: string;
  updated_at: string;
}

/** A BASE product row on the Products (available stock) tab — quantities
 *  summed across every variant of the base and, unless a location filter is
 *  applied, across every location. Physical count, not sellable availability:
 *  it includes inactive variants and non-storefront locations, so it
 *  reconciles with a stocktake rather than with a storefront badge. */
export interface ProductStockRow {
  product_id: string;
  product_code: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  hair_length_inches: number | null;
  lace_type: string | null;
  texture_type: string | null;
  primary_colour: string | null;
  is_visible_storefront: boolean;
  primary_image_url: string | null;
  /** Default variant's SKU (null when the base has no active variant). */
  sku: string | null;
  variant_count: number;
  /** Summed reorder point across active variants (0 = none set). */
  reorder_point: number;
  on_hand: number;
  reserved: number;
  available: number;
  /** Distinct locations physically holding units. */
  locations_stocked: number;
  last_movement_at: string | null;
  stock_state: "in_stock" | "low_stock" | "out_of_stock";
}

/** Totals for the Products tab — spans the search/location/category filters
 *  but NOT the stock-state filter, so the state chips can show their counts. */
export interface ProductStockSummary {
  products: number;
  in_stock: number;
  low_stock: number;
  out_of_stock: number;
  total_on_hand: number;
  total_reserved: number;
  total_available: number;
}

export interface ProductStockResponse {
  data: ProductStockRow[];
  meta: {
    page: number;
    page_size: number;
    total: number;
    has_more: boolean;
  };
  summary: ProductStockSummary;
}

export interface StockMovement {
  movement_id: string;
  movement_number: string;
  variant_id: string;
  location_id: string;
  quantity: number;
  movement_type: string;
  sales_channel?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  unit_cost_ngn?: string | null;
  notes?: string | null;
  performed_by: string | null;
  performed_by_name?: string | null;
  performed_at: string;
  sku?: string;
  variant_name?: string;
  product_name?: string;
  location_name?: string;
  /* ── Source document, resolved server-side from reference_type/_id ──
     A movement on its own ("SALE −1") can't be read; these name the document
     that caused it so the ledger answers "which order / which adjustment?". */
  reference_number?: string | null;
  order_id?: string | null;
  order_number?: string | null;
  order_status?: string | null;
  order_type?: string | null;
  order_placed_at?: string | null;
  order_sales_channel?: string | null;
  customer_name?: string | null;
  adjustment_id?: string | null;
  adjustment_number?: string | null;
  adjustment_status?: string | null;
  adjustment_type?: string | null;
  adjustment_reason?: string | null;
  transfer_id?: string | null;
  transfer_number?: string | null;
  transfer_status?: string | null;
  shipment_id?: string | null;
  shipment_number?: string | null;
  shipment_status?: string | null;
}

/** A movement plus the parties on its source document and the sibling lines
 *  of the same operation — the Movement Detail modal's payload. */
export interface StockMovementDetail extends StockMovement {
  adjustment_created_at?: string | null;
  adjustment_approved_at?: string | null;
  adjustment_created_by_name?: string | null;
  adjustment_approved_by_name?: string | null;
  transfer_from_location_name?: string | null;
  transfer_to_location_name?: string | null;
  related_movements?: Array<{
    movement_id: string;
    movement_number: string;
    movement_type: string;
    quantity: number;
    unit_cost_ngn?: string | null;
    performed_at: string;
    sku?: string | null;
    variant_name?: string | null;
    product_name?: string | null;
  }>;
}

export interface StockAdjustment {
  adjustment_id: string;
  adjustment_number: string;
  location_id: string;
  adjustment_type: string;
  reason: string;
  status: string;
  created_by: string;
  approved_by?: string | null;
  approved_at?: string | null;
  posted_at?: string | null;
  created_at: string;
  lines: AdjustmentLine[];
}

export interface AdjustmentLine {
  line_id: string;
  adjustment_id: string;
  variant_id: string;
  system_count: number;
  physical_count: number;
  delta: number;
  unit_cost_ngn?: string | null;
  notes?: string | null;
  sku?: string;
  variant_name?: string;
  product_name?: string;
}

export interface StockTransfer {
  transfer_id: string;
  transfer_number: string;
  from_location_id: string;
  to_location_id: string;
  status: string;
  reason?: string | null;
  carrier_name?: string | null;
  tracking_reference?: string | null;
  dispatched_by?: string | null;
  dispatched_at?: string | null;
  received_by?: string | null;
  received_at?: string | null;
  created_by: string;
  created_at: string;
  lines: TransferLine[];
}

export interface TransferLine {
  line_id: string;
  transfer_id: string;
  variant_id: string;
  qty_dispatched: number;
  qty_received?: number | null;
  variance?: number | null;
  notes?: string | null;
  sku?: string;
  variant_name?: string;
  product_name?: string;
}

export interface StockAlert {
  alert_id: string;
  variant_id: string;
  location_id?: string | null;
  alert_type: string;
  on_hand_at_detection: number;
  reorder_point: number;
  daily_velocity?: number | null;
  projected_days_left?: number | null;
  severity: string;
  status: string;
  suppression_key: string;
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  detected_at: string;
}

export interface InboundShipment {
  shipment_id: string;
  shipment_number: string;
  origin_country?: string | null;
  origin_port?: string | null;
  carrier_name?: string | null;
  tracking_reference?: string | null;
  shipping_method?: string | null;
  status: string;
  total_factory_cost_ngn?: string | null;
  total_freight_ngn?: string | null;
  total_customs_ngn?: string | null;
  total_other_ngn?: string | null;
  destination_location_id?: string | null;
  // Goods Reception register fields.
  destination_location_name?: string | null;
  received_at?: string | null;
  received_by_name?: string | null;
  created_by?: string | null;
  line_count?: number;
  created_at: string;
  lines: ShipmentLine[];
}

/** A Goods Reception line — a BASE product + quantity. No cost (Cost Vault
 *  owns it); the server resolves the base product to its default variant. */
export interface GoodsReceiptLine {
  product_id?: string; // base product → default SKU (legacy)
  variant_id?: string; // exact Care SKU, never a guessed default
  quantity: number;
  unit_cost_ngn?: number; // operational Care receipt cost; Cost Vault authorised
  po_line_id?: string;
}

export interface GoodsReceiptInput {
  destination_location_id: string;
  purchase_order_id?: string;
  received_at?: string;
  received_by_name?: string;
  notes?: string;
  lines: GoodsReceiptLine[];
}

/* ── Count import (Adjustments → Import Count) ─────────── */

/** How an empty Units cell, and a product the sheet never names, are read. */
export type CountBlankMode = "skip" | "zero";

export interface CountImportInput {
  /** Raw sheet rows, header -> cell. The server resolves header spellings. */
  rows: Record<string, string | number | null>[];
  location_id?: string;
  blank?: CountBlankMode;
  unlisted?: CountBlankMode;
  reason?: string;
  /** false = reconcile and return the preview without writing anything. */
  commit?: boolean;
  allow_unmatched?: boolean;
}

export interface CountImportLine {
  /** 'counted' came off the sheet; 'unlisted' is a sweep down to zero. */
  kind: "counted" | "unlisted";
  row: number | null;
  product_id: string;
  product_name: string;
  sku: string | null;
  system_count: number;
  physical_count: number;
  delta: number;
}

export interface CountImportResult {
  location: { location_id: string; display_name: string };
  lines: CountImportLine[];
  unmatched: { row: number; error: string }[];
  problems: { row: number | null; product_name: string; error: string }[];
  skipped: { row: number; product_name: string }[];
  conflicts: string[];
  bad_rows: { row: number; error: string }[];
  /** Non-empty = this sheet cannot be filed until a human resolves them. */
  blockers: string[];
  summary: {
    rows_read: number;
    combinations: number;
    matched: number;
    unchanged: number;
    corrections: number;
    zeroed: number;
    surplus: number;
    writeDown: number;
    net: number;
    system_total: number;
    /** Units the location will hold once the adjustment is posted. */
    ends_at: number;
  };
  adjustment: {
    adjustment_id: string;
    adjustment_number: string;
    status: string;
  } | null;
}

export interface ShipmentLine {
  line_id: string;
  shipment_id: string;
  variant_id: string;
  po_line_id?: string | null;
  qty_expected: number;
  qty_received?: number | null;
  qty_rejected?: number | null;
  unit_cost?: number | null;
  unit_cost_currency?: string | null;
  unit_cost_ngn?: string | null;
  fx_rate_used?: number | null;
  unit_weight_g?: number | null;
  notes?: string | null;
  sku?: string;
  variant_name?: string;
  product_name?: string;
}

export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    page_size: number;
    total: number;
    has_more: boolean;
  };
}

export interface ValuationSummary {
  sku_locations: number;
  total_units: number;
  total_value_ngn: string;
  missing_cost_count: number;
}

export interface ValuationLine {
  variant_id: string;
  location_id: string;
  location_name: string;
  product_id: string;
  sku: string;
  variant_name: string;
  on_hand: number;
  unit_cost_ngn: string;
  value_ngn: string;
}
