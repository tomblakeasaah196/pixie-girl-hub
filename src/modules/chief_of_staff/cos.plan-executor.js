/**
 * Chief of Staff (PR3) — batch-plan executor.
 *
 * On CEO approval, run a plan's steps in plan_step order via the SAME executor
 * Praxis uses (praxis.executor.executeAction) — a loopback HTTP call as the CEO,
 * so auth / brand / RBAC / Zod / audit all re-apply on the real endpoint and
 * the CoS can never exceed the CEO. Before each step, `{{step:N.field}}` tokens
 * in its payload are resolved from prior steps' results.
 *
 * Execution is a BACKGROUND JOB: confirmPlan mints a short-lived cos_plan_exec
 * service token (the worker has no live request to borrow a JWT from, and the
 * CEO's own token dies with the 45-minute idle window — see middleware/auth.js
 * + shared/hr_payroll/service-tokens.js), enqueues onto the `cos-plan-exec`
 * BullMQ queue, and returns immediately with status 'executing'. The worker
 * (jobs/processors/cos-plan-exec-processor.js → executePlanJob) runs the steps
 * and the plan.executed event reaches the browser via the realtime bridge, so
 * a dozens-of-steps plan can never time out the confirm request or the proxy.
 *
 * Idempotent + resumable: already-'executed' steps are skipped and their result
 * re-seeded, so a re-run (BullMQ retry after a crash, or the CEO's "Retry
 * remaining") continues from the first unfinished step. A step failure stops
 * its dependents and the plan lands in 'partially_failed' — re-confirming
 * resumes it.
 */

"use strict";

const repo = require("./cos.repo");
const planner = require("./cos.planner");
const events = require("./cos.events");
const executor = require("../praxis_ai/praxis.executor");
const goalsRepo = require("../../shared/goals/goals.repo");
const governance = require("../ai_governance/governance.service");
const identityCache = require("../../shared/cache/identity-cache");
const { mintCosPlanExecToken } = require("../../shared/hr_payroll/service-tokens");
const { enqueue } = require("../../jobs/queue-producer");
const { makeRepairFn } = require("./cos.repair");
const { humaniseExecutionError, isValidationFailure } = require("./cos.errors");
const { audit } = require("../../middleware/audit");
const { logger } = require("../../config/logger");
const { NotFoundError, AppError } = require("../../utils/errors");

// BullMQ queue carrying plan-execution jobs (consumed in jobs/worker.js).
// Modest attempts: retries exist for crashes/infra errors, not business
// failures — a step-level failure completes the job as partially_failed and
// waits for the CEO's "Retry remaining". executePlan is resumable, so an
// attempt-2 after a crash skips already-executed steps (idempotency inside
// the step loop is PR2's per-step guard).
const EXEC_QUEUE = "cos-plan-exec";
const EXEC_ATTEMPTS = 3;

const nowIso = () => new Date().toISOString();

const FEATURE = "cos_chat";

/**
 * Duplicate-goal guard: a create_goal step whose title matches a live goal
 * fails with an actionable message INSTEAD of minting a twin — the CEO edits
 * the step's payload (rename) and hits "Retry remaining", or rejects the
 * plan. Lookup failures never block the run (guard is best-effort).
 * @returns {Promise<string|null>} an error message, or null to proceed
 */
async function duplicateGoalError({ step, payload }) {
  if (step.action_key !== "workspace.create_goal") return null;
  const title = payload && payload.title;
  if (!title || !step.business) return null;
  try {
    const dup = await goalsRepo.findActiveByTitle({
      business: step.business,
      title,
    });
    if (dup)
      return (
        `A goal titled “${dup.title}” already exists (status: ${dup.status}). ` +
        "Edit this step's title and retry the remaining steps, or reject the plan."
      );
  } catch (err) {
    logger.warn(
      { err: err.message, plan_step: step.plan_step },
      "cos: duplicate-goal guard lookup failed — proceeding",
    );
  }
  return null;
}

/**
 * Run one step over the loopback executor with an optional single self-repair
 * retry on a fixable validation failure. Returns { ok, result, http_status,
 * payload } — `payload` is what actually ran (possibly repaired).
 */
async function runStepOnce({ step, payload, auth_header, request_id }) {
  try {
    const exec = await executor.executeAction({
      pending: {
        method: step.method,
        route: step.route,
        payload,
        business: step.business,
        // Stable across retries, unique per step → the idempotency middleware
        // replays a prior success instead of minting a duplicate record.
        idempotency_key: step.plan_id ? `cos:${step.plan_id}:${step.plan_step}` : undefined,
      },
      authHeader: auth_header,
      requestId: request_id,
    });
    return { ok: exec.ok, result: exec.result, http_status: exec.http_status, payload };
  } catch (err) {
    logger.error(
      { err: err.message, step: step.plan_step },
      "cos: plan step execution threw",
    );
    return {
      ok: false,
      threw: true,
      result: { error: { message: err.user_message || err.message } },
      http_status: err.http_status || 0,
      payload,
    };
  }
}

