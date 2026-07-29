import type { Tone } from "@/components/ui/primitives";
import type {
  CostType,
  EntryType,
  ShipmentStatus,
  ProductionRunStatus,
} from "./types";

export const ENTRY_TYPE_META: Record<
  EntryType,
  { label: string; labelZh: string; direction: "DR" | "CR"; tone: Tone }
> = {
  order_charge: {
    label: "Order Charge",
    labelZh: "订单收费",
    direction: "DR",
    tone: "info",
  },
  payment: {
    label: "Payment",
    labelZh: "付款",
    direction: "CR",
    tone: "success",
  },
  shipping_fee: {
    label: "Shipping Fee",
    labelZh: "运费",
    direction: "DR",
    tone: "warn",
  },
  customs_duty: {
    label: "Customs Duty",
    labelZh: "关税",
    direction: "DR",
    tone: "warn",
  },
  discount: {
    label: "Discount",
    labelZh: "折扣",
    direction: "CR",
    tone: "accent",
  },
  bank_charge: {
    label: "Bank Charge",
    labelZh: "银行手续费",
    direction: "DR",
    tone: "neutral",
  },
  misc_charge: {
    label: "Misc. Charge",
    labelZh: "其他费用",
    direction: "DR",
    tone: "neutral",
  },
  misc_credit: {
    label: "Misc. Credit",
    labelZh: "其他收入",
    direction: "CR",
    tone: "success",
  },
  adjustment: {
    label: "Adjustment",
    labelZh: "调整",
    direction: "DR",
    tone: "neutral",
  },
};

export const PAYMENT_METHOD_LABELS: Record<
  string,
  { label: string; labelZh: string }
> = {
  paypal: { label: "PayPal", labelZh: "贝宝" },
  alipay: { label: "Alipay", labelZh: "支付宝" },
  bank_transfer: { label: "Bank Transfer", labelZh: "银行转账" },
  wechat: { label: "WeChat Pay", labelZh: "微信支付" },
  alibaba: { label: "Alibaba", labelZh: "阿里巴巴" },
  cash: { label: "Cash", labelZh: "现金" },
  other: { label: "Other", labelZh: "其他" },
};

export const SHIPMENT_STATUS_META: Record<
  ShipmentStatus,
  { label: string; labelZh: string; tone: Tone }
> = {
  dispatched: { label: "Dispatched", labelZh: "已发货", tone: "accent" },
  in_transit: { label: "In Transit", labelZh: "运输中", tone: "info" },
  arrived_lagos: {
    label: "Arrived Lagos",
    labelZh: "已到拉各斯",
    tone: "warn",
  },
  cleared_customs: {
    label: "Cleared Customs",
    labelZh: "清关完成",
    tone: "warn",
  },
  received: { label: "Received", labelZh: "已收货", tone: "success" },
  cancelled: { label: "Cancelled", labelZh: "已取消", tone: "neutral" },
};

// `label` is the English fallback; the module renders `t(i18nKey)` so a factory
// manager on the Chinese locale sees Chinese status pills too.
export const RUN_STATUS_META: Record<
  ProductionRunStatus,
  { label: string; i18nKey: string; tone: Tone }
> = {
  planned: { label: "Planned", i18nKey: "runStatus.planned", tone: "neutral" },
  funded: { label: "Funded", i18nKey: "runStatus.funded", tone: "info" },
  in_production: {
    label: "In Production",
    i18nKey: "runStatus.in_production",
    tone: "accent",
  },
  quality_check: {
    label: "Quality Check",
    i18nKey: "runStatus.quality_check",
    tone: "warn",
  },
  ready_to_ship: {
    label: "Ready to Ship",
    i18nKey: "runStatus.ready_to_ship",
    tone: "info",
  },
  in_transit: {
    label: "In Transit",
    i18nKey: "runStatus.in_transit",
    tone: "info",
  },
  arrived_lagos: {
    label: "Arrived Lagos",
    i18nKey: "runStatus.arrived_lagos",
    tone: "warn",
  },
  cleared_customs: {
    label: "Cleared Customs",
    i18nKey: "runStatus.cleared_customs",
    tone: "warn",
  },
  received: {
    label: "Received",
    i18nKey: "runStatus.received",
    tone: "success",
  },
  completed: {
    label: "Completed",
    i18nKey: "runStatus.completed",
    tone: "success",
  },
  cancelled: {
    label: "Cancelled",
    i18nKey: "runStatus.cancelled",
    tone: "neutral",
  },
};

