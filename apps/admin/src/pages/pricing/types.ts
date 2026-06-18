// ── Pricing Engine Types ─────────────────────────────────────────────────────

export type RuleType =
  | "markup_pct"
  | "target_margin_pct"
  | "fixed_price"
  | "channel_override"
  | "seasonal";

export type FloorType = "absolute" | "cost_plus_pct" | "cost_plus_fixed";

export type ProposalStatus = "pending" | "approved" | "rejected";

// ── Pricing Rule ──────────────────────────────────────────────────────────────

export interface PricingRule {
  pricing_rule_id: string;
  name: string;
  rule_type: RuleType;
  applies_to: string | null; // variant_id / category / "*"
  markup_pct: string | null;
  target_margin_pct: string | null;
  fixed_price_ngn: string | null;
  channel: string | null;
  is_active: boolean;
  priority: number;
  effective_from: string | null;
  effective_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRuleInput {
  name: string;
  rule_type: RuleType;
  applies_to?: string;
  markup_pct?: number;
  target_margin_pct?: number;
  fixed_price_ngn?: number;
  channel?: string;
  priority?: number;
  effective_from?: string;
  effective_to?: string;
}

export interface UpdateRuleInput extends Partial<CreateRuleInput> {
  is_active?: boolean;
}

// ── Price Floor ───────────────────────────────────────────────────────────────

export interface PriceFloor {
  price_floor_id: string;
  name: string;
  floor_type: FloorType;
  applies_to: string | null;
  absolute_price_ngn: string | null;
  cost_plus_pct: string | null;
  cost_plus_fixed_ngn: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateFloorInput {
  name: string;
  floor_type: FloorType;
  applies_to?: string;
  absolute_price_ngn?: number;
  cost_plus_pct?: number;
  cost_plus_fixed_ngn?: number;
}

export interface UpdateFloorInput extends Partial<CreateFloorInput> {
  is_active?: boolean;
}

// ── Scenario / Workbench ──────────────────────────────────────────────────────

export interface ChannelPrice {
  channel: string;
  net_price: number;
  gross_price: number;
  platform_fee_pct: number;
  platform_fee_fixed: number;
  margin_at_gross_pct: number;
}

export interface SensitivityRow {
  margin: number;
  price: number;
}

export interface ScenarioResult {
  base_price: number;
  target_margin_pct: number;
  markup_pct: number;
  sensitivity_grid: SensitivityRow[];
  channel_prices: ChannelPrice[];
}

export interface ScenarioComputeInput {
  variant_id?: string;
  cost_ngn: number;
  target_margin_pct?: number;
  target_price_ngn?: number;
  channels?: string[];
}

// ── Saved Scenario (local state only) ────────────────────────────────────────

export interface SavedScenario {
  id: string;
  name: string;
  cost_ngn: number;
  target_margin_pct?: number;
  target_price_ngn?: number;
  result: ScenarioResult;
  saved_at: string;
}

// ── Pricing Proposal ──────────────────────────────────────────────────────────

export interface Proposal {
  pricing_proposal_id: string;
  proposal_number: string;
  variant_id: string | null;
  product_name: string | null;
  sku: string | null;
  proposed_price_ngn: string;
  current_price_ngn: string | null;
  price_change_pct: string | null;
  cost_ngn: string | null;
  target_margin_pct: string | null;
  justification: string | null;
  status: ProposalStatus;
  requested_by: string;
  requested_by_name?: string;
  approved_by: string | null;
  approved_by_name?: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  reverted_at: string | null;
  workflow_instance_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProposalInput {
  variant_id?: string;
  product_name?: string;
  sku?: string;
  proposed_price_ngn: number;
  current_price_ngn?: number;
  cost_ngn?: number;
  target_margin_pct?: number;
  justification?: string;
}

// ── Paginated response (shared) ───────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
}
