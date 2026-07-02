/**
 * Sales (V2.2 §6.2) — domain events.
 * `order.paid` is the cross-module trigger consumed by Invoicing (raise
 * invoice) and Accounting (post revenue journal entry).
 */

"use strict";

const { createModuleEvents } = require("../../shared/events/module-events");

module.exports = createModuleEvents("sales");
