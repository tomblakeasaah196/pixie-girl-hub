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
    return await insights.runDetectorSweep();
  } catch (err) {
    logger.error({ err: err.message }, "ai insights sweep failed");
    return null;
  }
}

module.exports = { runAiInsightsSweep };
