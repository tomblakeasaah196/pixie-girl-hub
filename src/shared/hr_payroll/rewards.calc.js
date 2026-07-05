/**
 * Rewards engine math (PURE, no DB).
 *
 * A reward rule measures one metric over a month and grants a reward when the
 * employee's value passes the threshold. This module decides qualification and
 * resolves the reward into a concrete figure — kept pure so the money logic is
 * unit-testable in isolation.
 */

"use strict";

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Does `value` satisfy the rule's comparator/threshold? */
function qualifies({ value, comparator, threshold }) {
  const v = Number(value);
  const t = Number(threshold);
  if (Number.isNaN(v) || Number.isNaN(t)) return false;
  return comparator === "lte" ? v <= t : v >= t;
}

/**
 * Resolve a rule's reward for an employee into a concrete outcome:
 *   fixed_ngn           → { kind:'monetary', amount_ngn }
 *   pct_salary          → { kind:'monetary', amount_ngn = base × pct }
 *   salary_increase_pct → { kind:'salary_increase', proposed_salary_ngn }
 * Returns null when the resolved amount is not positive.
 */
function resolveReward({ reward_type, reward_value, baseSalaryNgn }) {
  const value = Number(reward_value) || 0;
  const base = Number(baseSalaryNgn) || 0;
  if (reward_type === "fixed_ngn") {
    return value > 0 ? { kind: "monetary", amount_ngn: round2(value) } : null;
  }
  if (reward_type === "pct_salary") {
    const amt = round2((base * value) / 100);
    return amt > 0 ? { kind: "monetary", amount_ngn: amt } : null;
  }
  if (reward_type === "salary_increase_pct") {
    const proposed = round2(base * (1 + value / 100));
    return proposed > base ? { kind: "salary_increase", proposed_salary_ngn: proposed } : null;
  }
  return null;
}

module.exports = { round2, qualifies, resolveReward };
