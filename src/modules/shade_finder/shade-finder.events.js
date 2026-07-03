/**
 * Shade Finder (Praxis Shade Match)
 * Domain events emitted by the service layer.
 *
 * These feed the public Socket.io namespace (src/realtime/shade-finder-
 * realtime.js) so the storefront chat shows live "Praxis is thinking…"
 * stages while the pipeline runs. Payloads are small (session id + brand +
 * stage/result); the HTTP response remains the source of truth, the socket
 * is progressive enhancement.
 */

"use strict";

const { createModuleEvents } = require("../../shared/events/module-events");

module.exports = createModuleEvents("shade_finder");
