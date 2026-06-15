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
  return socket;
}

/** Canonical room helpers (mirror of src/realtime/rooms.js). */
export const rooms = {
  stock: (brand: string) => `brand:${brand}:stock`,
};
