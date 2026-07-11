/**
 * Full-volume backup — Kaizen is the COCKPIT, not the imager. Node cannot image
 * a live disk from inside the process, so restic (encrypted, deduplicated,
 * incremental) does the actual imaging as root, via a sudoers-whitelisted
 * wrapper (ops/kaizen/kaizen-fullbackup.sh). On trigger we:
 *   1. create a run row,
 *   2. `sudo <KAIZEN_FULLBACKUP_CMD>` (that exact command only, NOPASSWD),
 *   3. read the wrapper's status JSON + `restic snapshots --json` (read-only) to
 *      capture the snapshot id and size.
 * See guide §7.6.
 *
 * restic dedup means only CHANGED blocks upload nightly — essential when the
 * media library is large.
 */

"use strict";

const fsp = require("fs/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

const { config } = require("../../../config/env");
const { logger } = require("../../../config/logger");
const repo = require("./backups.repo");

async function readStatusJson() {
  const p = config.KAIZEN_RESTIC_STATUS_JSON;
  if (!p) return null;
  try {
    return JSON.parse(await fsp.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

async function latestSnapshot() {
  const bin = config.KAIZEN_RESTIC_BIN || "restic";
  const repository = config.KAIZEN_RESTIC_REPOSITORY;
  if (!repository) return null;
  try {
    const { stdout } = await execFileP(bin, ["snapshots", "--json", "--latest", "1"], {
      env: {
        ...process.env,
        RESTIC_REPOSITORY: repository,
        RESTIC_PASSWORD: config.KAIZEN_RESTIC_PASSWORD || process.env.RESTIC_PASSWORD || "",
      },
      timeout: 2 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const arr = JSON.parse(stdout || "[]");
    return arr[arr.length - 1] || null;
  } catch (err) {
    logger.warn({ err: err.message }, "restic snapshots read failed");
    return null;
  }
}

/**
 * @param {object} p { trigger, createdBy }
 */
async function run({ trigger = "scheduled", createdBy = null } = {}) {
  const logLines = [];
  const log = (m) => {
    logLines.push(`[${new Date().toISOString()}] ${m}`);
    logger.info({ backup: "full_volume" }, m);
  };

  const runRow = await repo.createRun({
    kind: "full_volume",
    trigger,
    retentionClass: "daily",
    createdBy,
  });
  const startedMs = Date.now();
  const cmd = config.KAIZEN_FULLBACKUP_CMD || "/usr/local/bin/kaizen-fullbackup";

  try {
    log(`sudo ${cmd}`);
    // The wrapper is whitelisted NOPASSWD for exactly this command.
    await execFileP("sudo", [cmd], { timeout: 12 * 60 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });

    const status = await readStatusJson();
    const snap = await latestSnapshot();
    if (status && status.status && status.status !== "success") {
      throw new Error(`wrapper reported status=${status.status}`);
    }
    log(`snapshot ${snap?.short_id || snap?.id || "unknown"}`);

    const finished = await repo.finishRun(runRow.run_id, {
      status: "success",
      artifactKey: snap?.short_id || snap?.id || null,
      sizeBytes: null, // restic reports repo size separately; leave null per-snapshot
      log: logLines.join("\n"),
      durationMs: Date.now() - startedMs,
    });
    try {
      require("../kaizen.events").emit("backup.completed", { run_id: runRow.run_id, kind: "full_volume" });
    } catch { /* optional */ }
    return finished;
  } catch (err) {
    log(`FAILED: ${err.message}`);
    const failed = await repo.finishRun(runRow.run_id, {
      status: "failed",
      log: logLines.join("\n"),
      error: err.message,
      durationMs: Date.now() - startedMs,
    });
    try {
      require("../kaizen.events").emit("backup.failed", { run_id: runRow.run_id, kind: "full_volume", error: err.message });
    } catch { /* optional */ }
    return failed;
  }
}

module.exports = { run, latestSnapshot };
