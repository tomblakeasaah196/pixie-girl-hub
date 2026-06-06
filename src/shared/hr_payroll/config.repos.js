/**
 * HR & Payroll config repositories (V2.2 §6.11).
 *
 * The five Tier-1 admin-config tables, each built from the brand-CRUD factory
 * with its exact schema spec (PK, writable columns, JSONB/array casts, soft-
 * delete column). All are per-brand ({brand}.<table>).
 */

"use strict";

const { makeBrandRepo } = require("./brand-crud.repo");

// commission_rules — who earns commission, on what, at what rate
const commissionRulesRepo = makeBrandRepo({
  table: "commission_rules",
  pk: "rule_id",
  softDeleteCol: "is_active",
  orderBy: "priority ASC, created_at DESC",
  jsonbCols: ["tiered_config"],
  filterCols: [
    "sales_channel",
    "calculation_basis",
    "applies_to_role_id",
    "is_active",
  ],
  writeCols: [
    "rule_name",
    "description",
    "applies_to_role_id",
    "applies_to_user_id",
    "category_id",
    "product_id",
    "variant_id",
    "sales_channel",
    "calculation_basis",
    "rate_pct",
    "rate_fixed_ngn",
    "tiered_config",
    "min_commission_ngn",
    "max_commission_ngn",
    "valid_from",
    "valid_to",
    "is_active",
    "priority",
    "created_by",
  ],
});

// bonus_rules — bonus definitions incl. the V2.2 4.8+ auto-trigger
const bonusRulesRepo = makeBrandRepo({
  table: "bonus_rules",
  pk: "bonus_rule_id",
  softDeleteCol: "is_active",
  orderBy: "created_at DESC",
  jsonbCols: ["trigger_criteria"],
  arrayCols: { applies_to_role_ids: "uuid[]" },
  filterCols: ["bonus_type", "is_auto_triggered", "is_active"],
  writeCols: [
    "rule_name",
    "description",
    "bonus_type",
    "amount_type",
    "amount_value",
    "applies_to_role_ids",
    "trigger_criteria",
    "is_auto_triggered",
    "max_per_staff_per_year",
    "is_active",
    "valid_from",
    "valid_to",
    "created_by",
    "approved_by",
    "approved_at",
  ],
});

// performance_kpi_definitions — the weighted KPIs (40/25/20/15)
const kpiDefsRepo = makeBrandRepo({
  table: "performance_kpi_definitions",
  pk: "kpi_id",
  softDeleteCol: "is_active",
  orderBy: "display_order ASC, created_at ASC",
  jsonbCols: ["auto_score_config"],
  arrayCols: { applies_to_role_ids: "uuid[]" },
  filterCols: ["score_source", "is_active"],
  writeCols: [
    "kpi_key",
    "display_name",
    "description",
    "weight_pct",
    "score_source",
    "auto_score_config",
    "min_score",
    "max_score",
    "applies_to_role_ids",
    "display_order",
    "is_active",
  ],
});

// performance_cycles — appraisal periods (quarterly); has a status lifecycle
const cyclesRepo = makeBrandRepo({
  table: "performance_cycles",
  pk: "cycle_id",
  softDeleteCol: null, // hard delete (service guards to 'upcoming' only)
  orderBy: "starts_on DESC",
  filterCols: ["status", "cycle_type"],
  writeCols: [
    "cycle_name",
    "cycle_type",
    "starts_on",
    "ends_on",
    "status",
    "scoring_opens_at",
    "scoring_closes_at",
    "bonus_pool_ngn",
    "notes",
  ],
});

// payroll_deductions — PAYE bands / pension % / NHF (effective-dated)
const deductionsRepo = makeBrandRepo({
  table: "payroll_deductions",
  pk: "deduction_id",
  softDeleteCol: "is_active",
  orderBy: "deduction_type ASC, effective_from DESC",
  jsonbCols: ["bands"],
  filterCols: ["deduction_type", "is_active"],
  writeCols: [
    "deduction_type",
    "effective_from",
    "effective_to",
    "rate_pct",
    "bands",
    "consolidated_relief_ngn",
    "consolidated_relief_pct",
    "min_taxable_ngn",
    "max_taxable_ngn",
    "is_active",
    "notes",
  ],
});

module.exports = {
  commissionRulesRepo,
  bonusRulesRepo,
  kpiDefsRepo,
  cyclesRepo,
  deductionsRepo,
};
