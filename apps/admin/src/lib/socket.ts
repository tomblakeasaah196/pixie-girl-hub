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
    auth: (cb: (data: Record<string, string>) => void) =>
      cb({ token: getAccessToken() ?? "" }),
  });

  // Forward socket events as window CustomEvents so components can subscribe
  // without importing the socket directly (avoids tight coupling).
  socket.on("notification:new", (detail) => {
    window.dispatchEvent(new CustomEvent("pgh:notification:new", { detail }));
  });
  // Notifications consumed elsewhere (thread opened → its message
  // notifications auto-read; another tab hit "All read") — the bell badge
  // and toast stack drop everywhere without waiting for the next poll.
  socket.on("notification:read", (detail) => {
    window.dispatchEvent(new CustomEvent("pgh:notification:read", { detail }));
  });
  // Praxis pending-action pushes (user:{id}:ai_pending — §6.29 confirm gate).
  socket.on("ai_pending:created", (detail) => {
    window.dispatchEvent(new CustomEvent("pgh:ai_pending:created", { detail }));
  });
  socket.on("ai_pending:resolved", (detail) => {
    window.dispatchEvent(
      new CustomEvent("pgh:ai_pending:resolved", { detail }),
    );
  });
  // AI insight changes (brand:{brand}:insights — §6.30 event-triggered alerts).
  socket.on("insights:changed", (detail) => {
    window.dispatchEvent(new CustomEvent("pgh:insights:changed", { detail }));
  });
  // Chief of Staff — follow-up + goal-health pushes (user:{id}:goals, PR4).
  for (const evt of [
    "cos_followup:created",
    "cos_followup:updated",
    "cos_followup:resolved",
    "cos_goal:health",
  ]) {
    socket.on(evt, (detail) => {
      window.dispatchEvent(new CustomEvent("pgh:cos:changed", { detail }));
    });
  }
  // Chief of Staff — live turn progress (user:{id}:goals, PR2-D). Kept separate
  // from the invalidation family: it drives the chat's "thinking" status line.
  socket.on("cos_turn:progress", (detail) => {
    window.dispatchEvent(new CustomEvent("pgh:cos_turn:progress", { detail }));
  });
  // Chief of Staff — batch-plan finished on the worker (PR3). Dedicated event
  // so the conversation (plan card) refetch doesn't piggyback on every
  // follow-up signal.
  socket.on("cos_plan:executed", (detail) => {
    window.dispatchEvent(new CustomEvent("pgh:cos_plan:executed", { detail }));
  });
  // Live attendance punch (brand:{brand}:attendance — device binding 000304).
  socket.on("attendance:punch", (detail) => {
    window.dispatchEvent(new CustomEvent("pgh:attendance:punch", { detail }));
  });
  // Device enrol/remove/flag (brand:{brand}:hr_devices).
  socket.on("device:changed", (detail) => {
    window.dispatchEvent(new CustomEvent("pgh:device:changed", { detail }));
  });
  // WhatsApp voice calls (brand:{brand}:calls + user:{id}:calls) — the
  // CallLayer subscribes to these to ring, stop ringing, and settle.
  for (const evt of [
    "call:ringing",
    "call:claimed",
    "call:ended",
    "call:outcome_recorded",
  ]) {
    socket.on(evt, (detail) => {
      window.dispatchEvent(new CustomEvent(`pgh:${evt}`, { detail }));
    });
  }

  // Stock / Sales / Service-jobs lifecycle signals. These fan out many thin
  // sub-events (stock:moved, sales:order.paid, service_jobs:completed, …); we
  // re-dispatch each family as ONE window event the invalidation hook listens
  // to, so this file stays stable as new server-side sub-events are added.
  socket.onAny((event: string, detail: unknown) => {
    if (
      event.startsWith("stock:") ||
      event.startsWith("sales:") ||
      event.startsWith("service_jobs:")
    ) {
      const [domain] = event.split(":");
      window.dispatchEvent(
        new CustomEvent(`pgh:${domain}:changed`, {
          detail: { event, ...(detail as Record<string, unknown>) },
        }),
      );
    }
  });

  return socket;
}

/** Canonical room helpers (mirror of src/realtime/rooms.js). */
export const rooms = {
  stock: (brand: string) => `brand:${brand}:stock`,
  sales: (brand: string) => `brand:${brand}:sales`,
  serviceJobs: (brand: string) => `brand:${brand}:service_jobs`,
  notifications: (userId: string) => `user:${userId}:notifications`,
  userMessages: (userId: string) => `user:${userId}:messages`,
  channel: (channelId: string) => `channel:${channelId}`,
  channelTyping: (channelId: string) => `channel:${channelId}:typing`,
  brandSmartcomm: (brand: string) => `brand:${brand}:smartcomm`,
  brandCalls: (brand: string) => `brand:${brand}:calls`,
  userCalls: (userId: string) => `user:${userId}:calls`,
  userAiPending: (userId: string) => `user:${userId}:ai_pending`,
  userGoals: (userId: string) => `user:${userId}:goals`,
  insights: (brand: string) => `brand:${brand}:insights`,
  attendance: (brand: string) => `brand:${brand}:attendance`,
  hrDevices: (brand: string) => `brand:${brand}:hr_devices`,
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
