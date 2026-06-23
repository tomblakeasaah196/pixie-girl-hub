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
  performed_at: string;
  sku?: string;
  variant_name?: string;
  location_name?: string;
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
  product_id: string;
  quantity: number;
}

export interface GoodsReceiptInput {
  destination_location_id: string;
  received_at?: string;
  received_by_name?: string;
  notes?: string;
  lines: GoodsReceiptLine[];
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
