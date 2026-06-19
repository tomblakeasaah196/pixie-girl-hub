// ── Pricing Engine Types — mirror the REAL backend contract (/pricing). ──────
// Every money field is a STRING (e.g. "111111.11"); render with
// <MoneyText ngn={Number(x)} />. List endpoints return a plain array.

export type Channel =
  | "storefront"
  | "pos"
  | "wholesale"
  | "partner"
  | "intercompany"
  | "instagram";

export type Basis = "margin" | "markup" | "price";

export type CostSource = "vault" | "operational" | "override" | "none";

// ── Advisor (centerpiece) ────────────────────────────────────────────────────

export interface RecommendInput {
  variant_id: string;
  channel?: string;
  basis?: Basis;
  target_value?: number;
  cost_override_ngn?: number;
  net_of_channel_fee?: boolean;
}

export interface ChannelFeeInfo {
  pct: number;
  fixed_ngn: number;
}

export interface Recommendation {
  variant_id: string;
  channel: string;
  basis: Basis;
  product_name: string;
  sku: string | null;
  variant_name: string | null;
  cost_ngn: string;
  cost_source: CostSource;
  current_price_ngn: string | null;
  suggested_price_ngn: string;
  net_ngn: string;
  margin_pct: number;
  markup_pct: number;
  floor_ngn: string | null;
  floor_breached: boolean;
  channel_fee: ChannelFeeInfo | null;
  vat_rate: number; // percent
  vat_amount_ngn: string;
  rounded: boolean;
  price_usd: string | null;
  delta_pct: number | null;
  within_threshold: boolean;
  threshold_pct: number;
}

export interface ApplyInput {
  variant_id: string;
  channel?: string;
  new_price_ngn: number;
  reason?: string;
}

export interface ApplyResult {
  applied: boolean;
  variant_id: string;
  channel: string;
  new_price_ngn?: string;
  delta_pct: number | null;
  // Present only when applied === false.
  reason?: "over_threshold" | "below_floor";
  proposal_id?: string;
  proposal_number?: string;
}

// ── Config / Settings ────────────────────────────────────────────────────────

export interface ConfigChannelFee {
  channel: string;
  label: string;
  pct: number;
  fixed_ngn: number;
}

export interface PricingConfig {
  instant_apply_threshold_pct: number;
  default_target_margin_pct: number;
  round_to_ngn: number;
  channel_fees: ConfigChannelFee[];
  updated_at: string | null;
}

export interface UpdateConfigInput {
  instant_apply_threshold_pct?: number;
  default_target_margin_pct?: number;
  round_to_ngn?: number;
  channel_fees?: ConfigChannelFee[];
}

// ── Scenarios ────────────────────────────────────────────────────────────────

export type ScopeType =
  | "all_active"
  | "category"
  | "specific_products"
  | "specific_variants";

export type GoalType =
  | "target_margin"
  | "target_price"
  | "target_revenue"
  | "sensitivity_only";

export type ScenarioStatus =
  | "draft"
  | "computed"
  | "proposed"
  | "applied"
  | "rejected"
  | "archived";

export interface Scenario {
  scenario_id: string;
  scenario_name: string;
  description: string | null;
  scope_type: ScopeType;
  goal_type: GoalType;
  goal_value: number | null;
  channel: string | null;
  status: ScenarioStatus;
  assumed_monthly_units: number | null;
  computed_units_analysed: number | null;
  computed_avg_new_price_ngn: string | null;
  computed_avg_margin_pct: number | null;
  computed_projected_revenue_ngn: string | null;
  computed_at: string | null;
  created_at: string;
}

export interface ScenarioResult {
  result_id: string;
  variant_id: string;
  cost_ngn: string;
  current_price_ngn: string | null;
  current_margin_pct: number | null;
  proposed_price_ngn: string;
  proposed_margin_pct: number;
  proposed_markup_pct: number;
  margin_at_cost_minus_10: number | null;
  margin_at_cost_plus_10: number | null;
  margin_at_fx_minus_10: number | null;
  margin_at_fx_plus_10: number | null;
  floor_breached: boolean;
  floor_breach_notes: string | null;
  projected_monthly_units: number | null;
  projected_monthly_revenue_ngn: string | null;
}

