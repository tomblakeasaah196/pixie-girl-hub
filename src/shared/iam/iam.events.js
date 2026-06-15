/**
 * IAM & Security domain events. Emitted after every IAM mutation so
 * connected clients (Socket.IO) refresh their security dashboards and
 * session lists in real time.
 */

"use strict";

const { EventEmitter } = require("events");
const { logger } = require("../../config/logger");

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

function emit(eventType, payload) {
  const fullType = `iam.${eventType}`;
  try {
    emitter.emit(fullType, payload);
    emitter.emit("*", { type: fullType, payload });
  } catch (err) {
    logger.error({ err, eventType: fullType }, "iam event emit failed");
  }
}

function on(eventType, handler) {
  emitter.on(`iam.${eventType}`, handler);
}

/**
 * Notify all clients on a brand channel that IAM data changed (user
 * provisioned, deactivated, review created, etc.).
 */
function emitIamUpdated(io, business) {
  if (!io) return;
  io.to(`brand:${business}`).emit("iam:updated", {
    ts: new Date().toISOString(),
  });
}

/**
 * Notify a specific user that one or more of their sessions were revoked
 * so the client can redirect to login.
 */
function emitSessionRevoked(io, userId) {
  if (!io) return;
  io.to(`user:${userId}`).emit("session:revoked", {
    ts: new Date().toISOString(),
  });
}

module.exports = { emit, on, emitter, emitIamUpdated, emitSessionRevoked };
