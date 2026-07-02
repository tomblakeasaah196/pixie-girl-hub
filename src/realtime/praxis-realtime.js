/**
 * Praxis real-time relay (V2.2 §6.29).
 *
 * Subscribes to Praxis domain events and pushes them into the canonical
 * per-user room user:{id}:ai_pending, so every open tab's Praxis surface
 * shows a new confirm card — or drops a resolved one — without polling.
 * Payloads are thin (ids + status only); the client re-queries for detail.
 *
 * Uses the process-agnostic broadcaster: in the API process this is the live
 * Socket.io server; in the worker (where the expiry sweep runs) it publishes
 * through the Redis emitter bridge.
 */

"use strict";

const events = require("../modules/praxis_ai/praxis.events");
const { ROOMS } = require("./rooms");
const { getBroadcaster } = require("./emitter");
const { logger } = require("../config/logger");

function emitToUser(userId, channel, payload) {
  if (!userId) return;
  try {
    getBroadcaster().to(ROOMS.user_ai_pending(userId)).emit(channel, payload);
  } catch (err) {
    // Redis unavailable (tests/scripts without initRedis).
    logger.debug({ err: err.message }, "praxis realtime emit skipped");
  }
}

let registered = false;

function registerPraxisRealtime() {
  // Idempotent: socket init (API) and startWorkers (worker/in-process dev)
  // may both call this; the second call must not duplicate emissions.
  if (registered) return;
  registered = true;

  events.on("pending.created", ({ pending_id, user_id, conversation_id }) =>
    emitToUser(user_id, "ai_pending:created", { pending_id, conversation_id }),
  );
  events.on("pending.resolved", ({ pending_id, user_id, status }) =>
    emitToUser(user_id, "ai_pending:resolved", { pending_id, status }),
  );

  logger.info("praxis realtime relay registered");
}

module.exports = { registerPraxisRealtime };
