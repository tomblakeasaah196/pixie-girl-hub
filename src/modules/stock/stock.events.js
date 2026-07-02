/**
 * Stock (V2.2 §6.9) — domain events. `stock.moved` feeds realtime + low-stock.
 */

"use strict";

const { createModuleEvents } = require("../../shared/events/module-events");

module.exports = createModuleEvents("stock");
