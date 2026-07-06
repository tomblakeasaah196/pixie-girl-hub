/**
 * AI Insights detector sweep (V2.2 §6.30). Runs the tier-1 detectors
 * (overdue invoices, stale intercompany, approval backlog, anti-pocketing
 * service-match) across all brands and raises idempotent insight flags.
 */

"use strict";

const { logger } = require("../../config/logger");
const insights = require("../../modules/ai_insights/insights.service");

async function runAiInsightsSweep() {
  try {
    // Cron path: honour each module's frequency cadence (daily/weekly/off) so a
    // module set to "weekly" isn't re-scanned every 30 min. The manual Run-scan
    // button in the UI uses the 'manual' trigger and scans everything enabled.
    return await insights.runDetectorSweep({ trigger: "cron" });
  } catch (err) {
    logger.error({ err: err.message }, "ai insights sweep failed");
    return null;
  }
}

module.exports = { runAiInsightsSweep };
