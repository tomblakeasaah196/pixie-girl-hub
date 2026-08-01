/**
 * cos-plan-exec queue — executes a confirmed Chief-of-Staff plan in the
 * background (PR3): the confirm request enqueues and returns immediately, so
 * a goal + dozens of milestones/tasks/events can't time out the HTTP request
 * or the proxy, and the CEO's 45-minute idle window can't kill a run mid-way.
 *
 * The job carries the cos_plan_exec service token minted at confirm time —
 * every step still re-enters the real REST endpoint as the CEO (RBAC/Zod/
 * audit unchanged). NEVER log job.data: the token lives there.
 *
 * Retry semantics: executePlanJob throws only on infra errors, so BullMQ's
 * attempts cover crashes — a resumed attempt skips already-executed steps.
 * Step-level failures complete the job as 'partially_failed' and wait for the
 * CEO's "Retry remaining".
 */

"use strict";

const planExecutor = require("../../modules/chief_of_staff/cos.plan-executor");

module.exports = async function processCosPlanExec(job) {
  const { plan_id, user_id, service_token, request_id } = job.data;
  const result = await planExecutor.executePlanJob({
    plan_id,
    user_id,
    service_token,
    request_id,
  });
  // Return value lands in BullMQ's completed-job record — keep it thin and
  // token-free (a full plan row would bloat Redis for nothing).
  return result ? { plan_id, status: result.status } : { plan_id, skipped: true };
};
