"use strict";

// Types match the DB entry_type CHECK and direction CHECK in factory_account_ledger

export type EntryType =
  | "order_charge"
  | "payment"
  | "shipping_fee"
  | "customs_duty"
  | "discount"
  | "bank_charge"
  | "misc_charge"
  | "misc_credit"
  | "adjustment";

export type EntryDirection = "DR" | "CR";

export type PaymentMethod =
  | "paypal"
  | "alipay"
  | "bank_transfer"
  | "wechat"
  | "alibaba"
  | "cash"
  | "other";

export type ShipmentStatus =
  | "dispatched"
  | "in_transit"
  | "arrived_lagos"
  | "cleared_customs"
  | "received"
  | "cancelled";

export type ProductionRunStatus =
  | "planned"
  | "funded"
  | "in_production"
  | "quality_check"
  | "ready_to_ship"
  | "in_transit"
  | "arrived_lagos"
  | "cleared_customs"
  | "received"
  | "completed"
  | "cancelled";

export interface FactoryAccount {
  account_id: string;
  supplier_id: string;
  supplier_name: string;
  country: string;
  account_name: string;
  base_currency: string;
  current_balance_base: number;
  credit_alert_threshold: number | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LedgerEntry {
  entry_id: string;
  account_id: string;
  entry_type: EntryType;
  direction: EntryDirection;
  amount_original: number;
  original_currency: string;
  fx_rate_to_base: number;
  amount_base: number;
  running_balance: number;
  reference_type: string | null;
  reference_id: string | null;
  description: string | null;
  entry_date: string;
  payment_method: PaymentMethod | null;
  paid_by: string | null;
  is_reconciled: boolean;
  created_at: string;
}

export interface LedgerPage {
  entries: LedgerEntry[];
  total: number;
}

export interface ShipmentItem {
  item_id: string;
  shipment_id: string;
  po_line_id: string | null;
  sku_description: string | null;
  quantity_shipped: number;
  unit_price_base: number | null;
  total_price_base: number | null;
}

export interface Shipment {
  shipment_id: string;
  shipment_ref: string;
  account_id: string;
  account_name: string;
  supplier_id: string;
  supplier_name: string;
  courier: string;
  tracking_number: string | null;
  courier_fee_original: number | null;
  courier_fee_currency: string;
  courier_fee_base: number | null;
  status: ShipmentStatus;
  shipped_at: string | null;
  estimated_arrival: string | null;
  arrived_at: string | null;
  grn_id: string | null;
  draft_po_id: string | null;
  notes: string | null;
  items: ShipmentItem[];
  created_at: string;
}

export interface ShipmentPage {
  shipments: Shipment[];
  total: number;
}

export interface CostComponent {
  component_id: string;
  run_id: string;
  cost_type: string;
  amount: number;
  currency: string;
  amount_ngn: number;
  incurred_at: string | null;
}

export interface ProductionRun {
  run_id: string;
  run_number: string;
  title: string;
  status: ProductionRunStatus;
  units_planned: number;
  units_received: number;
  total_landed_cost_ngn: number | null;
  per_unit_cost_ngn: number | null;
  created_at: string;
  updated_at: string;
  cost_components?: CostComponent[];
}

export interface ProductionRunPage {
  data: ProductionRun[];
  page: number;
  page_size: number;
  total: number;
}
