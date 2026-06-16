/**
 * Socket.io client (canon §5 real-time).
 *
 * A single shared connection authenticated with the in-memory access token
 * (handshake `auth.token`, matching the server's socket-auth). Rooms follow
 * the canonical names in src/realtime/rooms.js — the frontend mirror lives
 * here. Consumers `join` a room and listen for events; the connection is
 * lazily created and reused across the app.
 *
 * Token freshness: `auth` is a function so every (re)connect picks up the
 * latest access token after a silent refresh, without us tearing the socket
 * down.
 */

import { io, type Socket } from "socket.io-client";
import { getAccessToken } from "@/lib/api";

// Same-origin by default (the API + socket server share the host). An
// explicit URL can be supplied for split deploys.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL as string | undefined;

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(SOCKET_URL ?? "/", {
    autoConnect: true,
    transports: ["websocket", "polling"],
    withCredentials: true,
    auth: (cb: (data: Record<string, string>) => void) => cb({ token: getAccessToken() ?? "" }),
  });

  // Forward socket events as window CustomEvents so components can subscribe
  // without importing the socket directly (avoids tight coupling).
  socket.on("notification:new", (detail) => {
    window.dispatchEvent(new CustomEvent("pgh:notification:new", { detail }));
  });

  return socket;
}

/** Canonical room helpers (mirror of src/realtime/rooms.js). */
export const rooms = {
  stock: (brand: string) => `brand:${brand}:stock`,
  notifications: (userId: string) => `user:${userId}:notifications`,
  userMessages: (userId: string) => `user:${userId}:messages`,
  channel: (channelId: string) => `channel:${channelId}`,
  channelTyping: (channelId: string) => `channel:${channelId}:typing`,
  brandSmartcomm: (brand: string) => `brand:${brand}:smartcomm`,
};

/** Join a Socket.io room (idempotent on the server). */
export function joinRoom(room: string) {
  const s = getSocket();
  if (!s.connected) {
    s.once("connect", () => s.emit("join", { room }));
  } else {
    s.emit("join", { room });
  }
}

export function leaveRoom(room: string) {
  const s = getSocket();
  if (s.connected) s.emit("leave", { room });
}

/** Smartcomm — ping the server we're typing in a channel. */
export function emitTyping(channelId: string) {
  const s = getSocket();
  if (s.connected) s.emit("typing", { channel_id: channelId });
}
