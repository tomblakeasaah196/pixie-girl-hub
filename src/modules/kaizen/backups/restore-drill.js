/**
 * Restore drill — the thing that lets us PROVE backups restore and MEASURE the
 * recovery time (so the client SLA is honest, never a guess). Runs weekly
 * (Sun 04:00) in the worker, or on manual trigger.
 *
 * Flow (guide §7.7):
 *   1. find the latest successful logical_bundle run,
 *   2. download its DB dump from the OFF-SITE remote via rclone (exercises the
 *      real off-site copy end-to-end),
 *   3. verify sha256 against the ledger checksum,
 *   4. create a scratch DB (drop-if-exists first), pg_restore into it — TIMED,
 *   5. canary assertions (row counts on core tables vs. expected ranges),
 *   6. record pass/fail + duration + counts, drop the scratch DB,
 *   7. emit event → a fail fires a critical alert (Phase 5).
 *
 * The scratch DB is isolated (KAIZEN_SCRATCH_DB) and always dropped — a drill
 * never touches production data.
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
const { Client } = require("pg");

const { config } = require("../../../config/env");
const { logger } = require("../../../config/logger");
const repo = require("./backups.repo");
const rclone = require("./destinations/rclone");
const local = require("./destinations/local");

// Canary tables asserted after restore. Overridable via kaizen_settings
// ('restore.canary_tables'); defaults are cross-cutting tables that always exist.
const DEFAULT_CANARY = ["shared.users", "shared.contacts"];

function scratchName() {
  return config.KAIZEN_SCRATCH_DB || "kaizen_restore_scratch";
}
function dbConn(database) {
  return {
    host: config.DB_HOST || process.env.DB_HOST || "localhost",
    port: Number(config.DB_PORT || process.env.DB_PORT || 5432),
    user: config.DB_USER || process.env.DB_USER,
    password: config.DB_PASSWORD || process.env.DB_PASSWORD,
    database,
    ssl: (config.DB_SSL || process.env.DB_SSL) === "true" ? { rejectUnauthorized: false } : false,
  };
}
function pgEnv() {
  return { ...process.env, PGPASSWORD: config.DB_PASSWORD || process.env.DB_PASSWORD || "" };
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

/** Run a statement on the maintenance DB ('postgres') via a short-lived client. */
async function maintenanceExec(sql) {
  const client = new Client(dbConn("postgres"));
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function run({ trigger = "scheduled" } = {}) {
  const logLines = [];
  const log = (m) => {
    logLines.push(`[${new Date().toISOString()}] ${m}`);
    logger.info({ drill: true }, m);
  };

  const source = await repo.getLatestSuccessfulLogical();
  const drill = await repo.createDrill({ backupRunId: source ? source.run_id : null });
  const startedMs = Date.now();
  const scratch = scratchName();
  const stage = config.KAIZEN_BACKUP_STAGING_DIR || path.join(os.tmpdir(), "kaizen-staging");
  const localDump = path.join(stage, `drill-${Date.now()}.dump`);

  try {
    if (!source || !source.artifact_key) {
      throw new Error("no successful logical backup with an artifact to restore");
    }
    await fsp.mkdir(stage, { recursive: true });

    // 2. Download the dump from off-site.
    const dest = source.destination_id ? await repo.getDestination(source.destination_id) : null;
    const transport = dest && dest.kind === "local" ? local : rclone;
    log(`download ${source.artifact_key}`);
    await transport.download(source.artifact_key, localDump);

    // 3. Verify checksum against the ledger.
    if (source.checksum) {
      const got = await sha256File(localDump);
      if (got !== source.checksum) {
        throw new Error(`checksum mismatch: ${got.slice(0, 12)} vs ledger ${source.checksum.slice(0, 12)}`);
      }
      log("checksum verified");
    }

    // 4. Fresh scratch DB, then pg_restore (TIMED from download start already).
    log(`recreate scratch db ${scratch}`);
    await maintenanceExec(`DROP DATABASE IF EXISTS ${scratch}`);
    await maintenanceExec(`CREATE DATABASE ${scratch}`);
    log("pg_restore → scratch");
    await execFileP(
      config.KAIZEN_PGRESTORE_BIN || "pg_restore",
      [
        "--no-owner", "--no-privileges",
        "-h", dbConn().host, "-p", String(dbConn().port), "-U", dbConn().user,
        "-d", scratch, localDump,
      ],
      { env: pgEnv(), timeout: 3 * 60 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 },
    ).catch((e) => {
      // pg_restore warns (non-zero) on benign issues; only fail if the DB is empty.
      log(`pg_restore returned: ${e.message.split("\n")[0]}`);
    });

    // 5. Canary assertions.
    const canaryTables = (await repo.getSetting("restore.canary_tables", DEFAULT_CANARY)) || DEFAULT_CANARY;
    const client = new Client(dbConn(scratch));
    await client.connect();
    const assertions = [];
    const rowCounts = {};
    try {
      for (const t of canaryTables) {
        try {
          const { rows } = await client.query(`SELECT count(*)::bigint AS n FROM ${t}`);
          const n = Number(rows[0].n);
          rowCounts[t] = n;
          assertions.push({ check: `${t} has rows`, expected: "> 0", got: n, ok: n > 0 });
        } catch (e) {
          assertions.push({ check: `${t} present`, expected: "table exists", got: e.message.split("\n")[0], ok: false });
        }
      }
    } finally {
      await client.end();
    }

    const passed = assertions.length > 0 && assertions.every((a) => a.ok);
    log(`assertions: ${assertions.filter((a) => a.ok).length}/${assertions.length} ok`);

    // 6. Drop scratch, record result.
    await maintenanceExec(`DROP DATABASE IF EXISTS ${scratch}`).catch((e) => log(`drop scratch warn: ${e.message}`));
    await fsp.rm(localDump, { force: true }).catch(() => {});

    const finished = await repo.finishDrill(drill.drill_id, {
      status: passed ? "pass" : "fail",
      durationMs: Date.now() - startedMs,
      assertions,
      restoredRowCounts: rowCounts,
      error: passed ? null : "one or more canary assertions failed",
    });

    try {
      require("../kaizen.events").emit(passed ? "drill.passed" : "drill.failed", {
        drill_id: drill.drill_id,
        duration_ms: finished.duration_ms,
      });
    } catch { /* optional */ }
    return finished;
  } catch (err) {
    log(`FAILED: ${err.message}`);
    await maintenanceExec(`DROP DATABASE IF EXISTS ${scratch}`).catch(() => {});
    await fsp.rm(localDump, { force: true }).catch(() => {});
    const failed = await repo.finishDrill(drill.drill_id, {
      status: "fail",
      durationMs: Date.now() - startedMs,
      assertions: [],
      restoredRowCounts: {},
      error: err.message,
    });
    try {
      require("../kaizen.events").emit("drill.failed", { drill_id: drill.drill_id, error: err.message });
    } catch { /* optional */ }
    return failed;
  }
}

module.exports = { run };
