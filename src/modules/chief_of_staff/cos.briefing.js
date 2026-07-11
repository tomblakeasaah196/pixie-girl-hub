/**
 * Chief of Staff (PR4) — briefing composer.
 *
 * Deterministic (Tier-1) goal digests for the CEO, reused by the morning
 * briefing (daily, in ai-briefing.js) and the Monday executive review (folded
 * into Monday's morning briefing — no extra cron, per the DoD). An optional
 * LLM narrative (Tier-2) runs through the shared failover router (the PR4 reuse
 * seam) and degrades to Tier-1 on any miss, exactly like ai-briefing's pattern.
 *
 * Pure-ish: the compose helpers are unit-testable by passing plain rows; only
 * the DB fetch + narrate touch external services.
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const governance = require("../ai_governance/governance.service");
const modelCatalogue = require("../ai_governance/model-catalogue.repo");
const llmRouter = require("../../services/llm-router");

const FEATURE = "cos_chat";
const HEALTH_LABEL = { behind: "behind", at_risk: "at risk", on_track: "on track", achieved: "achieved" };

/** Compose the deterministic goals section from pre-fetched rows (pure). */
function composeGoalsSection({
  brand,
  goals,
  overdueMilestones,
  overdueTasks,
  priorities,
  weekly,
  assistantName = "Chief of Staff",
}) {
  const header = `🎯 ${assistantName} — Goals (${brand})`;
  const active = goals.length;
  if (!active && !overdueMilestones && !overdueTasks) {
    return { text: `${header}: nothing active right now.`, hasContent: false };
  }
  const behind = goals.filter((g) => g.health === "behind");
  const atRisk = goals.filter((g) => g.health === "at_risk");
  const lines = [`${header}: ${active} active`];

  if (behind.length)
    lines.push(
      `• Behind (${behind.length}): ${behind.slice(0, 3).map((g) => `“${g.title}” ${g.progress_pct}%`).join(", ")}`,
    );
  if (atRisk.length)
    lines.push(
      `• At risk (${atRisk.length}): ${atRisk.slice(0, 3).map((g) => `“${g.title}”`).join(", ")}`,
    );
  if (overdueMilestones || overdueTasks)
    lines.push(
      `• Overdue: ${overdueMilestones} milestone(s), ${overdueTasks} task(s)`,
    );
  if (priorities.length)
    lines.push(
      `• Today: ${priorities.slice(0, 5).map((t) => t.title).join(", ")}`,
    );

  if (weekly) {
    const focus = goals
      .slice(0, 5)
      .map((g) => `“${g.title}” ${g.progress_pct}% (${HEALTH_LABEL[g.health] || g.health})`)
      .join("; ");
    if (focus) lines.push(`• This week's focus: ${focus}`);
  }

  return { text: lines.join("\n"), hasContent: true };
}

/** Fetch + compose the goals digest for a brand. `weekly` adds the focus list. */
async function goalsDigest({ brand, weekly = false, assistantName = "Chief of Staff" }) {
  const goals = await query(
    `SELECT goal_id, title, progress_pct, health, target_date
       FROM shared.goals
      WHERE business = $1 AND is_deleted = false AND status = 'active'
      ORDER BY CASE health WHEN 'behind' THEN 0 WHEN 'at_risk' THEN 1
                           WHEN 'on_track' THEN 2 ELSE 3 END,
               (target_date IS NULL), target_date
      LIMIT 8`,
    [brand],
  );
  const overdue = await query(
    `SELECT
       (SELECT count(*)::int FROM shared.goal_milestones m
         JOIN shared.goals g ON g.goal_id = m.goal_id
        WHERE g.business = $1 AND g.is_deleted = false
          AND m.status NOT IN ('done','skipped')
          AND m.target_date IS NOT NULL AND m.target_date < current_date) AS overdue_milestones,
       (SELECT count(*)::int FROM shared.tasks t
        WHERE t.business = $1 AND t.is_deleted = false AND t.goal_id IS NOT NULL
          AND t.status NOT IN ('done','cancelled')
          AND t.due_at IS NOT NULL AND t.due_at < now())                  AS overdue_tasks`,
    [brand],
  );
  const priorities = await query(
    `SELECT title FROM shared.tasks
      WHERE business = $1 AND is_deleted = false
        AND status NOT IN ('done','cancelled')
        AND due_at >= date_trunc('day', now())
        AND due_at <  date_trunc('day', now()) + interval '1 day'
      ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                             WHEN 'normal' THEN 2 ELSE 3 END
      LIMIT 5`,
    [brand],
  );

  const section = composeGoalsSection({
    brand,
    goals: goals.rows,
    overdueMilestones: overdue.rows[0].overdue_milestones,
    overdueTasks: overdue.rows[0].overdue_tasks,
    priorities: priorities.rows,
    weekly,
    assistantName,
  });
  return {
    ...section,
    stats: {
      active: goals.rows.length,
      overdue_milestones: overdue.rows[0].overdue_milestones,
      overdue_tasks: overdue.rows[0].overdue_tasks,
    },
  };
}

/**
 * Optional Tier-2 narrative over the deterministic section, via the failover
 * router. Metered under cos_chat. Returns text or null (caller keeps Tier-1).
 * Never throws.
 */
async function narrate({ brand, ceoId, facts, weekly = false, assistantName = "Chief of Staff" }) {
  try {
    if (!ceoId || !facts) return null;
    const guard = await governance.canUseFeature({
      user_id: ceoId,
      feature_key: FEATURE,
      is_ceo: true,
      business: brand,
    });
    if (!guard.ok) return null;

    const system = [
      `You are ${assistantName}, the CEO's Chief of Staff, writing the goals part of the ${weekly ? "Monday executive review" : "morning briefing"} for the ${brand} business.`,
      "You are given a deterministic summary of goals, risks and priorities.",
      "Write 2–3 short sentences: what needs attention today and why. Warm, direct, specific. No greeting, no bullet points, no markdown.",
    ].join("\n");

    const completion = await llmRouter.chatWithFailover({
      capability: "chat",
      messages: [
        { role: "system", content: system },
        { role: "user", content: facts },
      ],
      brand,
      feature_key: FEATURE,
      temperature: 0.4,
    });
    const text = (completion.content || "").trim();
    if (!text) return null;

    let cost = "0";
    try {
      const model = await modelCatalogue.resolveActiveModel({
        vendor: completion.vendor,
        capability: "chat",
      });
      if (model)
        cost = modelCatalogue.computeCost({
          model,
          input_tokens: completion.usage.prompt_tokens || 0,
          output_tokens: completion.usage.completion_tokens || 0,
        });
    } catch {
      /* best-effort cost */
    }
    try {
      await governance.recordUsage({
        usage: {
          user_id: ceoId,
          feature_key: FEATURE,
          business: brand,
          provider: completion.vendor,
          model: completion.model,
          call_type: weekly ? "cos_weekly_review" : "cos_briefing",
          input_tokens: completion.usage.prompt_tokens || 0,
          output_tokens: completion.usage.completion_tokens || 0,
          total_tokens: completion.usage.total_tokens || 0,
          cost_native: cost,
          cost_ngn: cost,
          was_successful: true,
        },
      });
    } catch (err) {
      logger.warn({ err: err.message }, "cos briefing usage record failed");
    }
    return text;
  } catch (err) {
    logger.warn({ err: err.message, brand }, "cos briefing narrate failed; Tier-1 only");
    return null;
  }
}

module.exports = { goalsDigest, composeGoalsSection, narrate };
