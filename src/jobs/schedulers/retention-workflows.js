/**
 * Retention workflow executor (F-4 / PD §6.23).
 * Runs every minute: claims due workflow executions (past their wait period)
 * and runs the configured action (coupon / email / WhatsApp / notify).
 */

"use strict";

const { logger } = require("../../config/logger");
const workflow = require("../../modules/retention/workflow.service");

async function runRetentionWorkflows() {
  try {
    return await workflow.executeQueued();
  } catch (err) {
    logger.error({ err: err.message }, "retention workflow sweep failed");
    return { done: 0 };
  }
}

module.exports = { runRetentionWorkflows };
