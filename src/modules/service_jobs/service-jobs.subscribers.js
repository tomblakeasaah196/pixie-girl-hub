/**
 * Service-jobs subscribers (G-1) — open a styling service job when an order
 * commits to production:
 *   • `order.deposit_met` — deposit-triggered order clears its deposit.
 *   • `order.paid`        — fully-paid order (no deposit gate); the common path
 *                           for storefront + walk-in campaigns.
 * Durable + POST-COMMIT via the transactional outbox (H-2). Best-effort +
 * idempotent (createForOrder checks serviceJobExistsForOrder and no-ops if a
 * job exists or the order has no styling/service line), so at-least-once
 * redelivery is safe and the two subscribers never double-open.
 *
 * Registered in the worker (the outbox dispatcher) — see src/jobs/worker.js —
 * and harmlessly in the web process via service-jobs.routes.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const salesRepo = require("../sales/sales.repo");
const service = require("./service-jobs.service");
const { logger } = require("../../config/logger");

let registered = false;

async function openJobForOrder(payload) {
  const { brand, order_id } = payload || {};
  if (!brand || !order_id) return;
  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order) return;
  await service.createForOrder({ brand, order });
}

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.deposit_met", "service-job-open", openJobForOrder);
  outbox.register("order.paid", "service-job-open", openJobForOrder);
  logger.info(
    "service_jobs subscribers registered (outbox order.deposit_met + order.paid → service job)",
  );
}

register();

module.exports = { register };
