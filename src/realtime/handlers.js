/**
 * Socket.io connection lifecycle + room subscription.
 *
 * Client emits:
 *   'join'     { room: string }
 *   'leave'    { room: string }
 *   'typing'   { channel_id: string }            — smartcomm typing ping
 *
 * Server emits events INTO rooms via the service layer (events.js files
 * in each module). Direct emit from a controller is discouraged — emit
 * via the module's events.js so other subscribers (AI insights, audit)
 * can also react.
 */

"use strict";

const { logger } = require("../config/logger");

/** Sync gate covering the cheap room shapes. */
function syncRoomVerdict(socket, room) {
  if (!room || typeof room !== "string") return "deny";
  const user = socket.user;
  if (!user) return "deny";

  if (user.is_ceo) return "allow";
  if (room.startsWith(`user:${user.user_id}:`)) return "allow";

  const brandMatch = room.match(/^brand:([a-z_]+):/);
  if (brandMatch) {
    return user.available_businesses.includes(brandMatch[1]) ? "allow" : "deny";
  }

  // channel:<uuid>[:typing] — async DB check below.
  const channelMatch = room.match(/^channel:([0-9a-f-]{36})(?::typing)?$/);
  if (channelMatch) return { defer: channelMatch[1] };

  return "deny";
}

let _query;
function getQuery() {
  if (!_query) _query = require("../config/database").query;
  return _query;
}

async function isChannelMember(user, channelId) {
  try {
    const { rows } = await getQuery()(
      `SELECT 1 FROM shared.channel_members
        WHERE channel_id = $1 AND user_id = $2 LIMIT 1`,
      [channelId, user.user_id],
    );
    return rows.length > 0;
  } catch (err) {
    logger.warn(
      { err: err.message, channelId },
      "channel membership check failed",
    );
    return false;
  }
}

function bindHandlers(io) {
  io.on("connection", (socket) => {
    logger.debug(
      { socketId: socket.id, userId: socket.user?.user_id },
      "socket connected",
    );

    // Every authenticated user auto-joins their own message inbox room so
    // we can fan unread-count + new-message pings to them without a
    // round-trip 'join'.
    if (socket.user?.user_id) {
      socket.join(`user:${socket.user.user_id}:messages`);
      socket.join(`user:${socket.user.user_id}:notifications`);
    }

    socket.on("join", async ({ room }) => {
      const verdict = syncRoomVerdict(socket, room);
      if (verdict === "allow") {
        socket.join(room);
        return socket.emit("joined", { room });
      }
      if (verdict === "deny") {
        return socket.emit("error", { code: "ROOM_FORBIDDEN", room });
      }
      // Deferred: smartcomm channel membership check
      const ok = await isChannelMember(socket.user, verdict.defer);
      if (!ok) return socket.emit("error", { code: "ROOM_FORBIDDEN", room });
      socket.join(room);
      socket.emit("joined", { room });
    });

    socket.on("leave", ({ room }) => {
      socket.leave(room);
      socket.emit("left", { room });
    });

    // Smartcomm typing — broadcast to the channel's typing room (everyone
    // in the conversation, except the typer). No persistence: a typing
    // ping is ephemeral by design.
    socket.on("typing", ({ channel_id }) => {
      if (!channel_id || typeof channel_id !== "string") return;
      const room = `channel:${channel_id}:typing`;
      socket.to(room).emit("typing", {
        channel_id,
        user_id: socket.user?.user_id,
        at: new Date().toISOString(),
      });
    });

    socket.on("disconnect", (reason) => {
      logger.debug({ socketId: socket.id, reason }, "socket disconnected");
    });
  });
}

module.exports = { bindHandlers };
