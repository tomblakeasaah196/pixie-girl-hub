/**
 * Sales real-time relay.
 *
 * Subscribes to sales domain events and broadcasts thin signals into the
 * canonical room brand:{brand}:sales. Per ARCHITECTURE.md, modules emit domain
 * events; this relay (not the service) talks to Socket.io. Registered once
 * during socket init.
 *
 * Consumers (the Sales board, the order detail drawer, KPI tiles) treat these
 * as a *signal* to re-read — payloads carry only IDs + what changed, never
 * money or customer PII, so nothing sensitive crosses the wire. Anything
 * financial still flows through the transactional outbox, not this emitter.
 */

"use strict";

const events = require("../modules/sales/sales.events");
const { ROOMS } = require("./rooms");
const { getBroadcaster } = require("./emitter");
const { logger } = require("../config/logger");

function emitToBrand(brand, channel, payload) {
  if (!brand) return;
  try {
    getBroadcaster().to(ROOMS.sales(brand)).emit(channel, payload);
  } catch (err) {
    // Redis unavailable (tests/scripts without initRedis).
    logger.debug({ err: err.message }, "sales realtime emit skipped");
  }
}

let registered = false;

function registerSalesRealtime() {
  // Idempotent: socket init (API) and startWorkers (worker/in-process dev)
  // may both call this; the second call must not duplicate emissions.
  if (registered) return;
  registered = true;

  // Order lifecycle — each shifts what the Sales board / KPI tiles show.
  const orderEvents = [
    "order.created",
    "order.updated",
    "order.deposit_met",
    "order.payment",
    "order.paid",
    "order.cancelled",
  ];
  for (const evt of orderEvents) {
    events.on(evt, ({ brand, order_id, id }) =>
      emitToBrand(brand, `sales:${evt}`, { order_id: order_id || id }),
    );
  }

  // Quotation lifecycle — the Quotations tab re-reads on these.
  const quotationEvents = [
    "quotation.created",
    "quotation.sent",
    "quotation.converted",
  ];
  for (const evt of quotationEvents) {
    events.on(evt, ({ brand, quotation_id, id }) =>
      emitToBrand(brand, `sales:${evt}`, { quotation_id: quotation_id || id }),
    );
  }

  // Cancellation review queue.
  for (const evt of ["cancellation.requested", "cancellation.reviewed"]) {
    events.on(evt, ({ brand, request_id, id, status }) =>
      emitToBrand(brand, `sales:${evt}`, {
        request_id: request_id || id,
        ...(status ? { status } : {}),
      }),
    );
  }

  logger.info("sales realtime relay registered");
}

module.exports = { registerSalesRealtime };
