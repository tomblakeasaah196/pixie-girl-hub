import type { Tone } from "@/components/ui/primitives";
import type {
  Basis,
  Channel,
  CostSource,
  FloorType,
  GoalType,
  ProposalStatus,
  RuleType,
  ScenarioStatus,
  ScopeType,
} from "./types";

// ── Channels ─────────────────────────────────────────────────────────────────
// The advisor accepts any channel string; overrides accept this fixed set.
export const CHANNEL_OPTIONS: { value: Channel; label: string }[] = [
  { value: "storefront", label: "Storefront" },
  { value: "pos", label: "POS" },
  { value: "wholesale", label: "Wholesale" },
  { value: "partner", label: "Partner" },
  { value: "intercompany", label: "Intercompany" },
  { value: "instagram", label: "Instagram" },
];

export const CHANNEL_LABEL: Record<string, string> = {
  storefront: "Storefront",
  pos: "POS",
  wholesale: "Wholesale",
  partner: "Partner",
  intercompany: "Intercompany",
  instagram: "Instagram",
};

export function channelLabel(c: string | null | undefined): string {
  if (!c) return "All channels";
  return CHANNEL_LABEL[c] ?? c;
}

// ── Advisor basis ────────────────────────────────────────────────────────────
export const BASIS_OPTIONS: { value: Basis; label: string }[] = [
  { value: "margin", label: "Target margin" },
  { value: "markup", label: "Target markup" },
  { value: "price", label: "Target price" },
];

// Slider bounds per basis (margin 0–90, markup 0–300, step 1).
export const SLIDER_BOUNDS: Record<Basis, { min: number; max: number; step: number } | null> = {
  margin: { min: 0, max: 90, step: 1 },
  markup: { min: 0, max: 300, step: 1 },
  price: null,
};

// ── Cost source chips ────────────────────────────────────────────────────────
export const COST_SOURCE_META: Record<CostSource, { label: string; tone: Tone }> = {
  vault: { label: "Vault", tone: "accent" },
  operational: { label: "Operational", tone: "info" },
  override: { label: "Override", tone: "warn" },
  none: { label: "Cost hidden", tone: "neutral" },
};

// ── Rule types (7 real types) ────────────────────────────────────────────────
export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  markup_pct: "Markup %",
  target_margin_pct: "Target margin %",
  fixed_price: "Fixed price",
  discount_pct: "Discount %",
  min_price: "Min price",
  cost_pass_through: "Cost pass-through",
  tiered_quantity: "Tiered quantity",
};

export const RULE_TYPE_OPTIONS: { value: RuleType; label: string }[] = (
  Object.keys(RULE_TYPE_LABELS) as RuleType[]
).map((v) => ({ value: v, label: RULE_TYPE_LABELS[v] }));

/** Rule types whose value is a money figure (NGN) rather than a percent. */
export const RULE_VALUE_IS_NGN: Record<RuleType, boolean> = {
  markup_pct: false,
  target_margin_pct: false,
  fixed_price: true,
  discount_pct: false,
  min_price: true,
  cost_pass_through: false,
  tiered_quantity: false,
};

// ── Floor types ──────────────────────────────────────────────────────────────
export const FLOOR_TYPE_LABELS: Record<FloorType, string> = {
  min_price_ngn: "Min price (₦)",
  min_margin_pct: "Min margin %",
  min_markup_pct: "Min markup %",
};

export const FLOOR_TYPE_OPTIONS: { value: FloorType; label: string }[] = (
  Object.keys(FLOOR_TYPE_LABELS) as FloorType[]
).map((v) => ({ value: v, label: FLOOR_TYPE_LABELS[v] }));

export const FLOOR_VALUE_IS_NGN: Record<FloorType, boolean> = {
  min_price_ngn: true,
  min_margin_pct: false,
  min_markup_pct: false,
};

// ── Scenario meta ────────────────────────────────────────────────────────────
export const SCOPE_TYPE_OPTIONS: { value: ScopeType; label: string }[] = [
  { value: "all_active", label: "All active products" },
  { value: "category", label: "Specific categories" },
  { value: "specific_products", label: "Specific products" },
  { value: "specific_variants", label: "Specific variants" },
];

export const GOAL_TYPE_OPTIONS: { value: GoalType; label: string }[] = [
  { value: "target_margin", label: "Target margin" },
  { value: "target_price", label: "Target price" },
  { value: "target_revenue", label: "Target revenue" },
  { value: "sensitivity_only", label: "Sensitivity only" },
];

export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  target_margin: "Target margin",
  target_price: "Target price",
  target_revenue: "Target revenue",
  sensitivity_only: "Sensitivity only",
};

export const SCENARIO_STATUS_META: Record<ScenarioStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  computed: { label: "Computed", tone: "info" },
  proposed: { label: "Proposed", tone: "warn" },
  applied: { label: "Applied", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  archived: { label: "Archived", tone: "neutral" },
};

export const SCENARIO_STATUS_TABS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "computed", label: "Computed" },
  { value: "proposed", label: "Proposed" },
  { value: "applied", label: "Applied" },
] as const;

// ── Proposal meta ────────────────────────────────────────────────────────────
export const PROPOSAL_STATUS_META: Record<ProposalStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending_approval: { label: "Pending approval", tone: "warn" },
  approved: { label: "Approved", tone: "success" },
  applied: { label: "Applied", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  reverted: { label: "Reverted", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};

export const PROPOSAL_STATUS_TABS = [
  { value: "", label: "All" },
  { value: "pending_approval", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "applied", label: "Applied" },
  { value: "rejected", label: "Rejected" },
] as const;

// ── Small helpers ────────────────────────────────────────────────────────────
export function fmtPct(n: number | null | undefined, dp = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(dp)}%`;
}

/** Margin colour bands (re-used by advisor + scenario results). */
export function marginTone(pct: number | null | undefined): Tone {
  if (pct == null) return "neutral";
  if (pct < 20) return "danger";
  if (pct < 35) return "warn";
  return "success";
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}
