/**
 * GeoIP service — local MaxMind GeoLite2-Country database.
 *
 * Hosts the mmdb reader in-process so every IP lookup is a pure in-memory
 * trie walk: zero network, zero latency, unlimited throughput.
 *
 * Boot: call `init()` once (server.js / worker.js startup). Subsequent calls
 * (e.g. from the weekly auto-updater) hot-swap the reader atomically so no
 * in-flight lookup sees a torn state.
 *
 * Usage:
 *   const geoip = require('./geoip');
 *   await geoip.init();                // once at boot
 *   geoip.lookupCountry('197.x.x.x'); // → 'NG' | null
 *   await geoip.reload();             // called by auto-updater after .mmdb swap
 */

"use strict";

const fs = require("fs");
const path = require("path");
const maxmind = require("maxmind");
const { config } = require("../config/env");
const { logger } = require("../config/logger");

// Resolved once at module load; reused on every reload.
const DB_PATH = path.resolve(config.MAXMIND_DB_PATH);

// Atomic reference: the live reader, or null when the db is absent/broken.
let _reader = null;

/**
 * Load (or reload) the mmdb reader from DB_PATH.
 * Safe to call at any time — replaces the module-level reference atomically.
 *
 * @returns {Promise<boolean>} true when the reader loaded successfully.
 */
async function init() {
  if (!fs.existsSync(DB_PATH)) {
    logger.warn(
      { dbPath: DB_PATH },
      "GeoIP: database file not found — geo lookups disabled. " +
        "Extract GeoLite2-Country.mmdb to the configured path.",
    );
    _reader = null;
    return false;
  }

  try {
    const next = await maxmind.open(DB_PATH);
    _reader = next; // atomic swap
    logger.info({ dbPath: DB_PATH }, "GeoIP: database loaded");
    return true;
  } catch (err) {
    logger.error(
      { err: err.message, dbPath: DB_PATH },
      "GeoIP: failed to open database",
    );
    _reader = null;
    return false;
  }
}

/**
 * Hot-reload the reader after the .mmdb file has been replaced on disk.
 * Delegates to `init()` — same code path, separate name for clarity at
 * call sites (the auto-updater scheduler calls this).
 */
async function reload() {
  logger.info("GeoIP: reloading database after update");
  return init();
}

/**
 * Return the ISO 3166-1 alpha-2 country code for the given IP address.
 *
 * Best-effort: returns null on any error (private IP, IPv6 not in db,
 * reader not yet loaded, malformed address). Never throws.
 *
 * @param {string|undefined} ip
 * @returns {string|null} e.g. 'NG', 'GB', 'US', or null
 */
function lookupCountry(ip) {
  if (!_reader || !ip || typeof ip !== "string") return null;

  // Strip IPv4-mapped IPv6 prefix (::ffff:x.x.x.x) so the mmdb trie can match.
  const addr = ip.replace(/^::ffff:/i, "").trim();
  if (!addr) return null;

  try {
    const result = _reader.get(addr);
    return (
      result?.country?.iso_code || result?.registered_country?.iso_code || null
    );
  } catch {
    // Malformed or private address — silently return null.
    return null;
  }
}

/**
 * Whether the reader is currently loaded and ready.
 * The geo-currency middleware uses this to skip the lookup path entirely
 * rather than paying the null-check cost per request.
 */
function isReady() {
  return _reader !== null;
}

module.exports = { init, reload, lookupCountry, isReady };
