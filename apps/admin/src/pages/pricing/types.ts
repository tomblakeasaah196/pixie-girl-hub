export type RuleType =
  | "markup_pct"
  | "target_margin_pct"
  | "fixed_price"
  | "discount_pct"
  | "min_price"
  | "cost_pass_through"
  | "tiered_quantity";

export type FloorType = "min_price_ngn" | "min_margin_pct" | "min_markup_pct";

export type ProposalStatus = "pending_approval" | "approved" | "rejected" | "applied" | "reverted";

export type GoalType = "target_margin" | "target_price" | "target_revenue" | "sensitivity_only";

// ── Pricing Rule ──────────────────────────────────────────────────────────────

export interface PricingRule {
  rule_id: string;
  rule_name: string;
  description: string | null;
  rule_type: RuleType;
  rule_value: number | null;
  rule_config: Record<string, any> | null;
  channel: string;
  is_active: boolean;
  priority: number;
  valid_from: string | null;
  valid_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRuleInput {
  rule_name: string;
  description?: string;
  category_id?: string;
  product_id?: string;
  variant_id?: string;
  channel?: string;
  rule_type: RuleType;
  rule_value?: number;
  rule_config?: Record<string, any>;
  applies_to_currency?: string;
  priority?: number;
  valid_from?: string;
  valid_to?: string;
}

export interface UpdateRuleInput extends Partial<CreateRuleInput> {
  is_active?: boolean;
}

// ── Price Floor ───────────────────────────────────────────────────────────────

export interface PriceFloor {
  floor_id: string;
  variant_id: string | null;
  product_id: string | null;
  category_id: string | null;
  channel: string;
  floor_type: FloorType;
  floor_value: number;
  reason: string | null;
  is_intercompany_floor: boolean;
  is_active: boolean;
  expires_at: string | null;
  set_at: string;
}

export interface CreateFloorInput {
  variant_id?: string;
  product_id?: string;
  category_id?: string;
  channel?: string;
  floor_type: FloorType;
  floor_value: number;
  reason?: string;
  is_intercompany_floor?: boolean;
  expires_at?: string;
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

export interface Scenario {
  scenario_id: string;
  scenario_name: string;
  description: string | null;
  scope_type: string;
  goal_type: GoalType;
  goal_value: number | null;
  status: "draft" | "computed" | "proposed" | "applied";
  created_at: string;
}

export interface CreateScenarioInput {
  scenario_name: string;
  description?: string;
  scope_type?: "all_active" | "category" | "specific_products" | "specific_variants";
  category_ids?: string[];
  variant_ids?: string[];
  goal_type: GoalType;
  goal_value?: number;
  goal_currency?: string;
  channel?: string;
  assumed_monthly_units?: number;
  cost_basis?: "latest" | "average" | "last_run" | "custom";
  custom_cost_ngn?: number;
}

export interface ComputeScenarioInput {
  sliders?: {
    slider_key: string;
    baseline_value: number;
    scenario_value: number;
    notes?: string;
  }[];
}

export interface ScenarioResultItem {
  variant_id: string;
  cost_ngn: string;
  current_price_ngn: string | null;
  current_margin_pct: number | null;
  proposed_price_ngn: string;
  proposed_margin_pct: number;
  proposed_markup_pct: number;
  margin_at_cost_minus_10: number;
  margin_at_cost_plus_10: number;
  margin_at_fx_minus_10: number;
  margin_at_fx_plus_10: number;
  floor_breached: boolean;
  floor_breach_notes: string | null;
}

export interface ScenarioResultResponse extends Scenario {
  results: ScenarioResultItem[];
  sliders: any[];
}

// ── Pricing Proposal ──────────────────────────────────────────────────────────

export interface Proposal {
  proposal_id: string;
  proposal_number: string;
  scenario_id: string | null;
  title: string;
  description: string | null;
  effective_from: string | null;
  effective_to: string | null;
  variants_count: number;
  status: ProposalStatus;
  submitted_by: string;
  approved_by: string | null;
  rejection_reason: string | null;
  reversion_reason: string | null;
  created_at: string;
}

export interface CreateProposalInput {
  scenario_id: string;
  title: string;
  description?: string;
  effective_from?: string;
  effective_to?: string;
}

// ── Paginated response (shared) ───────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
}
