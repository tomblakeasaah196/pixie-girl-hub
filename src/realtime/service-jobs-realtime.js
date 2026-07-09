/**
 * Service Jobs real-time relay (Faitlyn styling tracker, §6.24).
 *
 * Subscribes to service_jobs domain events and broadcasts thin signals into
 * the canonical room brand:{brand}:service_jobs. Per ARCHITECTURE.md, modules
 * emit domain events; this relay (not the service) talks to Socket.io.
 * Registered once during socket init.
 *
 * Consumers (the Service Jobs board + job detail drawer) treat these as a
 * *signal* to re-read; payloads carry only IDs + what changed.
 */

"use strict";

const events = require("../modules/service_jobs/service-jobs.events");
const { ROOMS } = require("./rooms");
const { getBroadcaster } = require("./emitter");
const { logger } = require("../config/logger");

function emitToBrand(brand, channel, payload) {
  if (!brand) return;
  try {
    getBroadcaster().to(ROOMS.service_jobs(brand)).emit(channel, payload);
  } catch (err) {
    // Redis unavailable (tests/scripts without initRedis).
    logger.debug({ err: err.message }, "service_jobs realtime emit skipped");
  }
}

let registered = false;

function registerServiceJobsRealtime() {
  // Idempotent: socket init (API) and startWorkers (worker/in-process dev)
  // may both call this; the second call must not duplicate emissions.
  if (registered) return;
  registered = true;

  // Board-shifting transitions — each moves a job between columns/states.
  const jobEvents = [
    "created",
    "assigned",
    "advanced",
    "completed",
    "ready_for_dispatch",
    "wig_written_off",
  ];
  for (const evt of jobEvents) {
    events.on(evt, ({ brand, job_id, id }) =>
      emitToBrand(brand, `service_jobs:${evt}`, { job_id: job_id || id }),
    );
  }

  logger.info("service_jobs realtime relay registered");
}

module.exports = { registerServiceJobsRealtime };
