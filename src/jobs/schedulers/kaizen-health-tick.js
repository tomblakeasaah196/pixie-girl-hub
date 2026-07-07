/**
 * Kaizen health tick — runs every minute in the worker (under withCronLock so
 * only one fleet instance persists a snapshot per minute). Persists a health
 * snapshot per component for trend lines + alerting.
 *
 * Note: performance rollups are flushed by a self-timer in the API process
 * (perf.service.startAutoFlush), NOT here — the worker can't see the API
 * process's in-memory reservoir. See guide §7.5.
 *
 * Once an hour it also prunes old health snapshots (30d) and perf rollups (90d)
 * so the tables stay bounded before the dedicated maintenance tick (Phase 5).
 */

"use strict";

const { logger } = require("../../config/logger");
const healthService = require("../../modules/kaizen/health/health.service");
const healthRepo = require("../../modules/kaizen/health/health.repo");
const perfRepo = require("../../modules/kaizen/perf/perf.repo");

async function run() {
  try {
    await healthService.snapshot();
  } catch (err) {
    logger.warn({ err: err.message }, "kaizen health-tick snapshot failed");
  }

  // Opportunistic retention at the top of the hour.
  if (new Date().getMinutes() === 0) {
    try {
      await healthRepo.pruneOlderThan(30);
      await perfRepo.pruneOlderThan(90);
    } catch (err) {
      logger.warn({ err: err.message }, "kaizen health-tick prune failed");
    }
  }
}

module.exports = { run };