export interface Slider {
  slider_id: string;
  slider_key: string;
  baseline_value: number;
  scenario_value: number;
  delta_pct: number;
  notes: string | null;
  display_order: number;
}

export interface ScenarioDetail extends Scenario {
  results: ScenarioResult[];
  sliders: Slider[];
}

export interface CreateScenarioInput {
  scenario_name: string;
  description?: string;
  scope_type?: ScopeType;
  category_ids?: string[];
  variant_ids?: string[];
  goal_type: GoalType;
  goal_value?: number;
  channel?: string;
  assumed_monthly_units?: number;
  cost_basis?: string;
  custom_cost_ngn?: number;
}

export interface ComputeSliderInput {
  slider_key: string;
  baseline_value: number;
  scenario_value: number;
  notes?: string;
}

// ── Proposals ────────────────────────────────────────────────────────────────

export type ProposalStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "applied"
  | "reverted"
  | "expired";

export interface Proposal {
  proposal_id: string;
  proposal_number: string;
  scenario_id: string | null;
  title: string;
  description: string | null;
  status: ProposalStatus;
  variants_count: number;
  effective_from: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  applied_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  reverted_at: string | null;
  created_at: string;
}

export interface ProposalDetail extends Proposal {
  results: ScenarioResult[];
}

export interface CreateProposalInput {
  scenario_id: string;
  title: string;
  description?: string;
  effective_from?: string;
  effective_to?: string;
}

// ── Rules ────────────────────────────────────────────────────────────────────

export type RuleType =
  | "markup_pct"
  | "target_margin_pct"
  | "fixed_price"
  | "discount_pct"
  | "min_price"
  | "cost_pass_through"
  | "tiered_quantity";

export interface Rule {
  rule_id: string;
  rule_name: string;
  description: string | null;
  category_id: string | null;
  product_id: string | null;
  variant_id: string | null;
  channel: string | null;
  rule_type: RuleType;
  rule_value: number | null;
  priority: number;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CreateRuleInput {
  rule_name: string;
  rule_type: RuleType;
  rule_value?: number;
  channel?: string;
  priority?: number;
  description?: string;
  valid_from?: string;
  valid_to?: string;
}

export type UpdateRuleInput = Partial<CreateRuleInput> & { is_active?: boolean };

// ── Floors ───────────────────────────────────────────────────────────────────

export type FloorType = "min_price_ngn" | "min_margin_pct" | "min_markup_pct";

export interface Floor {
  floor_id: string;
  variant_id: string | null;
  product_id: string | null;
  category_id: string | null;
  channel: string | null;
  floor_type: FloorType;
  floor_value: number;
  reason: string | null;
  is_active: boolean;
  set_at: string;
  expires_at: string | null;
}

export interface CreateFloorInput {
  floor_type: FloorType;
  floor_value: number;
  variant_id?: string;
  product_id?: string;
  category_id?: string;
  channel?: string;
  reason?: string;
  expires_at?: string;
}

// ── Overrides ────────────────────────────────────────────────────────────────

export interface Override {
  override_id: string;
  variant_id: string;
  channel: string;
  override_price_ngn: string;
  reason: string | null;
  effective_from: string | null;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CreateOverrideInput {
  variant_id: string;
  channel: Channel;
  override_price_ngn: number;
  reason: string;
  effective_from?: string;
  effective_to?: string;
}

// ── History ──────────────────────────────────────────────────────────────────

export interface HistoryRow {
  history_id: string;
  channel: string;
  old_price_ngn: string | null;
  new_price_ngn: string | null;
  delta_pct: number | null;
  cost_at_change_ngn: string | null;
  margin_at_change_pct: number | null;
  source: string | null;
  effective_from: string | null;
  created_at: string;
}
