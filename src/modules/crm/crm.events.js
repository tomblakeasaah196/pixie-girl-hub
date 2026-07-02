/**
 * CRM (V2.2 §6.1) — domain events. `deal.won` is consumed by Sales.
 */

"use strict";

const { createModuleEvents } = require("../../shared/events/module-events");

module.exports = createModuleEvents("crm");
