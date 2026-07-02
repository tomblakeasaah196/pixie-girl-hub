/**
 * Process-agnostic Socket.io broadcaster.
 *
 * The realtime relays and notification emitters used to call `getIo()`
 * directly and swallow the "socket.io not initialised" error — which meant
 * every domain event raised in the DEDICATED WORKER process (outbox
 * consumers, cron sweeps: order paid, stock moved, workflow advanced)
 * produced NO client update in the split-process deployment, while the same
 * code worked in dev where workers run in-process. The worst kind of seam.
 *
 * `getBroadcaster()` closes it:
 *   - API process (Socket.io server initialised): returns the live server —
 *     behaviour identical to before.
 *   - Worker / any server-less process: returns a lazily-created
 *     @socket.io/redis-emitter Emitter that PUBLISHes through the same Redis
 *     channels the API's redis-adapter already subscribes to, so
 *     `.to(room).emit(...)` reaches every connected client on every API
 *     instance.
 *
 * Both objects support the broadcast surface the codebase uses
 * (`.emit(...)` and `.to(room).emit(...)`). Server-only APIs (`io.use`,
 * `io.on("connection")`) must keep using config/socket.getIo().
 *
 * Throws only when Redis itself is unavailable (tests/scripts without
 * initRedis) — callers keep their existing try/catch for that case.
 */

"use strict";

const { Emitter } = require("@socket.io/redis-emitter");
const { getIo } = require("../config/socket");
const { getPublisher } = require("../config/redis");

let redisEmitter = null;

function getBroadcaster() {
  try {
    return getIo();
  } catch {
    // No Socket.io server in this process — publish via Redis instead.
    // The publisher connection is PUBLISH-only, safe to share with the
    // socket.io adapter that owns it.
    if (!redisEmitter) redisEmitter = new Emitter(getPublisher());
    return redisEmitter;
  }
}

module.exports = { getBroadcaster };
