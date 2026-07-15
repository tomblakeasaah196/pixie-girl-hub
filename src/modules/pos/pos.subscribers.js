/**
 * POS reconciliation notification fan-out — turns the "pending" domain event
 * (a payment just got parked) into an active in-app notification for every
 * sales:edit holder in the brand, or every CEO when the brand isn't known yet
 * (decision 6B). Best-effort: failures are logged, never thrown.
 */

"use strict";

const events = require("./pos.events");
const service = require("./pos.service");
const { logger } = require("../../config/logger");

let registered = false;

function register() {
  if (registered) return;
  registered = true;

  events.on("pending", async (payload) => {
    try {
      await service.notifyNewPending(payload);
    } catch (err) {
      logger.error(
        { err: err.message, recon_id: payload.recon_id },
        "pos_reconciliation: pending notification failed",
      );
    }
  });

  logger.info("pos notification subscribers registered");
}

register();

module.exports = { register };
