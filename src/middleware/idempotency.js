/**
 * Idempotency middleware (header-gated).
 *
 * A no-op UNLESS the request carries an `Idempotency-Key` header on an unsafe
 * method — so it's invisible to the whole app except the callers that opt in.
 * The Chief-of-Staff plan executor sends a deterministic key per step
 * (`<plan_id>:<plan_step>`), so a retried step — or a background BullMQ retry
 * (PR3) — replays the first success instead of creating a duplicate record.
 *
 * Reserve-then-store (not just cache-after-success): the key is CLAIMED in
 * Redis before the handler runs, and the stored result overwrites the claim on
 * a 2xx. That way, even if the very first attempt created the record but its
 * response was lost (the crash window a plain response-cache can't cover), the
 * retry replays rather than re-creating. Fails OPEN on any Redis hiccup — an
 * idempotency layer must never take down a write path.
 *
 * Scope: keyed by user + method + path + client key, so a key can't be replayed
 * across users or endpoints. TTL matches the 24h plan-approval window.
 */

"use strict";

const crypto = require("crypto");
const { getClient } = require("../config/redis");
const { logger } = require("../config/logger");

const HEADER = "idempotency-key";
const PREFIX = "idem:";
const RESULT_TTL_SECONDS = 24 * 60 * 60; // 24h — matches plan expiry
const CLAIM_TTL_SECONDS = 120; // an in-flight claim self-heals if a handler dies
const PENDING = "__pending__";
const GUARDED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function cacheKey(req, clientKey) {
  const user = (req.user && req.user.user_id) || "anon";
  const path = `${req.baseUrl || ""}${req.path}`;
  const raw = `${user}|${req.method}|${path}|${clientKey}`;
  return PREFIX + crypto.createHash("sha256").update(raw).digest("hex");
}

async function idempotencyMiddleware(req, res, next) {
  const rawKey = req.headers[HEADER];
  if (!rawKey || !GUARDED_METHODS.has(req.method)) return next();

  let redis;
  try {
    redis = getClient();
  } catch {
    return next(); // no Redis → fail open
  }
  const key = cacheKey(req, String(rawKey).slice(0, 200));

  // Try to claim the key. NX fails when a result (or in-flight claim) exists.
  let claimed;
  try {
    claimed = await redis.set(key, PENDING, "NX", "EX", CLAIM_TTL_SECONDS);
  } catch (err) {
    logger.debug({ err: err.message }, "idempotency: claim failed — proceeding");
    return next(); // fail open
  }

  if (!claimed) {
    // Key already exists: a stored result → replay it; still pending → let it
    // run (sequential CoS execution makes a true collision unlikely, and a
    // duplicate is better than a deadlock).
    try {
      const existing = await redis.get(key);
      if (existing && existing !== PENDING) {
        const { status, body } = JSON.parse(existing);
        res.setHeader("Idempotency-Replayed", "true");
        return res.status(status).json(body);
      }
    } catch (err) {
      logger.debug({ err: err.message }, "idempotency: replay read failed — proceeding");
    }
    return next();
  }

  // We hold the claim. Capture the JSON body, then on response finish either
  // store the success (so a retry replays) or release the claim (so a retry
  // may legitimately run again).
  let capturedBody;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    capturedBody = body;
    return originalJson(body);
  };
  res.on("finish", () => {
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    if (ok && capturedBody !== undefined) {
      redis
        .set(key, JSON.stringify({ status: res.statusCode, body: capturedBody }), "EX", RESULT_TTL_SECONDS)
        .catch((err) => logger.debug({ err: err.message }, "idempotency: store failed"));
    } else {
      redis.del(key).catch((err) => logger.debug({ err: err.message }, "idempotency: release failed"));
    }
  });
  return next();
}

module.exports = { idempotencyMiddleware, cacheKey };
