/**
 * Service-jobs subscriber (G-1) — when a deposit-triggered order clears its
 * deposit (`order.deposit_met`), open a styling service job so work begins.
 * Durable + POST-COMMIT via the transactional outbox (H-2). Best-effort +
 * idempotent (createForOrder no-ops if a job exists or the brand runs no service
 * types), so at-least-once redelivery is safe.
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

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.deposit_met", "service-job-open", async (payload) => {
    const { brand, order_id } = payload || {};
    if (!brand || !order_id) return;
    const order = await salesRepo.findById({ brand, id: order_id });
    if (!order) return;
    await service.createForOrder({ brand, order });
  });
  logger.info(
    "service_jobs subscribers registered (outbox order.deposit_met → service job)",
  );
}

register();

module.exports = { register };
