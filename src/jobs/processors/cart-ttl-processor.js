/**
 * Cart reservation TTL processor (GAP-1).
 * Enqueued with a 20-minute delay when reserveForOrder is called with
 * reference_type = 'cart'. On fire, checks if the cart is still unpaid
 * and releases the stock reservation if so.
 */

"use strict";

const { logger } = require("../../config/logger");
const stockService = require("../../modules/stock/stock.service");
const { transaction } = require("../../config/database");

async function processCartTtl(job) {
  const { brand, variant_id, location_id, quantity, reference_id } = job.data;

  try {
    await transaction(async (client) => {
      await stockService.releaseReservation({
        client,
        brand,
        variant_id,
        location_id,
        quantity,
        reference_id,
        user_id: null,
        reason: "cart TTL expired (20-min auto-release)",
      });
    });
    logger.info(
      { brand, reference_id, variant_id },
      "cart reservation released (TTL expired)",
    );
  } catch (err) {
    if (err.code === "INSUFFICIENT_STOCK" || err.code === "23514") {
      logger.info(
        { brand, reference_id },
        "cart reservation already released or deducted",
      );
      return;
    }
    throw err;
  }
}

module.exports = { processCartTtl };
