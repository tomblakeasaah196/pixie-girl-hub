/**
 * AI Insights real-time relay (V2.2 §6.30).
 *
 * Subscribes to AI-insight domain events and broadcasts a thin `insights:changed`
 * signal into brand:{brand}:insights. Consumers (the Insights Center + the
 * per-module <ModuleInsights> slot) treat it as a cue to re-read — payloads carry
 * no sensitive detail. This is what makes tier-1 findings feel live rather than
 * waiting on the client's staleTime (spec: "event-triggered alerts, not just the
 * daily run").
 *
 * Runs in both the API process (socket init) and the worker (where the 30-min
 * sweep fires); the process-agnostic broadcaster bridges via Redis.
 */

"use strict";

const events = require("../modules/ai_insights/insights.events");
const { ROOMS, BRANDS } = require("./rooms");
const { getBroadcaster } = require("./emitter");
const { logger } = require("../config/logger");

function emitToBrand(brand, payload) {
  if (!brand) return;
  try {
    getBroadcaster().to(ROOMS.insights(brand)).emit("insights:changed", payload);
  } catch (err) {
    // Redis unavailable (tests/scripts without initRedis).
    logger.debug({ err: err.message }, "insights realtime emit skipped");
  }
}

function emitAllBrands(payload) {
  for (const brand of BRANDS) emitToBrand(brand, payload);
}

let registered = false;

function registerInsightsRealtime() {
  // Idempotent: socket init (API) and startWorkers (worker/in-process dev) may
  // both call this; the second call must not duplicate emissions.
  if (registered) return;
  registered = true;

  // A sweep may have raised findings across brands — nudge every brand room.
  events.on("sweep.completed", (summary) =>
    emitAllBrands({ reason: "sweep", created: summary?.created ?? 0 }),
  );

  // A lifecycle change (ack/resolve/dismiss) — nudge the owning brand, or all
  // brands for a cross-brand (business=null) insight.
  events.on("insight.updated", ({ business, status }) => {
    const payload = { reason: "updated", status };
    if (business) emitToBrand(business, payload);
    else emitAllBrands(payload);
  });

  logger.info("insights realtime relay registered");
}

module.exports = { registerInsightsRealtime };
