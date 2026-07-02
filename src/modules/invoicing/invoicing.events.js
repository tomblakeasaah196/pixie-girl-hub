/**
 * Invoicing & Billing (V2.2 §6.5) — domain events.
 */

"use strict";

const { createModuleEvents } = require("../../shared/events/module-events");

module.exports = createModuleEvents("invoicing");