/**
 * The run status machine — which states may follow the current one. Mirrors the
 * factory → Lagos → warehouse journey; `cancelled` is only reachable before the
 * factory starts cutting hair.
 */
export const RUN_STATUS_FLOW: Record<string, ProductionRunStatus[]> = {
  planned: ["funded", "in_production", "cancelled"],
  funded: ["in_production", "cancelled"],
  in_production: ["quality_check", "ready_to_ship"],
  quality_check: ["ready_to_ship", "in_production"],
  ready_to_ship: ["in_transit"],
  in_transit: ["arrived_lagos"],
  arrived_lagos: ["cleared_customs"],
  cleared_customs: ["received"],
  received: ["completed"],
};

/**
 * The 14 cost types the DB allows on a run, in the order they are incurred:
 * what the factory charges, then getting it to Lagos, then finishing it here.
 * `factory_unit_cost` is written by the product lines, so it is not offered in
 * the manual cost form — grouping it here keeps the display labels in one place.
 */
export const COST_TYPE_META: Record<
  CostType,
  { label: string; i18nKey: string; group: "factory" | "inbound" | "lagos" }
> = {
  factory_unit_cost: {
    label: "Factory Unit Cost",
    i18nKey: "costType.factory_unit_cost",
    group: "factory",
  },
  factory_overhead: {
    label: "Factory Overhead",
    i18nKey: "costType.factory_overhead",
    group: "factory",
  },
  raw_hair: {
    label: "Raw Hair",
    i18nKey: "costType.raw_hair",
    group: "factory",
  },
  quality_inspection: {
    label: "Quality Inspection",
    i18nKey: "costType.quality_inspection",
    group: "factory",
  },
  freight_international: {
    label: "International Freight",
    i18nKey: "costType.freight_international",
    group: "inbound",
  },
  customs_duty: {
    label: "Customs Duty",
    i18nKey: "costType.customs_duty",
    group: "inbound",
  },
  customs_clearing_fee: {
    label: "Customs Clearing Fee",
    i18nKey: "costType.customs_clearing_fee",
    group: "inbound",
  },
  port_storage: {
    label: "Port Storage / Demurrage",
    i18nKey: "costType.port_storage",
    group: "inbound",
  },
  "3pl_lagos": {
    label: "3PL Lagos",
    i18nKey: "costType.3pl_lagos",
    group: "inbound",
  },
  styling_intercompany: {
    label: "Styling (Intercompany)",
    i18nKey: "costType.styling_intercompany",
    group: "lagos",
  },
  packaging: {
    label: "Packaging",
    i18nKey: "costType.packaging",
    group: "lagos",
  },
  wastage: { label: "Wastage", i18nKey: "costType.wastage", group: "lagos" },
  samples: { label: "Samples", i18nKey: "costType.samples", group: "lagos" },
  misc: { label: "Miscellaneous", i18nKey: "costType.misc", group: "lagos" },
};

/** Selectable in the manual cost form — everything except the factory charge,
 *  which the product lines own so the two can never disagree. */
export const MANUAL_COST_TYPES = (
  Object.keys(COST_TYPE_META) as CostType[]
).filter((k) => k !== "factory_unit_cost");

/** Currencies a factory run is normally priced in. */
export const RUN_CURRENCIES = ["CNY", "USD", "NGN", "EUR", "GBP"];
