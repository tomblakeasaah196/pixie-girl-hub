/**
 * calls-lifecycle queue — delayed ring choreography for WhatsApp calls.
 *
 * Jobs (one per call, deduped by jobId, single attempt — each is a
 * point-in-time check against the DB, so a retry would just re-read the
 * same settled state):
 *
 *   escalate     +15s  — nobody claimed the owner-first ring → widen the
 *                        ring to every online agent on the brand.
 *   sweep-stale  +120s — no terminate webhook ever arrived → settle the
 *                        stranded ringing row as missed (runs the missed
 *                        follow-ups so the customer still gets the
 *                        auto-reply + a CRM task exists).
 */

"use strict";

const service = require("../../modules/calls/calls.service");
const { logger } = require("../../config/logger");

module.exports = async function processCallsLifecycle(job) {
  const { call_id } = job.data || {};
  if (!call_id) return;
  if (job.name === "escalate") {
    await service.escalateRing({ call_id });
  } else if (job.name === "sweep-stale") {
    await service.sweepStaleRinging({ call_id });
  } else {
    logger.warn({ job: job.name }, "calls-lifecycle: unknown job name");
  }
};
