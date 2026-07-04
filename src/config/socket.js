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

  // PUBLIC namespace — storefront guests (no staff JWT). Auth is a signed
  // guest token (currently the Shade Finder session token); on connect the
  // socket is locked into exactly its own session room — there is no
  // generic 'join' verb to probe. Shares the Redis adapter with the main
  // namespace, so worker-side emits fan out the same way.
  const publicNs = io.of("/public");
  publicNs.use((socket, next) => {
    const {
      verifyGuestToken,
    } = require("../modules/shade_finder/shade-finder.service");
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    const payload = token && verifyGuestToken(token);
    if (!payload) return next(new Error("AUTH_REQUIRED"));
    socket.data.shadeSession = { sid: payload.sid, brand: payload.brand };
    return next();
  });
  publicNs.on("connection", (socket) => {
    const { ROOMS } = require("../realtime/rooms");
    const { sid, brand } = socket.data.shadeSession;
    socket.join(ROOMS.shade_session(brand, sid));
    socket.emit("joined", { room: ROOMS.shade_session(brand, sid) });
  });

  // Register module realtime relays (lazy require to avoid an init cycle)
  const { registerCampaignRealtime } = require("../realtime/campaign-realtime");
  registerCampaignRealtime();

  const { registerWorkflowRealtime } = require("../realtime/workflow-realtime");
  registerWorkflowRealtime();

  const { registerStockRealtime } = require("../realtime/stock-realtime");
  registerStockRealtime();

  const { registerPraxisRealtime } = require("../realtime/praxis-realtime");
  registerPraxisRealtime();

  const {
    registerInsightsRealtime,
  } = require("../realtime/insights-realtime");
  registerInsightsRealtime();

  const {
    registerShadeFinderRealtime,
  } = require("../realtime/shade-finder-realtime");
  registerShadeFinderRealtime();

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
