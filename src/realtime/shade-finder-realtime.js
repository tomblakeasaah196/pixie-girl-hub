/**
 * Shade Finder real-time relay.
 *
 * Subscribes to Shade Finder domain events and pushes them into the PUBLIC
 * Socket.io namespace (/public) room brand:{brand}:shade_session:{sid}, so
 * the storefront chat shows live "Praxis is thinking…" stages and the final
 * recommendation without polling. The HTTP response remains the source of
 * truth — a dropped socket only costs the animation, never the answer.
 *
 * Uses the process-agnostic broadcaster (live io in the API process, Redis
 * emitter elsewhere); both support namespace fan-out via .of("/public").
 */

"use strict";

const events = require("../modules/shade_finder/shade-finder.events");
const { ROOMS } = require("./rooms");
const { getBroadcaster } = require("./emitter");
const { logger } = require("../config/logger");

function emitToSession(brand, sessionId, channel, payload) {
  if (!brand || !sessionId) return;
  try {
    getBroadcaster()
      .of("/public")
      .to(ROOMS.shade_session(brand, sessionId))
      .emit(channel, payload);
  } catch (err) {
    // Redis unavailable (tests/scripts without initRedis).
    logger.debug({ err: err.message }, "shade finder realtime emit skipped");
  }
}

let registered = false;

function registerShadeFinderRealtime() {
  // Idempotent — socket init and worker startup may both call this.
  if (registered) return;
  registered = true;

  events.on("session.stage", ({ brand, session_id, stage }) =>
    emitToSession(brand, session_id, "shade:stage", {
      stage,
      at: new Date().toISOString(),
    }),
  );
  events.on("session.reply", ({ brand, session_id, result }) =>
    emitToSession(brand, session_id, "shade:reply", { result }),
  );

  logger.info("shade finder realtime relay registered");
}

module.exports = { registerShadeFinderRealtime };
