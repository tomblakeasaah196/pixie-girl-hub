/**
 * GeoLite2-Country database auto-updater.
 *
 * MaxMind releases updated mmdb files several times a week. This scheduler
 * fetches the latest archive from the MaxMind permanent download URL,
 * extracts the .mmdb file, overwrites the local copy, and hot-reloads the
 * in-process reader — all without a server restart.
 *
 * Schedule: Sunday 02:00 WAT (configured via CRON_GEOIP_DB_UPDATE in env,
 * defaulting to "0 2 * * 0").
 *
 * Prerequisites:
 *   MAXMIND_LICENSE_KEY — a free GeoLite2 licence key from maxmind.com.
 *   Without it the job logs a warning and exits cleanly each run.
 *
 * Download URL (permalink — no date suffix, always latest):
 *   https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz
 */

"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const axios = require("axios");
const tar = require("tar");

const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const geoip = require("../../services/geoip");

const DOWNLOAD_URL =
  "https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz";

const DB_FILENAME = "GeoLite2-Country.mmdb";

/** Resolved destination path (same as config.MAXMIND_DB_PATH). */
const DEST_PATH = path.resolve(config.MAXMIND_DB_PATH);

/**
 * Download the latest GeoLite2-Country database, extract it, replace the
 * local mmdb, and hot-reload the in-process reader.
 *
 * @returns {Promise<{updated: boolean, skipped?: boolean}>}
 */
async function runGeoIpDatabaseUpdate() {
  if (!config.MAXMIND_LICENSE_KEY) {
    logger.info(
      "GeoIP updater: MAXMIND_LICENSE_KEY not set — skipping database update. " +
        "Add the key to .env to enable automatic updates.",
    );
    return { updated: false, skipped: true };
  }

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "geoip-update-"));
  const tarPath = path.join(tmpDir, "GeoLite2-Country.tar.gz");

  try {
    // ── 1. Download ───────────────────────────────────────────
    logger.info({ url: DOWNLOAD_URL }, "GeoIP updater: downloading database");

    const response = await axios.get(DOWNLOAD_URL, {
      responseType: "stream",
      auth: {
        username: config.MAXMIND_ACCOUNT_ID || "0", // free tier can use '0'
        password: config.MAXMIND_LICENSE_KEY,
      },
      timeout: 120_000, // 2 min — file is ~4MB but give room for slow links
    });

    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(tarPath);
      response.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
      response.data.on("error", reject);
    });

    logger.info({ tarPath }, "GeoIP updater: download complete");

    // ── 2. Extract ────────────────────────────────────────────
    // The archive layout is:  GeoLite2-Country_YYYYMMDD/GeoLite2-Country.mmdb
    // tar.extract strips the leading directory component via `strip: 1`.
    await tar.extract({
      file: tarPath,
      cwd: tmpDir,
      strip: 1,
      filter: (filePath) => path.basename(filePath) === DB_FILENAME,
    });

    const extractedPath = path.join(tmpDir, DB_FILENAME);

    if (!fs.existsSync(extractedPath)) {
      throw new Error(
        `Expected ${DB_FILENAME} not found in archive after extraction`,
      );
    }

    // ── 3. Overwrite destination ──────────────────────────────
    // Ensure the destination directory exists (first-run on a fresh deploy).
    await fsp.mkdir(path.dirname(DEST_PATH), { recursive: true });
    await fsp.rename(extractedPath, DEST_PATH);

    logger.info({ dest: DEST_PATH }, "GeoIP updater: database file updated");

    // ── 4. Hot-reload the in-process reader ───────────────────
    const ok = await geoip.reload();
    if (!ok) {
      logger.warn("GeoIP updater: reload returned false — check the mmdb file");
    }

    logger.info("GeoIP updater: complete — new database active");
    return { updated: true };
  } catch (err) {
    logger.error(
      { err: err.message, stack: err.stack },
      "GeoIP updater: database update failed",
    );
    return { updated: false };
  } finally {
    // Always clean up the temp directory regardless of success/failure.
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { runGeoIpDatabaseUpdate };
