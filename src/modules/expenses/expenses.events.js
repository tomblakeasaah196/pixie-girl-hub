/**
 * Expense Management (V2.2 §6.7) — domain events.
 */

"use strict";

const { createModuleEvents } = require("../../shared/events/module-events");

module.exports = createModuleEvents("expenses");
