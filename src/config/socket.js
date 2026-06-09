/**
 * Socket.io setup with Redis adapter for horizontal scaling.
 *
 * Rooms (per V2.2 spec real-time needs):
 *   brand:{valid brand key}:stock
 *   brand:{valid brand key}:deliveries
 *   brand:{valid brand key}:service_jobs
 *   brand:{valid brand key}:pos_session:{id}
 *   brand:{valid brand key}:campaign:{id}
 *   brand:{valid brand key}:order_timeline:{token}
 *   user:{uuid}:notifications
 *   user:{uuid}:ai_pending
 *   system:ai_usage_meter
 *
 * See src/realtime/rooms.js for the canonical list.
 */

"use strict";

const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const { config } = require("./env");
const { logger } = require("./logger");
const { getPublisher, getSubscriber } = require("./redis");
const { authenticateSocket } = require("../realtime/socket-auth");
const { bindHandlers } = require("../realtime/handlers");

let io = null;

async function initSocketIo(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: config.CORS_ORIGINS.split(",").filter(Boolean),
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingInterval: 25_000,
    pingTimeout: 60_000,
  });

  // Horizontal-scale adapter
  const pub = getPublisher();
  const sub = getSubscriber();
  io.adapter(createAdapter(pub, sub));

  // Auth middleware — verify JWT before allowing room joins
  io.use(authenticateSocket);

  // Bind handlers (room join/leave + module-specific event emitters)
  bindHandlers(io);

  // Register module realtime relays (lazy require to avoid an init cycle)
  const { registerCampaignRealtime } = require("../realtime/campaign-realtime");
  registerCampaignRealtime();

  const { registerWorkflowRealtime } = require("../realtime/workflow-realtime");
  registerWorkflowRealtime();

  logger.info("socket.io initialised with redis adapter");
  return io;
}

function getIo() {
  if (!io) throw new Error("socket.io not initialised");
  return io;
}

async function closeSocketIo() {
  if (io) {
    await io.close();
    io = null;
  }
}

module.exports = { initSocketIo, getIo, closeSocketIo };
