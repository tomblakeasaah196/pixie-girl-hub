/**
 * Chief of Staff (PR5) — deterministic batch-plan builder.
 *
 * Some CoS features assemble a plan WITHOUT the LLM — template instantiation and
 * batch reschedule build their steps in code, then hand the CEO the SAME
 * one-tap BatchPlanCard approval as a chat-proposed plan. This module persists
 * such a plan (one ai_pending_plans row + ordered ai_pending_actions), resolving
 * each step's catalogue action by key so method/route/permission come from the
 * single source of truth. Steps may carry `{{step:N.field}}` cross-step tokens
 * exactly like chat plans — the PR3 executor resolves them at run time.
 *
 * Nothing here executes: it returns a PROPOSED plan. The caller (or the CEO via
 * the card) confirms it through cos.plan-executor, so RBAC re-applies as the CEO.
 */

"use strict";

const cosRepo = require("./cos.repo");
const praxisRepo = require("../praxis_ai/praxis.repo");
const governance = require("../ai_governance/governance.service");
const { transaction } = require("../../config/database");
const { AppError } = require("../../utils/errors");

/** Find (or open) a named CoS thread to host a system-built plan. */
async function getOrCreateConversation({ user, brand, title }) {
  const existing = await praxisRepo.listConversations({
    user_id: user.user_id,
    kind: "chief_of_staff",
  });
  const match = (existing || []).find((c) => c.title === title && !c.is_archived);
  if (match) return match;
  return praxisRepo.createConversation({
    c: { user_id: user.user_id, business: brand, title, kind: "chief_of_staff" },
  });
}

/**
 * Resolve steps against the workspace catalogue. `steps` is
 * Array<{ action_key, payload, summary }>. Throws COS_ACTION_NOT_ALLOWED if a
 * key isn't in the scoped allowlist — the same structural guard the planner uses.
 */
async function resolveSteps(steps) {
  const actions = await governance.listActions({ ai_enabled: true, surface: "workspace" });
  const byKey = new Map(actions.map((a) => [a.action_key, a]));
  return steps.map((s) => {
    const action = byKey.get(s.action_key);
    if (!action) {
      throw new AppError(
        "COS_ACTION_NOT_ALLOWED",
        `Plan step references an action outside the workspace scope: ${s.action_key}`,
        422,
        { user_message: "That plan step is outside the Chief of Staff's remit." },
      );
    }
    return { action, payload: s.payload || {}, summary: s.summary || action.title };
  });
}

/**
 * Persist a proposed plan from explicit steps.
 * @returns {Promise<{ plan, steps, conversation_id }>}
 */
async function buildProposedPlan({ user, brand, title, summary, steps, conversationTitle }) {
  if (!Array.isArray(steps) || !steps.length)
    throw new AppError("COS_EMPTY_PLAN", "Nothing to plan.", 422);

  const resolved = await resolveSteps(steps);
  const conv = await getOrCreateConversation({
    user,
    brand,
    title: conversationTitle || "Chief of Staff · Planning",
  });

  return transaction(async (client) => {
    const plan = await cosRepo.createPlan({
      client,
      p: {
        conversation_id: conv.conversation_id,
        business: brand,
        proposed_by_user_id: user.user_id,
        title,
        summary,
      },
    });
    const persisted = [];
    let idx = 0;
    for (const r of resolved) {
      persisted.push(
        await cosRepo.createPlanStep({
          client,
          s: {
            conversation_id: conv.conversation_id,
            proposed_by_user_id: user.user_id,
            business: brand,
            action_id: r.action.action_id,
            action_key: r.action.action_key,
            method: r.action.method,
            route: r.action.route,
            payload: r.payload,
            human_summary: r.summary,
            confidence: 1,
            plan_id: plan.plan_id,
            plan_step: idx++,
          },
        }),
      );
    }
    return { plan, steps: persisted, conversation_id: conv.conversation_id };
  });
}

module.exports = { buildProposedPlan, getOrCreateConversation, resolveSteps };
