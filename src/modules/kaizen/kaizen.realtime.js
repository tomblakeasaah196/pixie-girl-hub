/**
 * Kaizen realtime — a dedicated Socket.io namespace ('/kaizen') authorised by
 * the KAIZEN operator JWT (NOT the platform auth). Operators join one room,
 * 'ops', and receive push events (new criticals, backup progress/done, alerts).
 *
 * initKaizenRealtime(io) is called once from src/config/socket.js after the
 * other namespaces are set up. emitKaizen() is a safe no-op if the socket layer
 * isn't up (e.g. from the worker process, which has no io) — the alert row still
 * persists and email still sends.
 *
 * See guide §7.9.
 */

"use strict";

const { logger } = require("../../config/logger");
const authService = require("./auth/kaizen-auth.service");

const NAMESPACE = "/kaizen";
const ROOM = "ops";

function initKaizenRealtime(io) {
  const ns = io.of(NAMESPACE);

  // Verify the Kaizen access token from the handshake. A platform token can
  // never satisfy this (different secret + aud:"kaizen").
  ns.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        "";
      const payload = authService.verifyAccessToken(String(token).replace(/^Bearer\s+/i, ""));
      socket.data.operatorId = payload.sub;
      return next();
    } catch {
      return next(new Error("KAIZEN_SOCKET_UNAUTHORIZED"));
    }
  });

  ns.on("connection", (socket) => {
    socket.join(ROOM);
    socket.emit("joined", { room: ROOM });
  });

  logger.info("kaizen realtime namespace ready (/kaizen)");
}

/** Emit to the ops room. Safe no-op if io isn't available in this process. */
function emitKaizen(event, payload) {
  try {
    const { getIo } = require("../../config/socket");
    const io = getIo();
    if (!io) return;
    io.of(NAMESPACE).to(ROOM).emit(event, payload);
  } catch {
    /* socket layer not up in this process */
  }
}

module.exports = { initKaizenRealtime, emitKaizen, NAMESPACE, ROOM };
