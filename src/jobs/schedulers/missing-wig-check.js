/**
 * Missing-wig check (Stylist Studio §6.24 — wig accountability).
 * Runs daily (08:00 Africa/Lagos). For every brand, flags wigs that have been
 * OUT with a stylist longer than the brand's `missing_wig_threshold_days`
 * (studio_config, default 7) with no matching return/dispatch — the "go check
 * on this wig" signal. Emits `service_jobs.wigs_overdue` for Ops dashboards.
 * Read-only + idempotent — safe to re-run.
 */

"use strict";

const { logger } = require("../../config/logger");
const serviceJobs = require("../../modules/service_jobs/service-jobs.service");

async function runMissingWigCheck() {
  try {
    return await serviceJobs.runMissingWigCheck();
  } catch (err) {
    logger.error({ err: err.message }, "missing-wig check sweep failed");
    return { flagged: 0 };
  }
}

module.exports = { runMissingWigCheck };
