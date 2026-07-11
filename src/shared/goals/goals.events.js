/**
 * Goals (Chief of Staff, PR1) — domain events emitted by the service layer.
 *
 * Feeds Socket.io real-time (via realtime relays), the audit log (written
 * separately by the service), and — from PR4 — the CoS risk engine and
 * accountability scheduler. Payloads stay thin (IDs + brand); subscribers
 * re-query for detail. Soft, in-process events (see module-events.js).
 */

"use strict";

const { createModuleEvents } = require("../events/module-events");

module.exports = createModuleEvents("goals");
