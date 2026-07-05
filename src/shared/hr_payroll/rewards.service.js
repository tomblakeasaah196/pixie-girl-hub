/**
 * Rewards service (meeting §3 "reward system").
 *
 * HR configures rules (e.g. "first at work ≥ 15 days in a month → ₦20,000",
 * "always punctual ≥ 20 days → 5% salary bonus", "prompt data entry ≥ 200
 * entries → salary increase"). A nightly evaluator computes each employee's
 * monthly standing and grants a reward when the threshold is met — idempotent,
 * once per employee per period.
 *
 * Monetary rewards create a pending-approval bonus, so they flow through the
 * existing bonus → payroll pipeline (nothing is paid silently). Salary-increase
 * rewards are recorded as PENDING grants that HR applies explicitly (updating
 * base salary + writing a contract amendment).
 */

"use strict";

const repo = require("./rewards.repo");
const hrRepo = require("./hr.repo");
const calc = require("./rewards.calc");
const payroll = require("./payroll.service");
const contracts = require("./contracts.service");
const events = require("./hr.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { logger } = require("../../config/logger");
const { NotFoundError, ConflictError, ValidationError } = require("../../utils/errors");

function nowYm() {
  const d = new Date();
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

// ── Rules CRUD ─────────────────────────────────────────────
async function listRules({ brand, include_inactive }) {
  return { data: await repo.listRules({ brand, include_inactive }) };
}

async function createRule({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const rule = await repo.createRule({ client, brand, input, createdBy: user.user_id });
    await audit({
      business: brand, user_id: user.user_id, action_key: "hr_payroll.create_reward_rule",
      target_type: "reward_rules", target_id: rule.reward_rule_id, after: rule, request_id,
    });
    return rule;
  });
}

async function updateRule({ brand, user, request_id, id, patch }) {
  return transaction(async (client) => {
    const before = await repo.findRule({ client, brand, id });
    if (!before) throw new NotFoundError("Reward rule");
    const rule = await repo.updateRule({ client, brand, id, patch });
    await audit({
      business: brand, user_id: user.user_id, action_key: "hr_payroll.update_reward_rule",
      target_type: "reward_rules", target_id: id, before, after: rule, request_id,
    });
    return rule;
  });
}

async function deleteRule({ brand, user, request_id, id }) {
  await transaction(async (client) => {
    const before = await repo.findRule({ client, brand, id });
    if (!before) throw new NotFoundError("Reward rule");
    await repo.deleteRule({ client, brand, id });
    await audit({
      business: brand, user_id: user.user_id, action_key: "hr_payroll.delete_reward_rule",
      target_type: "reward_rules", target_id: id, before, request_id,
    });
  });
}

// ── Evaluation ─────────────────────────────────────────────
/**
 * Evaluate all active rules for a period and grant rewards to qualifying
 * employees. Idempotent: safe to run nightly (each employee is granted at most
 * once per rule per period). `user` may be null (system/nightly).
 */
async function evaluate({ brand, user, year, month }) {
  const { year: y0, month: m0 } = nowYm();
  const year_ = Number(year) || y0;
  const month_ = Number(month) || m0;

  const [rules, staff] = await Promise.all([
    repo.listRules({ brand, include_inactive: false }),
    repo.activeStaffForRewards({ brand }),
  ]);

  let granted = 0;
  for (const rule of rules) {
    const metricFn = repo.METRIC_QUERIES[rule.metric];
    if (!metricFn) continue;
    let metricMap;
    try {
      metricMap = await metricFn({ brand, year: year_, month: month_ });
    } catch (err) {
      logger.warn({ err: err.message, rule: rule.reward_rule_id }, "reward metric query failed");
      continue;
    }

    for (const s of staff) {
      const value = metricMap[s.profile_id] ?? 0;
      if (!calc.qualifies({ value, comparator: rule.comparator, threshold: rule.threshold })) {
        continue;
      }
      const resolved = calc.resolveReward({
        reward_type: rule.reward_type,
        reward_value: rule.reward_value,
        baseSalaryNgn: s.base_salary,
      });
      if (!resolved) continue;

      const grant = await repo.insertGrantIfAbsent({
        brand,
        g: {
          reward_rule_id: rule.reward_rule_id,
          profile_id: s.profile_id,
          user_id: s.user_id,
          period_year: year_,
          period_month: month_,
          metric: rule.metric,
          metric_value: value,
          reward_type: rule.reward_type,
          reward_value: rule.reward_value,
          amount_ngn: resolved.kind === "monetary" ? resolved.amount_ngn : null,
          proposed_salary_ngn: resolved.kind === "salary_increase" ? resolved.proposed_salary_ngn : null,
          status: resolved.kind === "monetary" ? "awarded" : "pending",
        },
      });
      if (!grant) continue; // already granted this period — no double reward
      granted++;

      // Monetary reward → a pending-approval bonus (flows through payroll).
      if (resolved.kind === "monetary" && s.user_id) {
        try {
          const bonus = await payroll.awardBonus({
            brand,
            user: { user_id: (user && user.user_id) || s.user_id },
            request_id: null,
            input: {
              user_id: s.user_id,
              bonus_type: "reward",
              amount_ngn: resolved.amount_ngn,
              reason: `Reward: ${rule.name} (${month_}/${year_})`,
            },
          });
          await repo.setGrantBonus({ brand, id: grant.reward_grant_id, bonus_id: bonus.bonus_id });
        } catch (err) {
          logger.warn(
            { err: err.message, grant: grant.reward_grant_id },
            "reward bonus creation failed (grant recorded, bonus can be retried)",
          );
        }
      }
      events.emit("reward_granted", {
        brand, grant_id: grant.reward_grant_id, profile_id: s.profile_id,
      });
    }
  }
  return { granted, period: { year: year_, month: month_ } };
}

// ── Leaderboard (live standings for a metric) ──────────────
async function leaderboard({ brand, metric, year, month, limit = 10 }) {
  const { year: y0, month: m0 } = nowYm();
  const year_ = Number(year) || y0;
  const month_ = Number(month) || m0;
  const metricFn = repo.METRIC_QUERIES[metric];
  if (!metricFn) throw new ValidationError("Unknown metric");
  const [map, staff] = await Promise.all([
    metricFn({ brand, year: year_, month: month_ }),
    repo.activeStaffForRewards({ brand }),
  ]);
  const rows = staff
    .map((s) => ({ profile_id: s.profile_id, staff_name: s.display_name, value: map[s.profile_id] ?? 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
  return { metric, period: { year: year_, month: month_ }, rows };
}

// ── Grants ─────────────────────────────────────────────────
async function listGrants({ brand, filters }) {
  return { data: await repo.listGrants({ brand, filters }) };
}

/** Apply a pending salary-increase grant: raise base salary + amendment. */
async function applyGrant({ brand, user, request_id, id }) {
  const grant = await repo.findGrant({ brand, id });
  if (!grant) throw new NotFoundError("Reward grant");
  if (grant.reward_type !== "salary_increase_pct") {
    throw new ConflictError("Only salary-increase rewards are applied here; monetary rewards pay via the bonus.");
  }
  if (grant.status !== "pending") throw new ConflictError("Grant already decided");
  const newSalary = Number(grant.proposed_salary_ngn);
  if (!(newSalary > 0)) throw new ValidationError("No proposed salary on this grant");

  await hrRepo.update({ brand, id: grant.profile_id, patch: { base_salary: newSalary } });
  // Record the change as a contract amendment (best-effort — the raise stands).
  try {
    await contracts.generateContract({
      brand, user, request_id, profileId: grant.profile_id,
      input: {
        contract_type: "amendment",
        gross_salary: newSalary,
        notes: `Salary increase from reward: ${grant.metric} (${grant.period_month}/${grant.period_year}).`,
      },
    });
  } catch (err) {
    logger.warn({ err: err.message, grant: id }, "amendment PDF failed (salary already updated)");
  }
  const updated = await repo.setGrantStatus({ brand, id, status: "applied", decidedBy: user.user_id });
  await audit({
    business: brand, user_id: user.user_id, action_key: "hr_payroll.apply_reward_salary_increase",
    target_type: "reward_grants", target_id: id, after: { new_salary: newSalary }, request_id,
    is_sensitive: true,
  });
  return updated;
}

/** Reject a grant; if it created a bonus, reject that too. */
async function rejectGrant({ brand, user, request_id, id, reason }) {
  const grant = await repo.findGrant({ brand, id });
  if (!grant) throw new NotFoundError("Reward grant");
  if (["applied", "rejected"].includes(grant.status)) {
    throw new ConflictError("Grant already decided");
  }
  if (grant.bonus_id) {
    try {
      await payroll.decideBonus({
        brand, user, request_id, bonus_id: grant.bonus_id,
        decision: "rejected", reason: reason || "Reward rejected",
      });
    } catch (err) {
      logger.warn({ err: err.message, grant: id }, "linked bonus reject failed");
    }
  }
  const updated = await repo.setGrantStatus({ brand, id, status: "rejected", decidedBy: user.user_id });
  await audit({
    business: brand, user_id: user.user_id, action_key: "hr_payroll.reject_reward_grant",
    target_type: "reward_grants", target_id: id, after: { reason: reason || null }, request_id,
  });
  return updated;
}

module.exports = {
  listRules, createRule, updateRule, deleteRule,
  evaluate, leaderboard,
  listGrants, applyGrant, rejectGrant,
};
