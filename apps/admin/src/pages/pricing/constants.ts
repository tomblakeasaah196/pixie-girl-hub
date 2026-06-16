import type { Tone } from "@/components/ui/primitives";
import type { ProposalStatus, RuleType, FloorType } from "./types";

// ── Channel Fees (D-7 gross-up formula) ─────────────────────────────────────
// gross = (net + fixed_fee) / (1 - pct_fee)

export interface ChannelFee {
  label: string;
  pct_fee: number;    // as decimal: 0.12 = 12%
  fixed_fee_ngn: number;
  icon: string;       // emoji shorthand
}

export const CHANNEL_FEES: Record<string, ChannelFee> = {
  jumia: {
    label: "Jumia",
    pct_fee: 0.12,
    fixed_fee_ngn: 0,
    icon: "🟠",
  },
  konga: {
    label: "Konga",
    pct_fee: 0.10,
    fixed_fee_ngn: 0,
    icon: "🔵",
  },
  instagram: {
    label: "Instagram (COD)",
    pct_fee: 0,
    fixed_fee_ngn: 500,
    icon: "📸",
  },
  website: {
    label: "Website",
    pct_fee: 0.029,
    fixed_fee_ngn: 100,
    icon: "🌐",
  },
  wholesale: {
    label: "Wholesale",
    pct_fee: 0,
    fixed_fee_ngn: 0,
    icon: "📦",
  },
};

/** D-7 gross-up: what to list on the channel so the net received = net_price */
export function grossUp(netPrice: number, channel: string): number {
  const fee = CHANNEL_FEES[channel];
  if (!fee) return netPrice;
  return (netPrice + fee.fixed_fee_ngn) / (1 - fee.pct_fee);
}

/** Reverse of grossUp: net received from a given gross listing price */
export function netFromGross(grossPrice: number, channel: string): number {
  const fee = CHANNEL_FEES[channel];
  if (!fee) return grossPrice;
  return grossPrice * (1 - fee.pct_fee) - fee.fixed_fee_ngn;
}

/** Compute margin % from cost and net price */
export function marginPct(cost: number, netPrice: number): number {
  if (netPrice <= 0) return 0;
  return ((netPrice - cost) / netPrice) * 100;
}

/** Compute markup % from cost and net price */
export function markupPct(cost: number, netPrice: number): number {
  if (cost <= 0) return 0;
  return ((netPrice - cost) / cost) * 100;
}

/** Derive retail price from cost + target margin % */
export function priceFromMargin(cost: number, targetMarginPct: number): number {
  const m = targetMarginPct / 100;
  if (m >= 1) return cost * 1000; // guard against division by zero
  return cost / (1 - m);
}

/** Derive retail price from cost + target markup % */
export function priceFromMarkup(cost: number, targetMarkupPct: number): number {
  return cost * (1 + targetMarkupPct / 100);
}

// ── Proposal Status Meta ─────────────────────────────────────────────────────

interface StatusMeta {
  label: string;
  tone: Tone;
}

export const PROPOSAL_STATUS_META: Record<ProposalStatus, StatusMeta> = {
  pending: { label: "Pending", tone: "warn" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};

// ── Rule Types ───────────────────────────────────────────────────────────────

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  markup_pct: "Markup %",
  margin_pct: "Margin %",
  fixed_price: "Fixed Price",
  channel_override: "Channel Override",
  seasonal: "Seasonal",
};

export const RULE_TYPE_OPTIONS: { value: RuleType; label: string }[] = [
  { value: "markup_pct", label: "Markup %" },
  { value: "margin_pct", label: "Margin %" },
  { value: "fixed_price", label: "Fixed Price" },
  { value: "channel_override", label: "Channel Override" },
  { value: "seasonal", label: "Seasonal" },
];

// ── Floor Types ───────────────────────────────────────────────────────────────

export const FLOOR_TYPE_LABELS: Record<FloorType, string> = {
  absolute: "Absolute Price",
  cost_plus_pct: "Cost + %",
  cost_plus_fixed: "Cost + Fixed Amount",
};

export const FLOOR_TYPE_OPTIONS: { value: FloorType; label: string }[] = [
  { value: "absolute", label: "Absolute Price (₦)" },
  { value: "cost_plus_pct", label: "Cost + Percentage" },
  { value: "cost_plus_fixed", label: "Cost + Fixed Amount (₦)" },
];

// ── Proposal Status Tabs ─────────────────────────────────────────────────────

export const PROPOSAL_STATUS_TABS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
] as const;

// ── Sensitivity grid config ───────────────────────────────────────────────────

/** Number of ± cost steps in the sensitivity grid */
export const SENSITIVITY_STEPS = 5;
/** % shift per step */
export const SENSITIVITY_STEP_PCT = 0.02; // 2% per step = ±10% total

/** Colour thresholds for the sensitivity grid cells */
export const MARGIN_THRESHOLD_WARN = 15;  // below 15% = warn
export const MARGIN_THRESHOLD_DANGER = 5; // below 5% = danger