/**
 * Execute (or resume) a confirmed plan. Runs steps in order; returns the final
 * plan row + its steps. Never throws for a step-level failure.
 *
 * Resilience (docs/COS_ARCHITECTURE_AUDIT.md §5):
 *   - Dependency-aware: one failed step no longer kills the rest. Independent
 *     steps still run; only steps that reference a failed step (via
 *     {{step:N.field}}) are skipped, with a clear reason.
 *   - Self-repairing: a step that fails on a fixable validation error gets ONE
 *     model-corrected retry (when `repair` is provided) before it's recorded.
 *   - Human errors: failures are stored as one plain sentence, not raw JSON.
 *
 * @param {object}  args
 * @param {object}  args.plan
 * @param {string}  args.auth_header
 * @param {string}  [args.request_id]
 * @param {Function}[args.repair]   makeRepairFn output; omitted → no self-repair
 * @param {Map}     [args.actionByKey]  action_key → catalogue row (for repair schema)
 */
async function executePlan({ plan, auth_header, request_id, repair = null, actionByKey = null }) {
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

  const failedSteps = new Set(); // plan_step indices that failed or were skipped
  const recordFail = async (step, execution_error, fields = {}) => {
    failedSteps.add(step.plan_step);
    await repo.setStepStatus({
      id: step.pending_id,
      status: "failed",
      fields: { executed_at: nowIso(), execution_error: String(execution_error).slice(0, 2000), ...fields },
    });
  };

  for (const step of steps) {
    if (step.status === "executed") continue;

    // Skip only TRUE dependents of an already-failed step — independent work
    // must still run (this is what stops one bad field taking the plan down).
    const deps = planner.referencedSteps(step.payload);
    const blockedBy = deps.filter((d) => failedSteps.has(d));
    if (blockedBy.length) {
      await recordFail(
        step,
        `Skipped — this step needs the result of step ${blockedBy[0] + 1}, which didn't complete. Fix that step and Retry remaining.`,
      );
      continue;
    }

    const payload = planner.resolveTokens(step.payload, priorResults);
    if (planner.hasUnresolvedTokens(payload)) {
      await recordFail(
        step,
        "A referenced value from an earlier step is missing, so this step can't run yet.",
      );
      continue;
    }

    const dupError = await duplicateGoalError({ step, payload });
    if (dupError) {
      await recordFail(step, dupError);
      continue;
    }

    let attempt = await runStepOnce({ step, payload, auth_header, request_id });

    // One self-repair round on a fixable validation failure.
    if (
      !attempt.ok &&
      repair &&
      actionByKey &&
      isValidationFailure({ result: attempt.result, http_status: attempt.http_status })
    ) {
      try {
        const action = actionByKey.get(step.action_key);
        const errText = humaniseExecutionError({ result: attempt.result, http_status: attempt.http_status });
        const fixed = await repair(step, action, errText);
        if (fixed) {
          const resolvedFix = planner.resolveTokens(fixed, priorResults);
          if (!planner.hasUnresolvedTokens(resolvedFix)) {
            const retry = await runStepOnce({ step, payload: resolvedFix, auth_header, request_id });
            if (retry.ok) attempt = retry;
            else attempt = { ...retry, payload: resolvedFix };
          }
        }
      } catch (err) {
        logger.warn({ err: err.message, step: step.plan_step }, "cos: self-repair round failed");
      }
    }

    if (attempt.ok) {
      await repo.setStepStatus({
        id: step.pending_id,
        status: "executed",
        fields: {
          executed_at: nowIso(),
          execution_result: attempt.result,
          // Persist a repaired payload so the card reflects what actually ran.
          ...(attempt.payload !== step.payload ? { payload: attempt.payload } : {}),
        },
      });
      priorResults[step.plan_step] = attempt.result;
    } else {
      await recordFail(
        step,
        humaniseExecutionError({ result: attempt.result, http_status: attempt.http_status }),
        attempt.payload !== step.payload ? { payload: attempt.payload } : {},
      );
    }
  }

  const finalStatus = failedSteps.size ? "partially_failed" : "executed";
  const updated = await repo.setPlanStatus({
    id: plan.plan_id,
    status: finalStatus,
  });
  const finalSteps = await repo.listPlanSteps({ plan_id: plan.plan_id });
  events.emit("plan.executed", {
    plan_id: plan.plan_id,
    // Lets the client refresh exactly the conversation whose card is waiting,
    // instead of invalidating every cached conversation.
    conversation_id: plan.conversation_id || null,
    user_id: plan.proposed_by_user_id,
    status: finalStatus,
  });
  return { ...updated, steps: finalSteps };
}

