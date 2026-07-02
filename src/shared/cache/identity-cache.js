/**
 * Identity cache — Redis-backed read-through cache for the three lookups
 * every authenticated request performs before any handler runs:
 *
 *   1. the user row            (middleware/auth.js       → shared.users)
 *   2. the brand config row    (middleware/brand-context → shared.business_config)
 *   3. the permission grants   (middleware/rbac.js       → shared.permissions)
 *
 * Without this cache each request costs 3 pure-overhead DB round-trips.
 *
 * Correctness model — two independent bounds, whichever fires first:
 *   - TTL: every entry expires after IDENTITY_CACHE_TTL_S (default 30 s;
 *     0 disables the cache entirely — the escape hatch).
 *   - Event invalidation: the IAM / access / business-setup services already
 *     emit domain events on every relevant mutation; subscribers below DELETE
 *     the affected keys, so a deactivated user or a permission change takes
 *     effect on the next request, not after the TTL. Deletes go to the shared
 *     Redis, so every API instance sees them regardless of which process
 *     handled the write.
 *
 * Security note: the user entry is a PROJECTION of the auth-relevant fields —
 * password/PIN hashes are never written to Redis.
 *
 * Failure model: fail-open. Any Redis error (or Redis not yet initialised,
 * e.g. in scripts/tests) falls back to the DB loader, logged at warn once
 * per minute — a cache outage degrades latency, never availability.
 */

"use strict";

const { getClient } = require("../../config/redis");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const staffRepo = require("../hr_payroll/staff.repo");
const permissionsRepo = require("../org_workflow/permissions.repo");
const businessConfigRepo = require("../../modules/business_setup/business-config.repo");
const iamEvents = require("../iam/iam.events");
const accessEvents = require("../access/access.events");
const businessSetupEvents = require("../../modules/business_setup/business-setup.events");

const K = {
  user: (id) => `idc:user:v1:${id}`,
  grants: (roleIds, module, action) =>
    `idc:grants:v1:${module}:${action}:${[...roleIds].sort().join(",")}`,
  brand: (key) => `idc:brand:v1:${key}`,
};
const GRANTS_PATTERN = "idc:grants:v1:*";

const ttlSeconds = () => config.IDENTITY_CACHE_TTL_S;

// Rate-limit the fail-open warning so a Redis outage doesn't flood the log.
let lastWarnAt = 0;
function warnFailOpen(err, op) {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  logger.warn(
    { err: err.message, op },
    "identity cache unavailable — falling back to DB (fail-open)",
  );
}

function tryClient(op) {
  try {
    return getClient();
  } catch (err) {
    warnFailOpen(err, op);
    return null;
  }
}

/**
 * Read-through: return the cached JSON value under `key`, else run `loader`,
 * cache its result (including null — negative caching protects the DB from
 * repeated lookups of deleted users), and return it.
 */
async function getThrough(key, loader) {
  const ttl = ttlSeconds();
  if (!ttl || ttl <= 0) return loader();

  const redis = tryClient("get");
  if (!redis) return loader();

  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit);
  } catch (err) {
    warnFailOpen(err, "get");
    return loader();
  }

  const fresh = await loader();
  try {
    await redis.set(key, JSON.stringify(fresh ?? null), "EX", ttl);
  } catch (err) {
    warnFailOpen(err, "set");
  }
  return fresh;
}

async function del(...keys) {
  const redis = tryClient("del");
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch (err) {
    warnFailOpen(err, "del");
  }
}

/** Delete every cached grants entry (permission definitions changed). */
async function invalidateAllGrants() {
  const redis = tryClient("scan");
  if (!redis) return;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        GRANTS_PATTERN,
        "COUNT",
        200,
      );
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch (err) {
    warnFailOpen(err, "scan");
  }
}

// ── Public read-through getters ───────────────────────────

/**
 * Auth-shape user projection for the request pipeline. Same nullability and
 * `status` semantics as staff.repo.findById, minus the credential hashes
 * (never cached in Redis).
 */
async function getAuthUser(userId) {
  return getThrough(K.user(userId), async () => {
    const u = await staffRepo.findById(userId);
    if (!u) return null;
    return {
      user_id: u.user_id,
      email: u.email,
      display_name: u.display_name,
      status: u.status,
      is_ceo: u.is_ceo === true,
      default_business_key: u.default_business_key || null,
      role_ids: u.role_ids || [],
      available_businesses: u.available_businesses || [],
    };
  });
}

/** Grant rows for a role-set × module × action (empty array = denied). */
async function getGrants({ role_ids, module, action }) {
  if (!Array.isArray(role_ids) || role_ids.length === 0) return [];
  return getThrough(K.grants(role_ids, module, action), () =>
    permissionsRepo.findGrants({ role_ids, module, action }),
  );
}

/** Brand config row by business key (null when not configured). */
async function getBrandConfig(businessKey) {
  return getThrough(K.brand(businessKey), () =>
    businessConfigRepo.findByKey(businessKey),
  );
}

// ── Event-driven invalidation ─────────────────────────────
// The emitting services run in the API process; the DELs land in the shared
// Redis so every instance is invalidated. TTL remains the backstop for any
// mutation path that lacks an event (e.g. direct SQL, email-signature repo).

const USER_EVENTS = [
  "user_provisioned",
  "user_deactivated",
  "user_reactivated",
  "password_reset",
  "session_revoked",
];
const ACCESS_USER_EVENTS = ["role_granted", "role_revoked", "user_access_changed"];
const GRANTS_EVENTS = ["permissions_changed", "role_updated", "role_deleted"];

let subscribed = false;
function registerInvalidationSubscribers() {
  if (subscribed) return; // idempotent — safe under repeated require paths
  subscribed = true;

  for (const evt of USER_EVENTS) {
    iamEvents.on(evt, (payload) => {
      if (payload?.user_id) del(K.user(payload.user_id));
    });
  }
  for (const evt of ACCESS_USER_EVENTS) {
    accessEvents.on(evt, (payload) => {
      if (payload?.user_id) del(K.user(payload.user_id));
    });
  }
  for (const evt of GRANTS_EVENTS) {
    accessEvents.on(evt, () => invalidateAllGrants());
  }
  businessSetupEvents.on("config.updated", (payload) => {
    if (payload?.brand) del(K.brand(payload.brand));
  });
}

registerInvalidationSubscribers();

module.exports = {
  getAuthUser,
  getGrants,
  getBrandConfig,
  invalidateAllGrants,
  // exported for tests
  K,
};
