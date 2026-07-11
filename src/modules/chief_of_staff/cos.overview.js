/**
 * Chief of Staff (PR5) — cross-brand command (wow #6, CEO only).
 *
 * One CoS spanning the CEO's brands. Aggregates each brand's goal health,
 * average progress and overdue counts into a single portfolio view — surfaced in
 * the CoS tab and the morning briefing ("FLH on track; PXG 2 weeks behind").
 *
 * This is the ONLY CoS read that intentionally crosses brand context, and it is
 * guarded by requireCeo at the route. The per-brand merge + headline logic
 * (shapeOverview) is pure and unit-tested; denial for a non-CEO is enforced by
 * the route guard and asserted in tests.
 */

"use strict";

const repo = require("./cos.overview.repo");
const { VALID_BRANDS } = require("../../config/brands");
const { AppError } = require("../../utils/errors");

const n = (v) => Number(v || 0);

/** The CEO's brand set: their explicit access, else all active brands. */
function ceoBrands(user) {
  if (!user || !user.is_ceo)
    throw new AppError("FORBIDDEN", "Cross-brand overview is CEO-only.", 403, {
      user_message: "The cross-brand view is available to the CEO only.",
    });
  if (Array.isArray(user.available_businesses) && user.available_businesses.length)
    return user.available_businesses;
  return [...VALID_BRANDS];
}

/** Merge the health + overdue rows per brand and add a plain-language headline. Pure. */
function shapeOverview({ businesses, health = [], overdue = [], names = {} }) {
  const byBrandHealth = new Map(health.map((r) => [r.business, r]));
  const byBrandOverdue = new Map(overdue.map((r) => [r.business, r]));

  const brands = businesses.map((b) => {
    const h = byBrandHealth.get(b) || {};
    const o = byBrandOverdue.get(b) || {};
    const active = n(h.active_goals);
    const behind = n(h.behind);
    const atRisk = n(h.at_risk);
    const overdueTotal = n(o.overdue_milestones) + n(o.overdue_tasks);

    let headline;
    if (active === 0) headline = "No active goals.";
    else if (behind > 0) headline = `${behind} goal(s) behind, ${n(h.avg_progress)}% avg progress.`;
    else if (atRisk > 0) headline = `${atRisk} at risk, ${n(h.avg_progress)}% avg progress.`;
    else headline = `On track — ${n(h.avg_progress)}% avg progress.`;

    return {
      business: b,
      display_name: names[b] || b,
      active_goals: active,
      on_track: n(h.on_track),
      at_risk: atRisk,
      behind,
      achieved: n(h.achieved),
      avg_progress: n(h.avg_progress),
      overdue_milestones: n(o.overdue_milestones),
      overdue_tasks: n(o.overdue_tasks),
      overdue_total: overdueTotal,
      headline,
    };
  });

  const totals = brands.reduce(
    (acc, b) => ({
      active_goals: acc.active_goals + b.active_goals,
      at_risk: acc.at_risk + b.at_risk,
      behind: acc.behind + b.behind,
      overdue_total: acc.overdue_total + b.overdue_total,
    }),
    { active_goals: 0, at_risk: 0, behind: 0, overdue_total: 0 },
  );

  return { brands, totals, generated_at: new Date().toISOString() };
}

async function crossBrand({ user }) {
  const businesses = ceoBrands(user);
  const [health, overdue, names] = await Promise.all([
    repo.goalHealthByBrand({ businesses }),
    repo.overdueByBrand({ businesses }),
    repo.brandNames({ businesses }),
  ]);
  return shapeOverview({ businesses, health, overdue, names });
}

module.exports = { crossBrand, shapeOverview, ceoBrands };
