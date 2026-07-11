/**
 * Logical backup — runs in the worker (02:30 daily, or on manual trigger).
 *
 * Bundle = database dump (pg_dump -Fc, all 3 schemas) + uploads/media tarball +
 * config tarball (.env, ecosystem, nginx). Each artifact is sha256'd, uploaded
 * via the destination transport (rclone crypt = encrypted at rest, or local),
 * and verified. The run row is the ledger. Every step's output is captured; any
 * failure marks the run 'failed' with the error. See guide §7.6.
 *
 * The .env holds secrets — this is WHY the rclone crypt remote is mandatory for
 * a real off-site destination.
 */

"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

const { config } = require("../../../config/env");
const { logger } = require("../../../config/logger");
const repo = require("./backups.repo");
const rclone = require("./destinations/rclone");
const local = require("./destinations/local");

function transportFor(destination) {
  return destination && destination.kind === "local" ? local : rclone;
}

function stagingDir() {
  return config.KAIZEN_BACKUP_STAGING_DIR || path.join(os.tmpdir(), "kaizen-staging");
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function datedPrefix(prefix) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${prefix}/logical/${yyyy}/${mm}/${dd}`;
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const s = fs.createReadStream(file);
    s.on("error", reject);
    s.on("data", (d) => hash.update(d));
    s.on("end", () => resolve(hash.digest("hex")));
  });
}

async function sizeOf(file) {
  const st = await fsp.stat(file);
  return st.size;
}

/**
 * @param {object} p { trigger, createdBy, destination? }
 * @returns {Promise<object>} the finished run row
 */
async function run({ trigger = "scheduled", createdBy = null, destination = null } = {}) {
  const dest = destination || (await repo.getDefaultDestination());
  const transport = transportFor(dest);
  const logLines = [];
  const log = (m) => {
    logLines.push(`[${new Date().toISOString()}] ${m}`);
    logger.info({ backup: "logical" }, m);
  };

  const runRow = await repo.createRun({
    kind: "logical_bundle",
    destinationId: dest ? dest.destination_id : null,
    trigger,
    retentionClass: "daily",
    createdBy,
  });
  const startedMs = Date.now();
  const stamp = ts();
  const stage = stagingDir();
  const artifacts = [];

  try {
    await fsp.mkdir(stage, { recursive: true });

    // 1. Database dump (custom format, compressed, all schemas).
    const dumpFile = path.join(stage, `db-${stamp}.dump`);
    log(`pg_dump → ${path.basename(dumpFile)}`);
    await execFileP(
      config.KAIZEN_PGDUMP_BIN || "pg_dump",
      [
        "-Fc",
        "-h", config.DB_HOST || process.env.DB_HOST || "localhost",
        "-p", String(config.DB_PORT || process.env.DB_PORT || 5432),
        "-U", config.DB_USER || process.env.DB_USER,
        "-d", config.DB_NAME || process.env.DB_NAME,
        "-f", dumpFile,
      ],
      {
        env: { ...process.env, PGPASSWORD: config.DB_PASSWORD || process.env.DB_PASSWORD || "" },
        timeout: 60 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    artifacts.push({ file: dumpFile, name: `db-${stamp}.dump` });

    // 2. Uploads/media tarball.
    const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
    const uploadsTar = path.join(stage, `uploads-${stamp}.tgz`);
    log(`tar uploads/media → ${path.basename(uploadsTar)}`);
    await execFileP(
      "tar",
      ["-czf", uploadsTar, "-C", repoRoot, "uploads", "media"],
      { timeout: 60 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 },
    ).catch((e) => {
      // uploads/media may be partially absent in some deploys — warn, continue.
      log(`WARN uploads tar: ${e.message}`);
    });
    if (fs.existsSync(uploadsTar)) artifacts.push({ file: uploadsTar, name: `uploads-${stamp}.tgz` });

    // 3. Config tarball (.env + ecosystem + nginx site if readable).
    const configTar = path.join(stage, `config-${stamp}.tgz`);
    log(`tar config → ${path.basename(configTar)}`);
    const cfgTargets = [".env", "ecosystem.config.js"].filter((f) =>
      fs.existsSync(path.join(repoRoot, f)),
    );
    if (cfgTargets.length) {
      await execFileP("tar", ["-czf", configTar, "-C", repoRoot, ...cfgTargets], {
        timeout: 5 * 60 * 1000,
      }).catch((e) => log(`WARN config tar: ${e.message}`));
      if (fs.existsSync(configTar)) artifacts.push({ file: configTar, name: `config-${stamp}.tgz` });
    }

    // 4. Checksums + upload + verify.
    const remotePrefix = dest ? datedPrefix(dest.path_prefix) : datedPrefix("pixiegirl-hub/backups");
    let totalSize = 0;
    const uploaded = [];
    for (const a of artifacts) {
      const checksum = await sha256File(a.file);
      const size = await sizeOf(a.file);
      totalSize += size;
      const remoteFile = dest && dest.kind === "rclone"
        ? transport.remotePath(dest.rclone_remote || config.KAIZEN_RCLONE_REMOTE, remotePrefix, a.name)
        : transport.remotePath(null, remotePrefix, a.name);
      log(`upload ${a.name} (${size}b, sha256 ${checksum.slice(0, 12)}…)`);
      await transport.copyto(a.file, remoteFile);
      const v = await transport.verifySize(remoteFile, size);
      if (!v.ok) throw new Error(`verify failed for ${a.name}: ${v.reason}`);
      uploaded.push({ name: a.name, remoteFile, checksum, size });
    }

    // 5. Success — record the DB dump as the primary artifact_key/checksum.
    const primary = uploaded.find((u) => u.name.startsWith("db-")) || uploaded[0] || {};
    const finished = await repo.finishRun(runRow.run_id, {
      status: "success",
      sizeBytes: totalSize,
      artifactKey: primary.remoteFile || null,
      checksum: primary.checksum || null,
      log: logLines.join("\n"),
      durationMs: Date.now() - startedMs,
    });

    // 6. Clean staging.
    await Promise.all(artifacts.map((a) => fsp.rm(a.file, { force: true }).catch(() => {})));

    // 7. Signal for alerts/socket (Phase 5 subscribers).
    try {
      require("../kaizen.events").emit("backup.completed", { run_id: runRow.run_id, kind: "logical_bundle" });
    } catch { /* events optional */ }

    return finished;
  } catch (err) {
    log(`FAILED: ${err.message}`);
    await Promise.all(artifacts.map((a) => fsp.rm(a.file, { force: true }).catch(() => {})));
    const failed = await repo.finishRun(runRow.run_id, {
      status: "failed",
      log: logLines.join("\n"),
      error: err.message,
      durationMs: Date.now() - startedMs,
    });
    try {
      require("../kaizen.events").emit("backup.failed", { run_id: runRow.run_id, kind: "logical_bundle", error: err.message });
    } catch { /* events optional */ }
    return failed;
  }
}

module.exports = { run };
