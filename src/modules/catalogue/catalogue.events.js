/**
 * Catalogue (V2.2 §6.4 / §6.9) — domain events.
 * `variant.created` is consumed by Stock to seed a stock_levels row (SSOT).
 */

"use strict";

const { createModuleEvents } = require("../../shared/events/module-events");

module.exports = createModuleEvents("catalogue");
