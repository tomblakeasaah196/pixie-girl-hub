/**
 * POS reconciliation domain events. Feeds the notification fan-out
 * (pos.subscribers.js) plus the audit/AI/realtime `*` channel.
 */

"use strict";

const { createModuleEvents } = require("../../shared/events/module-events");

module.exports = createModuleEvents("pos");
