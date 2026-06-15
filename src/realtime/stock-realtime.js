/**
 * Stock real-time relay.
 *
 * Subscribes to stock domain events and broadcasts them into the canonical
 * room brand:{brand}:stock. Per ARCHITECTURE.md, modules emit domain events;
 * this relay (not the service) talks to Socket.io. Registered once during
 * socket init.
 *
 * Consumers (e.g. the Catalogue availability pill) treat these as a *signal*
 * to re-read availability — payloads are intentionally thin (no cost, no
 * supplier; just what changed) so nothing sensitive crosses the wire.
 */

"use strict";

const events = require("../modules/stock/stock.events");
const { ROOMS } = require("./rooms");
const { getIo } = require("../config/socket");
const { logger } = require("../config/logger");

function emitToBrand(brand, channel, payload) {
  if (!brand) return;
  try {
    getIo().to(ROOMS.stock(brand)).emit(channel, payload);
  } catch (err) {
    // Socket.io may not be initialised (worker process / tests).
    logger.debug({ err: err.message }, "stock realtime emit skipped");
  }
}

function registerStockRealtime() {
  // A movement is the finest-grained change; carry the variant/location so a
  // client can decide whether the change is relevant to what it's showing.
  events.on("moved", ({ brand, variant_id, location_id, movement_type, quantity }) =>
    emitToBrand(brand, "stock:moved", {
      variant_id,
      location_id,
      movement_type,
      quantity,
    }),
  );

  // Coarser posted/received transitions also shift available counts.
  for (const evt of [
    "adjustment.posted",
    "transfer.received",
    "shipment.received",
  ]) {
    events.on(evt, ({ brand, id }) =>
      emitToBrand(brand, `stock:${evt}`, { id }),
    );
  }

  logger.info("stock realtime relay registered");
}

module.exports = { registerStockRealtime };
