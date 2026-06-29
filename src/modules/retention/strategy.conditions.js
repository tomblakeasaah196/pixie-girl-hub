/**
 * Declarative condition evaluator for the retention strategy engine
 * (Module 6.23). Strategy `trigger_conditions` and per-step `step_conditions`
 * are JSON predicate trees evaluated against a flat "facts" object
 * (see strategy.facts.js). This keeps every strategy data-only — no code,
 * no `eval`.
 *
 * Grammar (recursive):
 *   {}                                   → always true (no condition)
 *   { all: [node, …] }                   → every child true (AND)
 *   { any: [node, …] }                   → at least one child true (OR)
 *   { not: node }                        → negation
 *   { field, op, value }                 → leaf comparison
 *
 * Operators: eq, neq, gt, gte, lt, lte, in, nin, contains, exists, not_exists.
 * Unknown operators / missing fields evaluate to false (fail-closed) rather
 * than throwing, so one malformed rule can never crash the engine.
 */

"use strict";

const OPERATORS = {
  eq: (a, b) => a === b || String(a) === String(b),
  neq: (a, b) => !(a === b || String(a) === String(b)),
  gt: (a, b) => num(a) > num(b),
  gte: (a, b) => num(a) >= num(b),
  lt: (a, b) => num(a) < num(b),
  lte: (a, b) => num(a) <= num(b),
  in: (a, b) => Array.isArray(b) && b.map(String).includes(String(a)),
  nin: (a, b) => Array.isArray(b) && !b.map(String).includes(String(a)),
  contains: (a, b) =>
    Array.isArray(a)
      ? a.map(String).includes(String(b))
      : typeof a === "string" && a.toLowerCase().includes(String(b).toLowerCase()),
  exists: (a) => a !== undefined && a !== null,
  not_exists: (a) => a === undefined || a === null,
};

const VALUELESS_OPS = new Set(["exists", "not_exists"]);

function num(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Resolve a dotted field path (e.g. "tier.key") out of the facts object. */
function resolve(facts, field) {
  if (!field) return undefined;
  return String(field)
    .split(".")
    .reduce(
      (acc, key) => (acc === null || acc === undefined ? undefined : acc[key]),
      facts,
    );
}

function evalLeaf(node, facts) {
  const fn = OPERATORS[node.op];
  if (!fn) return false; // unknown operator → fail-closed
  const actual = resolve(facts, node.field);
  if (VALUELESS_OPS.has(node.op)) return fn(actual);
  return fn(actual, node.value);
}

/**
 * Evaluate a predicate tree against facts. Returns a boolean.
 * @param {object} predicate
 * @param {object} facts
 */
function evaluate(predicate, facts) {
  if (predicate === null || predicate === undefined) return true;
  if (typeof predicate !== "object") return false;

  // Empty object → no condition → true.
  const keys = Object.keys(predicate);
  if (keys.length === 0) return true;

  if (Array.isArray(predicate.all)) {
    return predicate.all.every((child) => evaluate(child, facts));
  }
  if (Array.isArray(predicate.any)) {
    return predicate.any.some((child) => evaluate(child, facts));
  }
  if (predicate.not !== undefined) {
    return !evaluate(predicate.not, facts);
  }
  if (predicate.field !== undefined && predicate.op !== undefined) {
    return evalLeaf(predicate, facts);
  }
  return false; // malformed → fail-closed
}

/**
 * Best-effort English rendering of a predicate, for the plain-language UX.
 * Returns "" for an empty/everyone predicate.
 */
function describe(predicate) {
  if (!predicate || typeof predicate !== "object") return "";
  const keys = Object.keys(predicate);
  if (keys.length === 0) return "";
  if (Array.isArray(predicate.all))
    return predicate.all.map(describe).filter(Boolean).join(" and ");
  if (Array.isArray(predicate.any))
    return predicate.any.map(describe).filter(Boolean).join(" or ");
  if (predicate.not !== undefined) return `not (${describe(predicate.not)})`;
  if (predicate.field !== undefined && predicate.op !== undefined) {
    const label = String(predicate.field).replace(/_/g, " ");
    const opWord =
      {
        eq: "is",
        neq: "is not",
        gt: "is more than",
        gte: "is at least",
        lt: "is less than",
        lte: "is at most",
        in: "is one of",
        nin: "is not one of",
        contains: "contains",
        exists: "is set",
        not_exists: "is not set",
      }[predicate.op] || predicate.op;
    if (VALUELESS_OPS.has(predicate.op)) return `${label} ${opWord}`;
    const val = Array.isArray(predicate.value)
      ? predicate.value.join(", ")
      : predicate.value;
    return `${label} ${opWord} ${val}`;
  }
  return "";
}

module.exports = {
  evaluate,
  describe,
  OPERATOR_KEYS: Object.keys(OPERATORS),
};
