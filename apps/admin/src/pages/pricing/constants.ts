import type { Tone } from "@/components/ui/primitives";
import type { ProposalStatus, RuleType, FloorType } from "./types";

export interface ChannelFee {
  label: string;
  pct_fee: number;
  fixed_fee_ngn: number;
  icon: string;
}

export const CHANNEL_FEES: Record<string, ChannelFee> = {
  jumia: { label: "Jumia", pct_fee: 0.12, fixed_fee_ngn: 0, icon: "🟠" },
  konga: { label: "Konga", pct_fee: 0.10, fixed_fee_ngn: 0, icon: "🔵" },
  instagram: { label: "Instagram (COD)", pct_fee: 0, fixed_fee_ngn: 500, icon: "📸" },
  website: { label: "Website", pct_fee: 0.029, fixed_fee_ngn: 100, icon: "🌐" },
  wholesale: { label: "Wholesale", pct_fee: 0, fixed_fee_ngn: 0, icon: "📦" },
};

export function grossUp(netPrice: number, channel: string): number {
  const fee = CHANNEL_FEES[channel];
  if (!fee) return netPrice;
  return (netPrice + fee.fixed_fee_ngn) / (1 - fee.pct_fee);
}

export function marginPct(cost: number, netPrice: number): number {
  if (netPrice <= 0) return 0;
  return ((netPrice - cost) / netPrice) * 100;
}

export function markupPct(cost: number, price: number): number {
  if (cost <= 0) return 0;
  return ((price - cost) / cost) * 100;
}

export function priceFromMargin(cost: number, targetMarginPct: number): number {
  const m = targetMarginPct / 100;
  if (m >= 1) return cost * 1000;
  return cost / (1 - m);
}

interface StatusMeta {
  label: string;
  tone: Tone;
}

export const PROPOSAL_STATUS_META: Record<ProposalStatus, StatusMeta> = {
  pending_approval: { label: "Pending", tone: "warn" },
  approved: { label: "Approved", tone: "success" },
  applied: { label: "Applied", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  reverted: { label: "Reverted", tone: "neutral" },
};

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  markup_pct: "Markup %",
  target_margin_pct: "Target Margin %",
  fixed_price: "Fixed Price",
  discount_pct: "Discount %",
  min_price: "Minimum Price",
  cost_pass_through: "Cost Pass-Through",
  tiered_quantity: "Tiered Quantity",
};

export const RULE_TYPE_OPTIONS: { value: RuleType; label: string }[] = [
  { value: "markup_pct", label: "Markup %" },
  { value: "target_margin_pct", label: "Target Margin %" },
  { value: "fixed_price", label: "Fixed Price" },
  { value: "discount_pct", label: "Discount %" },
];

export const FLOOR_TYPE_LABELS: Record<FloorType, string> = {
  min_price_ngn: "Minimum Price (₦)",
  min_margin_pct: "Minimum Margin (%)",
  min_markup_pct: "Minimum Markup (%)",
};

export const FLOOR_TYPE_OPTIONS: { value: FloorType; label: string }[] = [
  { value: "min_price_ngn", label: "Minimum Price (₦)" },
  { value: "min_margin_pct", label: "Minimum Margin (%)" },
  { value: "min_markup_pct", label: "Minimum Markup (%)" },
];
