/**
 * Customer Onboarding — domain events.
 * `submission.completed` is the cross-module trigger consumed by the
 * realtime relay so a staff screen watching a specific capture link (Quick
 * Sale's QR code) can auto-select the resulting contact.
 */

"use strict";

const { createModuleEvents } = require("../../shared/events/module-events");

module.exports = createModuleEvents("customer_onboarding");