/**
 * Build the self-repair machinery for a run: a repair fn + an action lookup.
 * Guarded by the 'cos_chat' feature (a repair is an LLM call) — returns nulls
 * when the feature is off/over budget or no workspace actions are enabled, so
 * execution simply runs without self-repair.
 */
async function buildRepairContext({ user, plan }) {
  try {
    const guard = await governance.canUseFeature({
      user_id: user.user_id,
      feature_key: FEATURE,
      is_ceo: user.is_ceo,
      business: plan.business,
    });
    if (!guard.ok) return { repair: null, actionByKey: null };
    const actions = await governance.listActions({ ai_enabled: true, surface: "workspace" });
    const actionByKey = new Map(actions.map((a) => [a.action_key, a]));
    return { repair: makeRepairFn({ user, brand: plan.business }), actionByKey };
  } catch (err) {
    logger.debug({ err: err.message }, "cos: self-repair context unavailable — running without it");
    return { repair: null, actionByKey: null };
  }
}

/**
 * Approve a plan and hand it to the background worker. Owner-checked,
 * expiry-checked, resumable (re-confirming a partially_failed or stuck
 * 'executing' plan enqueues a fresh job that skips executed steps).
 * Returns the plan with status 'executing' — completion arrives via the
 * plan.executed realtime push, not this response.
 */
async function confirmPlan({ user, request_id, id }) {
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

  // Flip to 'executing' BEFORE enqueueing so the confirm response (and any
  // refetch racing the worker) already shows the running state.
  await repo.setPlanStatus({ id, status: "executing" });

  // Minted while the CEO's request is live and authorized; travels only on
  // the job payload (Redis) and is never persisted or logged.
  const service_token = mintCosPlanExecToken({
    user_id: user.user_id,
    plan_id: id,
    brand: plan.business,
  });
  await enqueue(
    EXEC_QUEUE,
    "execute",
    { plan_id: id, brand: plan.business, user_id: user.user_id, service_token, request_id },
    { attempts: EXEC_ATTEMPTS },
  );

  const fresh = await repo.findPlan({ id });
  const steps = await repo.listPlanSteps({ plan_id: id });
  return { ...fresh, steps };
}

/**
 * Worker-side entry point (jobs/processors/cos-plan-exec-processor.js): load
 * the plan, rebuild the self-repair context, run the steps as the confirming
 * user via the service token. Throws only for infra-level errors (DB down,
 * plan table unreachable) so BullMQ retries those; a step-level failure ends
 * as 'partially_failed' WITHOUT throwing — that's the CEO's call, not a retry.
 *
 * @param {object} args
 * @param {string} args.plan_id
 * @param {string} args.user_id       The confirming user (repair context runs as them).
 * @param {string} args.service_token Raw cos_plan_exec JWT minted at confirm time.
 * @param {string} [args.request_id]
 */
async function executePlanJob({ plan_id, user_id, service_token, request_id }) {
  const plan = await repo.findPlan({ id: plan_id });
  if (!plan) {
    // Plan vanished between enqueue and run — nothing to execute, and a
    // retry can't bring it back. Complete the job quietly.
    logger.warn({ plan_id }, "cos: plan-exec job found no plan — skipping");
    return null;
  }
  // A stalled-job retry can fire after the run actually finished, and a plan
  // rejected/expired in the queue gap must not run. Only these states may
  // (re)execute — mirrors confirmPlan's resumable set post-confirm.
  if (!["confirmed", "executing", "partially_failed"].includes(plan.status)) {
    logger.info(
      { plan_id, status: plan.status },
      "cos: plan-exec job skipped — plan not in a runnable state",
    );
    return null;
  }

  // Repair context needs the confirming user's identity (governance budget +
  // CEO flag). Best-effort: an unavailable identity just runs without repair.
  let repairUser = { user_id, is_ceo: false };
  try {
    const u = await identityCache.getAuthUser(user_id);
    if (u) repairUser = { user_id: u.user_id, is_ceo: u.is_ceo === true };
  } catch (err) {
    logger.debug({ err: err.message }, "cos: plan-exec identity lookup failed");
  }
  const { repair, actionByKey } = await buildRepairContext({ user: repairUser, plan });

  return executePlan({
    plan,
    auth_header: `Bearer ${service_token}`,
    request_id,
    repair,
    actionByKey,
  });
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

module.exports = { executePlan, executePlanJob, confirmPlan, rejectPlan };
