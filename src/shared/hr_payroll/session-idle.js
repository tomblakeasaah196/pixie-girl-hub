/**
 * Server-side idle-session enforcement — forced re-login after inactivity.
 *
 * Every login mints a session id (`sid`) carried inside both the access and
 * refresh JWTs (stable across refresh rotations). A redis key
 * `session:idle:{sid}` — value user_id, TTL SESSION_IDLE_TIMEOUT_S — is the
 * liveness marker: proven user activity re-arms the TTL, and once it lapses
 * the session is dead everywhere at once (authMiddleware rejects still-valid
 * access tokens; /auth/refresh refuses to mint new ones AND revokes the
 * refresh jti so the cookie can never be replayed later).
 *
 * "Proven user activity" means a request carrying the X-User-Activity
 * header, which the admin app attaches only when a human touched the page
 * recently (see apps/admin/src/lib/activity.ts). Background traffic —
 * TanStack refetches, dashboards left open, silent token refreshes — does
 * NOT re-arm the window; an abandoned tab keeps polling until the window
 * lapses, then locks.
 *
 * Fail-closed by design: if redis is unreachable these helpers throw and
 * the request fails. Refresh-token revocation already lives in the same
 * redis, so this adds no new failure domain.
 */

"use strict";

const { config } = require("../../config/env");

const PREFIX = "session:idle:";
const key = (sid) => PREFIX + sid;

/** Arm the idle window for a new session at login. */
async function seed(redis, sid, userId) {
  await redis.set(
    key(sid),
    String(userId),
    "EX",
    config.SESSION_IDLE_TIMEOUT_S,
  );
}

/**
 * Re-arm the idle window (proven user activity). Returns true if the
 * session was still alive, false if the window had already lapsed —
 * EXPIRE on a missing key is a no-op returning 0, so a dead session can
 * never be revived by touching it.
 */
async function touch(redis, sid) {
  const armed = await redis.expire(key(sid), config.SESSION_IDLE_TIMEOUT_S);
  return armed === 1;
}

/** Whether the session's idle window is still open (no re-arm). */
async function isAlive(redis, sid) {
  const found = await redis.exists(key(sid));
  return found === 1;
}

/** Kill one session's idle marker (logout / idle-expiry cleanup). */
async function kill(redis, sid) {
  await redis.del(key(sid));
}

/**
 * Kill every idle marker belonging to a user (password reset / revoke-all).
 * Mirrors auth.service#revokeAllSessions' SCAN approach — internal-tool
 * scale keeps the keyspace small, and this stays off the hot path.
 */
async function killAllForUser(redis, userId) {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${PREFIX}*`,
      "COUNT",
      200,
    );
    cursor = next;
    if (keys.length) {
      const vals = await redis.mget(keys);
      const toDel = keys.filter((_, i) => vals[i] === String(userId));
      if (toDel.length) await redis.del(...toDel);
    }
  } while (cursor !== "0");
}

module.exports = { seed, touch, isAlive, kill, killAllForUser };
