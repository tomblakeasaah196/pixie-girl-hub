/**
 * Access (RBAC admin) domain events. Mirrors the module event pattern:
 * small payloads (IDs + brand), subscribers re-query for detail. These feed
 * real-time access-change notices and the audit trail's extra context.
 */

"use strict";

const { createModuleEvents } = require("../events/module-events");

module.exports = createModuleEvents("access");
