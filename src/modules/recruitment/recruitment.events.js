/**
 * Recruitment (HR & Staff → Recruitment) — domain events.
 *
 * Emitted by the service layer: offer_drafted, offer_redrafted, offer_sent,
 * offer_contracted, offer_provisioned. Socket.io / audit / AI insights may
 * subscribe. Payloads stay small (ids + brand); subscribers re-query if needed.
 */

"use strict";

const { createModuleEvents } = require("../../shared/events/module-events");

module.exports = createModuleEvents("recruitment");
