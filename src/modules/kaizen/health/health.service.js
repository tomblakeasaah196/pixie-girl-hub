/**
 * Kaizen health service — runs probes against the live system.
 *
 * Two entry points:
 *   - current(): run all probes on demand (answers GET /health/current).
 *   - snapshot(): run probes AND persist a row per component (called by the
 *     1-minute health-tick scheduler, for trend lines + alerting).
 *
 * Every probe is defensive: a probe that throws returns a 'down'/'unknown'
 * status with a hint rather than blowing up the whole health check. Probes for
 * tables that don't exist yet (backup/restore, Phase 3/4) return 'unknown'.
 */

"use strict";

const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

const { query } = require("../../../config/database");
const { logger } = require("../../../config/logger");
const repo = require("./health.repo");

const DISK_DEGRADED_PCT = 15; // free% below this → degraded
const DISK_DOWN_PCT = 5; // free% below this → down
const QUEUE_FAILED_DEGRADED = 50; // failed jobs across queues → degraded
const QUEUE_WAITING_DEGRADED = 1000; // waiting backlog → degraded

// Known BullMQ queue names (kept in sync with src/jobs/worker.js). Hardcoded so
// the health probe never has to boot the worker. Missing/uninitialised queues
// are skipped gracefully.
const QUEUE_NAMES = [
  "media-processing",
  "email-send",
  "whatsapp-send",
  "instagram-send",
  "webhooks-replay",
  "ai-embed",
  "report-generate",
  "cart-ttl",
  "kaizen-backup",
];

async function timed(fn) {
  const t0 = Date.now();
  const r = await fn();
  return { ...r, latency_ms: Date.now() - t0 };
}

// ── Individual probes ────────────────────────────────────────────────────────

async function probeDb() {
  try {
    return await timed(async () => {
      await query("SELECT 1");
      return { component: "db", status: "ok", detail: {} };
    });
  } catch (err) {
    return { component: "db", status: "down", latency_ms: null, detail: { error: err.message } };
  }
}

async function probeRedis() {
  try {
    const { getClient } = require("../../../config/redis");
    const client = getClient();
    return await timed(async () => {
      const pong = await client.ping();
      return {
        component: "redis",
        status: pong === "PONG" ? "ok" : "degraded",
        detail: { pong },
      };
    });
  } catch (err) {
    return { component: "redis", status: "down", latency_ms: null, detail: { error: err.message } };
  }
}

// Lazily-created Queue instances, cached, so we don't spin them up per request.
let _queues = null;
function getProbeQueues() {
  if (_queues) return _queues;
  try {
    const { Queue } = require("bullmq");
    const { getClient } = require("../../../config/redis");
    const connection = getClient();
    _queues = QUEUE_NAMES.map((name) => ({ name, q: new Queue(name, { connection }) }));
  } catch {
    _queues = [];
  }
  return _queues;
}

async function probeQueue() {
  try {
    const queues = getProbeQueues();
    if (!queues.length) {
      return { component: "queue", status: "unknown", latency_ms: null, detail: { reason: "queues unavailable" } };
    }
    const t0 = Date.now();
    let waiting = 0;
    let failed = 0;
    let active = 0;
    let delayed = 0;
    const perQueue = {};
    await Promise.all(
      queues.map(async ({ name, q }) => {
        try {
          const c = await q.getJobCounts("waiting", "active", "failed", "delayed");
          waiting += c.waiting || 0;
          active += c.active || 0;
          failed += c.failed || 0;
          delayed += c.delayed || 0;
          perQueue[name] = c;
        } catch {
          /* skip a queue that isn't reachable */
        }
      }),
    );
    let status = "ok";
    if (failed >= QUEUE_FAILED_DEGRADED || waiting >= QUEUE_WAITING_DEGRADED) status = "degraded";
    return {
      component: "queue",
      status,
      latency_ms: Date.now() - t0,
      detail: { waiting, active, failed, delayed, queues: perQueue },
    };
  } catch (err) {
    return { component: "queue", status: "unknown", latency_ms: null, detail: { error: err.message } };
  }
}

async function probeDisk() {
  try {
    // df -Pk . → portable output in 1K blocks for the cwd filesystem.
    const { stdout } = await execFileP("df", ["-Pk", process.cwd()]);
    const line = stdout.trim().split("\n").pop();
    const cols = line.split(/\s+/);
    // Filesystem 1024-blocks Used Available Capacity Mounted
    const totalKb = Number(cols[1]);
    const availKb = Number(cols[3]);
    const freePct = totalKb ? Math.round((availKb / totalKb) * 100) : null;
    let status = "ok";
    if (freePct != null && freePct < DISK_DOWN_PCT) status = "down";
    else if (freePct != null && freePct < DISK_DEGRADED_PCT) status = "degraded";
    return {
      component: "disk",
      status,
      latency_ms: null,
      detail: { free_pct: freePct, total_gb: +(totalKb / 1048576).toFixed(1), avail_gb: +(availKb / 1048576).toFixed(1) },
    };
  } catch (err) {
    return { component: "disk", status: "unknown", latency_ms: null, detail: { error: err.message } };
  }
}

function probeMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  const usedPct = Math.round(((total - free) / total) * 100);
  let status = "ok";
  if (usedPct >= 95) status = "down";
  else if (usedPct >= 85) status = "degraded";
  return {
    component: "memory",
    status,
    latency_ms: null,
    detail: { used_pct: usedPct, total_gb: +(total / 1073741824).toFixed(1), free_gb: +(free / 1073741824).toFixed(1) },
  };
}

function probeCpu() {
  const cores = os.cpus()?.length || 1;
  const load1 = os.loadavg()[0];
  const ratio = load1 / cores;
  let status = "ok";
  if (ratio >= 2) status = "down";
  else if (ratio >= 1) status = "degraded";
  return {
    component: "cpu",
    status,
    latency_ms: null,
    detail: { cores, load1: +load1.toFixed(2), load_per_core: +ratio.toFixed(2) },
  };
}

// Backup / restore freshness — tables land in Phase 3/4. Guard with to_regclass
// so this is 'unknown' (not an error) until then.
async function probeBackupFreshness() {
  try {
    const { rows: reg } = await query(`SELECT to_regclass('shared.kaizen_backup_runs') AS t`);
    if (!reg[0].t) {
      return { component: "backup", status: "unknown", latency_ms: null, detail: { reason: "backups not yet enabled" } };
    }
    const { rows } = await query(
      `SELECT max(finished_at) AS last_ok
         FROM shared.kaizen_backup_runs
        WHERE status = 'success' AND kind IN ('logical_bundle','logical_db')`,
    );
    const last = rows[0].last_ok;
    if (!last) return { component: "backup", status: "down", latency_ms: null, detail: { reason: "no successful backup yet" } };
    const ageH = (Date.now() - new Date(last).getTime()) / 3600000;
    let status = "ok";
    if (ageH > 50) status = "down";
    else if (ageH > 26) status = "degraded";
    return { component: "backup", status, latency_ms: null, detail: { last_ok: last, age_hours: +ageH.toFixed(1) } };
  } catch (err) {
    return { component: "backup", status: "unknown", latency_ms: null, detail: { error: err.message } };
  }
}

async function probeRestoreDrill() {
  try {
    const { rows: reg } = await query(`SELECT to_regclass('shared.kaizen_restore_drills') AS t`);
    if (!reg[0].t) {
      return { component: "restore_drill", status: "unknown", latency_ms: null, detail: { reason: "drills not yet enabled" } };
    }
    const { rows } = await query(
      `SELECT status, finished_at, duration_ms
         FROM shared.kaizen_restore_drills
        ORDER BY started_at DESC LIMIT 1`,
    );
    if (!rows.length) return { component: "restore_drill", status: "unknown", latency_ms: null, detail: { reason: "no drill run yet" } };
    const d = rows[0];
    const ageDays = d.finished_at ? (Date.now() - new Date(d.finished_at).getTime()) / 86400000 : null;
    let status = "ok";
    if (d.status === "fail") status = "down";
    else if (ageDays != null && ageDays > 8) status = "degraded";
    return {
      component: "restore_drill",
      status,
      latency_ms: null,
      detail: { last_status: d.status, age_days: ageDays != null ? +ageDays.toFixed(1) : null, duration_ms: d.duration_ms },
    };
  } catch (err) {
    return { component: "restore_drill", status: "unknown", latency_ms: null, detail: { error: err.message } };
  }
}

// ── Aggregate ────────────────────────────────────────────────────────────────

async function current() {
  const [db, redis, queue, disk, backup, drill] = await Promise.all([
    probeDb(),
    probeRedis(),
    probeQueue(),
    probeDisk(),
    probeBackupFreshness(),
    probeRestoreDrill(),
  ]);
  const memory = probeMemory();
  const cpu = probeCpu();
  const components = [db, redis, queue, disk, memory, cpu, backup, drill];
  const worst = components.reduce((acc, c) => {
    const rank = { ok: 0, unknown: 1, degraded: 2, down: 3 };
    return rank[c.status] > rank[acc] ? c.status : acc;
  }, "ok");
  return { overall: worst, components, captured_at: new Date().toISOString() };
}

/** Run probes and persist a snapshot row per component. */
async function snapshot() {
  const { components } = await current();
  try {
    await repo.insertSnapshots(components);
  } catch (err) {
    logger.warn({ err: err.message }, "kaizen health snapshot persist failed");
  }
  return components;
}

async function history({ component, hours }) {
  return repo.history({ component, hours });
}

module.exports = { current, snapshot, history };
