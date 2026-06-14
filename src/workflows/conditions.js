/**
 * Workflow stage conditions & applicability (V2.2 §6.27).
 *
 * Pure functions — NO database, NO side effects — so the routing logic that
 * decides *which* approval stages apply to a given request is unit-testable
 * in isolation. The engine (engine.js) layers persistence and events on top.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * WORKFLOWS.md routes approvals by the request's actual values: an expense
 * ≤ ₦200k needs only a manager; > ₦200k also needs the CEO. The engine used
 * to advance stages linearly and ignore those thresholds — every stage always
 * ran. These functions evaluate each stage's condition against the instance
 * context so non-applicable stages are skipped.
 *
 * CANONICAL STAGE SHAPE (after normalise)
 *   {
 *     order: number,                       // 1-based position; need not be contiguous
 *     name: string | null,
 *     approvers: [{ type:'role'|'position'|'user', value:string }],
 *     condition: Condition | null,         // null = stage always applies
 *     timeout_hours: number,
 *     on_timeout: 'escalate'|'auto_approve'|'auto_reject',
 *     fallback_to_deputy: boolean,
 *   }
 *
 * CONDITION SHAPE (all keys optional; every present key must hold — logical AND)
 *   { field: string, gt?, gte?, lt?, lte?, eq?, in?: any[] }
 * An array of conditions is also accepted and AND-ed together.
 *
 * Authored forms accepted by `stageCondition` (richest wins):
 *   - stage.condition       canonical (preferred)
 *   - stage.applies_when    alias for canonical
 *   - stage.threshold_field + threshold_ngn_gt / _gte / _lte / _lt   (WORKFLOWS.md)
 *   - stage.amount_threshold_ngn   (legacy single bound → field ≤ value)
 */

"use strict";

/** Coerce to a finite number; non-numeric / missing → 0 (monetary default). */
function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Evaluate one condition (or an AND-array of conditions) against a context.
 * A null/undefined condition always passes (stage applies unconditionally).
 */
function evaluateCondition(condition, context = {}) {
  if (condition === null || condition === undefined) return true;
  if (Array.isArray(condition)) {
    return condition.every((c) => evaluateCondition(c, context));
  }
  const ctx = context || {};
  const raw =
    condition.field !== null && condition.field !== undefined
      ? ctx[condition.field]
      : undefined;

  if (condition.eq !== undefined && raw !== condition.eq) return false;
  if (
    condition.in !== undefined &&
    Array.isArray(condition.in) &&
    !condition.in.includes(raw)
  ) {
    return false;
  }

  const numericKeys = ["gt", "gte", "lt", "lte"];
  const hasNumeric = numericKeys.some(
    (k) => condition[k] !== undefined && condition[k] !== null,
  );
  if (hasNumeric) {
    const n = toNumber(raw);
    if (
      condition.gt !== null &&
      condition.gt !== undefined &&
      !(n > condition.gt)
    )
      return false;
    if (
      condition.gte !== null &&
      condition.gte !== undefined &&
      !(n >= condition.gte)
    )
      return false;
    if (
      condition.lt !== null &&
      condition.lt !== undefined &&
      !(n < condition.lt)
    )
      return false;
    if (
      condition.lte !== null &&
      condition.lte !== undefined &&
      !(n <= condition.lte)
    )
      return false;
  }
  return true;
}

/** Derive the canonical condition for a raw (authored) stage. */
function stageCondition(rawStage) {
  if (!rawStage) return null;
  if (rawStage.condition) return rawStage.condition;
  if (rawStage.applies_when) return rawStage.applies_when;

  const field = rawStage.threshold_field || "total_ngn";
  const cond = { field };
  let bounded = false;
  if (
    rawStage.threshold_ngn_gt !== null &&
    rawStage.threshold_ngn_gt !== undefined
  ) {
    cond.gt = rawStage.threshold_ngn_gt;
    bounded = true;
  }
  if (
    rawStage.threshold_ngn_gte !== null &&
    rawStage.threshold_ngn_gte !== undefined
  ) {
    cond.gte = rawStage.threshold_ngn_gte;
    bounded = true;
  }
  if (
    rawStage.threshold_ngn_lte !== null &&
    rawStage.threshold_ngn_lte !== undefined
  ) {
    cond.lte = rawStage.threshold_ngn_lte;
    bounded = true;
  }
  if (
    rawStage.threshold_ngn_lt !== null &&
    rawStage.threshold_ngn_lt !== undefined
  ) {
    cond.lt = rawStage.threshold_ngn_lt;
    bounded = true;
  }
  // Legacy single bound: "this stage handles amounts up to X".
  if (
    !bounded &&
    rawStage.amount_threshold_ngn !== null &&
    rawStage.amount_threshold_ngn !== undefined
  ) {
    cond.lte = rawStage.amount_threshold_ngn;
    bounded = true;
  }
  return bounded ? cond : null;
}

/** Normalise one raw stage to the canonical internal shape. */
function normaliseStage(rawStage, idx) {
  const s = rawStage || {};
  const approvers =
    s.approvers ||
    (s.approver_role
      ? [{ type: "role", value: s.approver_role }]
      : [{ type: "role", value: "ceo" }]);
  return {
    order: s.order || s.step || idx + 1,
    name: s.name || null,
    approvers,
    condition: stageCondition(s),
    timeout_hours: s.timeout_hours ?? 48,
    on_timeout: s.on_timeout || "escalate",
    fallback_to_deputy: s.fallback_to_deputy === true,
  };
}

/** Normalise + order all stages of a definition (JSONB or already-parsed). */
function normaliseStages(definition) {
  const raw = (definition && definition.stages) || [];
  return raw.map(normaliseStage).sort((a, b) => a.order - b.order);
}

/** Stages whose condition holds for this context, in order. */
function applicableStages(definition, context = {}) {
  return normaliseStages(definition).filter((stage) =>
    evaluateCondition(stage.condition, context),
  );
}

/** Does this request need any approval at all, given its context? */
function requiresApproval(definition, context = {}) {
  return applicableStages(definition, context).length > 0;
}

/** First applicable stage (where a fresh instance starts), or null. */
function firstApplicableStage(definition, context = {}) {
  return applicableStages(definition, context)[0] || null;
}

/** The applicable stage following `afterOrder`, or null if none remain. */
function nextApplicableStage(definition, context = {}, afterOrder = 0) {
  return (
    applicableStages(definition, context).find((s) => s.order > afterOrder) ||
    null
  );
}

/** Look a stage up by its `order` value (orders may be non-contiguous). */
function stageByOrder(definition, order) {
  return normaliseStages(definition).find((s) => s.order === order) || null;
}

/** The highest stage order in a definition (used to park auto-approved rows). */
function lastStageOrder(definition) {
  const stages = normaliseStages(definition);
  return stages.length ? stages[stages.length - 1].order : 1;
}

module.exports = {
  toNumber,
  evaluateCondition,
  stageCondition,
  normaliseStage,
  normaliseStages,
  applicableStages,
  requiresApproval,
  firstApplicableStage,
  nextApplicableStage,
  stageByOrder,
  lastStageOrder,
};
