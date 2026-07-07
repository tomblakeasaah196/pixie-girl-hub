/**
 * Kaizen domain events — a single in-process EventEmitter that services emit to
 * and that later subscribers (Socket.io realtime in §7.9, alert rules in §7.8)
 * listen on. Keeping this indirection now means services never import the
 * socket/alert layers directly (matching the app convention: services emit
 * domain events; controllers/subscribers translate them).
 *
 * Phase 1 emits error events. Later phases add backup/health/alert events.
 * Emitters must never throw into the caller, so subscribers are wrapped.
 */

"use strict";

const { EventEmitter } = require("events");
const { logger } = require("../../config/logger");

const bus = new EventEmitter();
bus.setMaxListeners(50);

// Known event names (documentation + typo-guard).
const EVENTS = {
  ERROR_CAPTURED: "error.captured",
  ERROR_GROUP_NEW: "error.group_new",
  ERROR_GROUP_REOPENED: "error.group_reopened",
};

/** Emit without ever letting a listener error bubble into the emitter. */
function emit(event, payload) {
  try {
    bus.emit(event, payload);
  } catch (err) {
    logger.warn({ err: err.message, event }, "kaizen event emit failed");
  }
}

module.exports = { bus, EVENTS, emit };
