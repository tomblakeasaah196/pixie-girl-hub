/**
 * WhatsApp Calls (V2.2 §6.17 — Cloud API Calling)
 * Domain events emitted by the service layer.
 *
 * Subscribers: calls.realtime (Socket.io fanout to the ringing agents).
 * Payloads stay small (ids + display fields the ring toast needs) —
 * anything heavier is re-queried by the client.
 */

"use strict";

const { createModuleEvents } = require("../../shared/events/module-events");

module.exports = createModuleEvents("calls");
