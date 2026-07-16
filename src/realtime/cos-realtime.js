/**
 * Chief of Staff real-time relay (PR4).
 *
 * Subscribes to CoS domain events and pushes thin payloads into the per-user
 * room user:{id}:goals, so the Workspace Goals dashboard and the Goal-detail
 * AI-Insights card update live when the accountability sweep raises a follow-up,
 * a goal's health changes, or the CEO resolves a follow-up — no polling.
 *
 * Uses the process-agnostic broadcaster: the API process emits through the live
 * Socket.io server; the worker (where the hourly sweep runs) publishes through
 * the Redis emitter bridge. Idempotent — socket init and startWorkers may both
 * register it.
 */

"use strict";

const cosEvents = require("../modules/chief_of_staff/cos.events");
const { ROOMS } = require("./rooms");
const { getBroadcaster } = require("./emitter");
const { logger } = require("../config/logger");

function emitToUser(userId, channel, payload) {
  if (!userId) return;
  try {
    getBroadcaster().to(ROOMS.user_goals(userId)).emit(channel, payload);
  } catch (err) {
    // Redis unavailable (tests/scripts without initRedis).
    logger.debug({ err: err.message }, "cos realtime emit skipped");
  }
}

let registered = false;

function registerCosRealtime() {
  if (registered) return;
  registered = true;

  cosEvents.on("followup.created", (p) =>
    emitToUser(p.user_id, "cos_followup:created", p),
  );
  cosEvents.on("followup.updated", (p) =>
    emitToUser(p.user_id, "cos_followup:updated", p),
  );
  cosEvents.on("followup.resolved", (p) =>
    emitToUser(p.user_id, "cos_followup:resolved", p),
  );
  cosEvents.on("goal.health_changed", (p) =>
    emitToUser(p.user_id, "cos_goal:health", p),
  );
  // Live turn progress (PR2-D) — streamed to the chat while the CoS thinks.
  cosEvents.on("turn.progress", (p) =>
    emitToUser(p.user_id, "cos_turn:progress", p),
  );

  logger.info("cos realtime relay registered");
}

module.exports = { registerCosRealtime };
