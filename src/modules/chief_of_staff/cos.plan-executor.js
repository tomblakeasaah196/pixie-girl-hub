/**
 * Chief of Staff (PR3) — batch-plan executor.
 *
 * On CEO approval, run a plan's steps in plan_step order via the SAME executor
 * Praxis uses (praxis.executor.executeAction) — a loopback HTTP call as the CEO,
 * so auth / brand / RBAC / Zod / audit all re-apply on the real endpoint and
 * the CoS can never exceed the CEO. Before each step, `{{step:N.field}}` tokens
 * in its payload are resolved from prior steps' results.
 *
 * Idempotent + resumable: already-'executed' steps are skipped and their result
 * re-seeded, so a re-run continues from the first unfinished step. A step
 * failure stops the run (dependents can't resolve) and the plan lands in
 * 'partially_failed' — re-confirming resumes it.
 */

"use strict";

const repo = require("./cos.repo");
const planner = require("./cos.planner");
const events = require("./cos.events");
const executor = require("../praxis_ai/praxis.executor");
const { audit } = require("../../middleware/audit");
const { logger } = require("../../config/logger");
const { NotFoundError, AppError } = require("../../utils/errors");

const nowIso = () => new Date().toISOString();

/**
 * Execute (or resume) a confirmed plan. Runs steps in order; returns the final
 * plan row + its steps. Never throws for a step-level failure — it records it
 * and returns 'partially_failed'.
 */
async function executePlan({ plan, auth_header, request_id }) {
  await repo.setPlanStatus({ id: plan.plan_id, status: "executing" });
  const steps = await repo.listPlanSteps({ plan_id: plan.plan_id });

  // priorResults[plan_step] = that step's execution_result (endpoint body).
  // Pre-seed from already-executed steps so a resume can resolve their tokens.
  const priorResults = [];
  for (const s of steps) {
    if (s.status === "executed" && s.execution_result) {
      priorResults[s.plan_step] = s.execution_result;
    }
  }

  let anyFailed = false;
  for (const step of steps) {
    if (step.status === "executed") continue;

    const payload = planner.resolveTokens(step.payload, priorResults);
    if (planner.hasUnresolvedTokens(payload)) {
      await repo.setStepStatus({
        id: step.pending_id,
        status: "failed",
        fields: {
          executed_at: nowIso(),
          execution_error:
            "Unresolved cross-step reference — a prior step did not produce the referenced value.",
        },
      });
      anyFailed = true;
      break;
    }

    let exec;
    try {
      exec = await executor.executeAction({
        pending: {
          method: step.method,
          route: step.route,
          payload,
          business: step.business,
        },
        authHeader: auth_header,
        requestId: request_id,
      });
    } catch (err) {
      logger.error(
        { err: err.message, plan_id: plan.plan_id, step: step.plan_step },
        "cos: plan step execution threw",
      );
      await repo.setStepStatus({
        id: step.pending_id,
        status: "failed",
        fields: {
          executed_at: nowIso(),
          execution_error: String(err.user_message || err.message).slice(0, 2000),
        },
      });
      anyFailed = true;
      break;
    }

    if (exec.ok) {
      await repo.setStepStatus({
        id: step.pending_id,
        status: "executed",
        fields: { executed_at: nowIso(), execution_result: exec.result },
      });
      priorResults[step.plan_step] = exec.result;
    } else {
      await repo.setStepStatus({
        id: step.pending_id,
        status: "failed",
        fields: {
          executed_at: nowIso(),
          execution_error: JSON.stringify(exec.result).slice(0, 2000),
        },
      });
      anyFailed = true;
      break;
    }
  }

  const finalStatus = anyFailed ? "partially_failed" : "executed";
  const updated = await repo.setPlanStatus({
    id: plan.plan_id,
    status: finalStatus,
  });
  const finalSteps = await repo.listPlanSteps({ plan_id: plan.plan_id });
  events.emit("plan.executed", {
    plan_id: plan.plan_id,
    user_id: plan.proposed_by_user_id,
    status: finalStatus,
  });
  return { ...updated, steps: finalSteps };
}

/** Approve a plan and run it. Owner-checked, expiry-checked, resumable. */
async function confirmPlan({ user, request_id, id, auth_header }) {
  const plan = await repo.findPlan({ id });
  if (!plan || plan.proposed_by_user_id !== user.user_id)
    throw new NotFoundError("Plan");

  const resumable = ["proposed", "confirmed", "executing", "partially_failed"];
  if (!resumable.includes(plan.status))
    throw new AppError("BAD_STATE", `Plan is ${plan.status}, cannot run`, 422);

  if (plan.status === "proposed" && new Date(plan.expires_at) < new Date()) {
    await repo.setPlanStatus({ id, status: "expired" });
    events.emit("plan.resolved", { plan_id: id, user_id: user.user_id, status: "expired" });
    throw new AppError("EXPIRED", "This plan has expired — ask me to re-plan.", 410);
  }

  if (plan.status === "proposed") {
    await repo.setPlanStatus({
      id,
      status: "confirmed",
      fields: { confirmed_by_user_id: user.user_id, confirmed_at: nowIso() },
    });
    // Flip the still-proposed steps to 'confirmed' so the board reflects intent.
    // Stamp the confirming user on each step too: it mirrors the single-action
    // confirm gate's data, keeps the audit trail complete, and satisfies the
    // ai_pending_actions confirm trigger for any DB not yet on migration 000330.
    const steps = await repo.listPlanSteps({ plan_id: id });
    for (const s of steps) {
      if (s.status === "proposed")
        await repo.setStepStatus({
          id: s.pending_id,
          status: "confirmed",
          fields: { confirmed_by_user_id: user.user_id, confirmed_at: nowIso() },
        });
    }
  }

  await audit({
    business: plan.business,
    user_id: user.user_id,
    action_key: "cos.plan.confirm",
    target_type: "ai_pending_plan",
    target_id: id,
    after: { title: plan.title },
    request_id,
  });
  events.emit("plan.confirmed", { plan_id: id, user_id: user.user_id });

  const fresh = await repo.findPlan({ id });
  return executePlan({ plan: fresh, auth_header, request_id });
}

/** Reject a proposed plan. Cancels its steps. */
async function rejectPlan({ user, request_id, id, reason }) {
  const plan = await repo.findPlan({ id });
  if (!plan || plan.proposed_by_user_id !== user.user_id)
    throw new NotFoundError("Plan");
  if (plan.status !== "proposed")
    throw new AppError("BAD_STATE", `Plan is ${plan.status}`, 422);

  const updated = await repo.setPlanStatus({
    id,
    status: "rejected",
    fields: { rejected_at: nowIso(), rejection_reason: reason || null },
  });
  const steps = await repo.listPlanSteps({ plan_id: id });
  for (const s of steps) {
    if (s.status === "proposed" || s.status === "confirmed")
      await repo.setStepStatus({ id: s.pending_id, status: "cancelled" });
  }
  await audit({
    business: plan.business,
    user_id: user.user_id,
    action_key: "cos.plan.reject",
    target_type: "ai_pending_plan",
    target_id: id,
    request_id,
  });
  events.emit("plan.resolved", { plan_id: id, user_id: user.user_id, status: "rejected" });
  return updated;
}

module.exports = { executePlan, confirmPlan, rejectPlan };
