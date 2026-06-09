/**
 * Brand registry — the single source of truth for which per-brand schemas
 * exist. Replaces the hardcoded brand allowlist that was copied into ~47
 * files.
 *
 * ONE-LINE FIND-AND-REPLACE
 * ─────────────────────────
 * Replace the local declaration (and nothing else — every existing
 * `t = (brand,tbl) => {...VALID.has(brand)...}` and `VALID.has(x)` stays as
 * is) with a destructured require of the matching name:
 *
 *   - const VALID        = new Set(["pixiegirl", "faitlynhair"]);
 *     → const { VALID }        = require("../../config/brands");
 *
 *   - const VALID_BRANDS   = new Set(["pixiegirl", "faitlynhair"]);
 *     → const { VALID_BRANDS } = require("../../config/brands");
 *
 *   - const BRANDS       = ["pixiegirl", "faitlynhair"];   // cron fan-out
 *     → const { BRANDS } = require("../../config/brands");
 *
 * `VALID`, `VALID_BRANDS` and `BRANDS` are three names for the SAME live Set
 * object, so `.has()` and `for (const b of BRANDS)` keep working unchanged.
 * (A Set is iterable, so the cron `for…of` loop works against it too.)
 *
 * (Use `../config/brands` for files one level shallower, e.g. middleware and
 * realtime — same depth as their existing `./database` / `./logger` imports.)
 *
 * WHY A LIVE SET (and why it stays injection-safe)
 * ────────────────────────────────────────────────
 * Schema/identifier names can't be bound as query params, so repos build
 * `<brand>.table` by interpolation; the guard is `VALID.has(brand)` before
 * interpolation. We keep that guard intact — but the Set's *contents* are now
 * loaded from `shared.business_config`. The Set only ever admits keys that
 * pass a strict identifier regex (below), so membership still implies a
 * safe-to-interpolate value. The object reference never changes (refresh
 * mutates it in place), so every module that captured it at require-time sees
 * updates without re-importing.
 *
 * BOOT WIRING (not covered by the find-and-replace)
 *   - `await refreshBrands()` once at server startup (after the DB pool is up)
 *     and in the worker before crons are scheduled.
 *   - `registerBrand(key)` (or `refreshBrands()`) right after a successful
 *     bootstrap of a new business, so it goes live without a restart.
 */

"use strict";

const { query } = require("./database");
const { logger } = require("./logger");

// Postgres-safe schema-key guard: lowercase letter then letters/digits/_.
// Only keys matching this are ever admitted to the registry, which is what
// keeps interpolation of a registry member safe.
const BRAND_KEY_RE = /^[a-z][a-z0-9_]{1,62}$/;

// The founding brands seed the Set so the guard works at cold start, before
// refreshBrands() reconciles with shared.business_config.
const FOUNDING_BRANDS = ["pixiegirl", "faitlynhair"];

// THE live registry. Exported under every name the codebase already uses so a
// single-line require swap is a true drop-in. Never reassigned — only mutated.
const VALID = new Set(FOUNDING_BRANDS);

/** Replace the Set's contents in place (keeps the shared reference valid). */
function setRegistry(keys) {
  VALID.clear();
  for (const k of keys) VALID.add(k);
}

/** True if `brand` is a well-formed, known active brand. */
function isValidBrand(brand) {
  return (
    typeof brand === "string" && BRAND_KEY_RE.test(brand) && VALID.has(brand)
  );
}

/** Validate and return a brand; throws the same error repos threw before. */
function assertBrand(brand) {
  if (!isValidBrand(brand)) throw new Error(`Invalid brand: ${brand}`);
  return brand;
}

/** Schema-qualified table name with the injection guard, e.g. for new repos. */
function t(brand, table) {
  assertBrand(brand);
  return `${brand}.${table}`;
}

/** Snapshot array of active brand keys (when an array is specifically wanted). */
function listBrands() {
  return [...VALID];
}

/**
 * Reload active brand keys from shared.business_config. Mutates the live Set
 * in place. Never empties it: an empty/failed query keeps the current set so
 * a transient DB issue can't lock every brand out.
 */
async function refreshBrands() {
  try {
    const { rows } = await query(
      `SELECT business_key FROM shared.business_config WHERE is_active = true`,
    );
    const next = [];
    for (const r of rows) {
      if (BRAND_KEY_RE.test(r.business_key)) {
        next.push(r.business_key);
      } else {
        logger.warn(
          { business_key: r.business_key },
          "brand registry: skipping malformed business_key",
        );
      }
    }
    if (next.length === 0) {
      logger.warn(
        "brand registry: refresh found no active brands; keeping current set",
      );
      return listBrands();
    }
    setRegistry(next);
    logger.info({ brands: listBrands() }, "brand registry refreshed");
  } catch (err) {
    logger.error(
      { err: err.message },
      "brand registry refresh failed; keeping current set",
    );
  }
  return listBrands();
}

/** Add one brand to the live Set immediately (e.g. just after bootstrap). */
function registerBrand(brand) {
  if (typeof brand !== "string" || !BRAND_KEY_RE.test(brand))
    throw new Error(`Malformed brand key: ${brand}`);
  VALID.add(brand);
  return listBrands();
}

module.exports = {
  // The live Set, under all three names the codebase already declares.
  VALID,
  VALID_BRANDS: VALID,
  BRANDS: VALID,
  // Helpers (optional; for new code and boot/provisioning wiring).
  t,
  isValidBrand,
  assertBrand,
  listBrands,
  refreshBrands,
  registerBrand,
  BRAND_KEY_RE,
  FOUNDING_BRANDS,
};
