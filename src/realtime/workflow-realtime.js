/**
 * Workflow real-time relay (V2.2 §6.27).
 *
 * Subscribes to the workflow engine's domain events and broadcasts them into
 * the canonical room brand:{brand}:approvals. Per ARCHITECTURE.md the engine
 * emits events; this relay (not a controller/service) talks to Socket.io.
 * Registered once during socket init.
 *
 * The frontend's pending-approvals badge listens on this room and refetches
 * /api/v1/org/approvals/pending on any of these events.
 */

"use strict";

const wf = require("../workflows/engine");
const { ROOMS } = require("./rooms");
const { getBroadcaster } = require("./emitter");
const { logger } = require("../config/logger");

function emitToApprovals(instance, channel, payload) {
  if (!instance || !instance.business) return;
  try {
    getBroadcaster()
      .to(ROOMS.approvals(instance.business))
      .emit(channel, { instance_id: instance.instance_id, ...payload });
  } catch (err) {
    // Redis unavailable (tests/scripts without initRedis).
    logger.debug({ err: err.message }, "workflow realtime emit skipped");
  }
}

let registered = false;

function registerWorkflowRealtime() {
  // Idempotent: socket init (API) and startWorkers (worker/in-process dev)
  // may both call this; the second call must not duplicate emissions.
  if (registered) return;
  registered = true;
  wf.onWorkflowEvent("workflow.opened", ({ instance }) =>
    emitToApprovals(instance, "approval:opened", {
      current_stage: instance.current_stage,
      reference: {
        table: instance.reference_table,
        id: instance.reference_id,
      },
    }),
  );

  wf.onWorkflowEvent("workflow.advanced", ({ instance, auto }) =>
    emitToApprovals(instance, "approval:advanced", {
      current_stage: instance.current_stage,
      auto: auto === true,
    }),
  );

  wf.onWorkflowEvent("workflow.changes_requested", ({ instance, notes }) =>
    emitToApprovals(instance, "approval:changes_requested", { notes }),
  );

  wf.onWorkflowEvent("workflow.escalated", ({ instance, stage }) =>
    emitToApprovals(instance, "approval:escalated", { stage }),
  );

  wf.onWorkflowEvent("workflow.completed", ({ instance, status, auto }) =>
    emitToApprovals(instance, "approval:completed", {
      status,
      auto: auto === true,
    }),
  );

  logger.info("workflow realtime relay registered");
}

module.exports = { registerWorkflowRealtime };
