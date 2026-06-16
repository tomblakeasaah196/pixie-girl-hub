import type { Tone } from "@/components/ui/primitives";
import type { EntryType, ShipmentStatus, ProductionRunStatus } from "./types";

export const ENTRY_TYPE_META: Record<
  EntryType,
  { label: string; labelZh: string; direction: "DR" | "CR"; tone: Tone }
> = {
  order_charge:  { label: "Order Charge",   labelZh: "订单收费",   direction: "DR", tone: "info"    },
  payment:       { label: "Payment",         labelZh: "付款",       direction: "CR", tone: "success" },
  shipping_fee:  { label: "Shipping Fee",    labelZh: "运费",       direction: "DR", tone: "warn"    },
  customs_duty:  { label: "Customs Duty",    labelZh: "关税",       direction: "DR", tone: "warn"    },
  discount:      { label: "Discount",        labelZh: "折扣",       direction: "CR", tone: "accent"  },
  bank_charge:   { label: "Bank Charge",     labelZh: "银行手续费", direction: "DR", tone: "neutral" },
  misc_charge:   { label: "Misc. Charge",    labelZh: "其他费用",   direction: "DR", tone: "neutral" },
  misc_credit:   { label: "Misc. Credit",    labelZh: "其他收入",   direction: "CR", tone: "success" },
  adjustment:    { label: "Adjustment",      labelZh: "调整",       direction: "DR", tone: "neutral" },
};

export const PAYMENT_METHOD_LABELS: Record<string, { label: string; labelZh: string }> = {
  paypal:        { label: "PayPal",          labelZh: "贝宝"        },
  alipay:        { label: "Alipay",          labelZh: "支付宝"      },
  bank_transfer: { label: "Bank Transfer",   labelZh: "银行转账"    },
  wechat:        { label: "WeChat Pay",      labelZh: "微信支付"    },
  alibaba:       { label: "Alibaba",         labelZh: "阿里巴巴"    },
  cash:          { label: "Cash",            labelZh: "现金"        },
  other:         { label: "Other",           labelZh: "其他"        },
};

export const SHIPMENT_STATUS_META: Record<ShipmentStatus, { label: string; labelZh: string; tone: Tone }> = {
  dispatched:       { label: "Dispatched",      labelZh: "已发货",    tone: "accent"  },
  in_transit:       { label: "In Transit",      labelZh: "运输中",    tone: "info"    },
  arrived_lagos:    { label: "Arrived Lagos",   labelZh: "已到拉各斯", tone: "warn"   },
  cleared_customs:  { label: "Cleared Customs", labelZh: "清关完成",  tone: "warn"    },
  received:         { label: "Received",        labelZh: "已收货",    tone: "success" },
  cancelled:        { label: "Cancelled",       labelZh: "已取消",    tone: "neutral" },
};

export const RUN_STATUS_META: Record<ProductionRunStatus, { label: string; tone: Tone }> = {
  planned:         { label: "Planned",         tone: "neutral" },
  funded:          { label: "Funded",          tone: "info"    },
  in_production:   { label: "In Production",   tone: "accent"  },
  quality_check:   { label: "Quality Check",   tone: "warn"    },
  ready_to_ship:   { label: "Ready to Ship",   tone: "info"    },
  in_transit:      { label: "In Transit",      tone: "info"    },
  arrived_lagos:   { label: "Arrived Lagos",   tone: "warn"    },
  cleared_customs: { label: "Cleared Customs", tone: "warn"    },
  received:        { label: "Received",        tone: "success" },
  completed:       { label: "Completed",       tone: "success" },
  cancelled:       { label: "Cancelled",       tone: "neutral" },
};
