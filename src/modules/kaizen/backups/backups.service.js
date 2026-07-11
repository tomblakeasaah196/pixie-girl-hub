/**
 * Kaizen backups service — orchestration + ledger + retention.
 *
 * Long-running work (the actual dump/upload/imaging) runs in the WORKER via the
 * 'kaizen-backup' BullMQ queue. The controller enqueues and returns immediately;
 * this service is the enqueue + read + retention + audit layer. Triggers and
 * reruns are audit-logged.
 */

"use strict";

const { Queue } = require("bullmq");
const { getClient: getRedisClient } = require("../../../config/redis");
const { config } = require("../../../config/env");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const repo = require("./backups.repo");
const authRepo = require("../auth/kaizen-auth.repo");
const rclone = require("./destinations/rclone");

const QUEUE_NAME = "kaizen-backup";
let _queue = null;
function queue() {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, { connection: getRedisClient() });
  }
  return _queue;
}

// ── Triggers ─────────────────────────────────────────────────────────────────

const KINDS = new Set(["logical_bundle", "full_volume"]);

async function trigger({ kind, operatorId, ip }) {
  if (!KINDS.has(kind)) {
    throw new AppError("KAIZEN_BAD_BACKUP_KIND", "Unknown backup kind", 400);
  }
  const job = await queue().add(
    "run",
    { kind, trigger: "manual", createdBy: operatorId },
    { removeOnComplete: 100, removeOnFail: 200 },
  );
  await authRepo.writeAudit({
    operatorId,
    action: "backup.trigger",
    targetType: "backup",
    targetId: kind,
    metadata: { job_id: job.id, kind },
    ip,
  });
  return { enqueued: true, job_id: job.id, kind };
}

async function rerun({ runId, operatorId, ip }) {
  const run = await repo.getRun(runId);
  if (!run) throw new AppError("NOT_FOUND", "Backup run not found", 404);
  if (run.status !== "failed") {
    throw new AppError("KAIZEN_RERUN_NOT_FAILED", "Only failed runs can be re-run", 400, {
      user_message: "Only a failed backup can be re-run.",
    });
  }
  const job = await queue().add(
    "run",
    { kind: run.kind, trigger: "rerun", createdBy: operatorId },
    { removeOnComplete: 100, removeOnFail: 200 },
  );
  await authRepo.writeAudit({
    operatorId,
    action: "backup.rerun",
    targetType: "backup",
    targetId: runId,
    metadata: { job_id: job.id, kind: run.kind },
    ip,
  });
  return { enqueued: true, job_id: job.id, kind: run.kind };
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function listRuns(args) {
  const { rows, total } = await repo.listRuns(args);
  return {
    data: rows,
    pagination: {
      page: args.page || 1,
      page_size: args.pageSize || 30,
      total,
      total_pages: Math.max(1, Math.ceil(total / (args.pageSize || 30))),
    },
  };
}

async function getRun(runId) {
  const run = await repo.getRun(runId);
  if (!run) throw new AppError("NOT_FOUND", "Backup run not found", 404);
  return run;
}

/** Dashboard summary: last success per kind, storage free, retention. */
async function status() {
  const [lastSuccess, dest, retention, drill] = await Promise.all([
    repo.lastSuccessPerKind(),
    repo.getDefaultDestination(),
    repo.getSetting("backup.retention", { daily: 7, weekly: 4, monthly: 6 }),
    repo.latestDrill(),
  ]);

  let storage = null;
  if (dest && dest.kind === "rclone") {
    try {
      const remote = (dest.rclone_remote || config.KAIZEN_RCLONE_REMOTE || "").replace(/:.*/, ":");
      if (remote) storage = await rclone.about(remote);
    } catch (err) {
      logger.warn({ err: err.message }, "rclone about failed");
    }
  }

  return {
    last_success: lastSuccess,
    destination: dest
      ? { name: dest.name, kind: dest.kind, rclone_remote: dest.rclone_remote, path_prefix: dest.path_prefix }
      : null,
    storage,
    retention,
    restore_drill: drill,
    schedule: {
      logical: "02:30 Africa/Lagos",
      full_volume: "03:00 Africa/Lagos",
      restore_drill: "Sun 04:00 Africa/Lagos",
    },
  };
}

// ── Restore drills ───────────────────────────────────────────────────────────

async function triggerDrill({ operatorId, ip }) {
  const job = await queue().add(
    "run",
    { kind: "restore_drill", trigger: "manual", createdBy: operatorId },
    { removeOnComplete: 50, removeOnFail: 100 },
  );
  await authRepo.writeAudit({
    operatorId,
    action: "restore.drill",
    targetType: "restore_drill",
    metadata: { job_id: job.id },
    ip,
  });
  return { enqueued: true, job_id: job.id };
}

async function listDrills({ page = 1, pageSize = 20 } = {}) {
  const { rows, total } = await repo.listDrills({ page, pageSize });
  return {
    data: rows,
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

// ── Destinations ─────────────────────────────────────────────────────────────

async function listDestinations() {
  return repo.listDestinations();
}
async function createDestination({ input, operatorId, ip }) {
  const d = await repo.createDestination({
    name: input.name,
    kind: input.kind,
    rcloneRemote: input.rclone_remote,
    pathPrefix: input.path_prefix,
    isDefault: input.is_default,
  });
  await authRepo.writeAudit({
    operatorId, action: "backup.destination.create",
    targetType: "destination", targetId: d.destination_id, ip,
  });
  return d;
}
async function updateDestination({ id, input, operatorId, ip }) {
  const d = await repo.updateDestination(id, {
    name: input.name,
    rcloneRemote: input.rclone_remote,
    pathPrefix: input.path_prefix,
    isDefault: input.is_default,
    isActive: input.is_active,
  });
  if (!d) throw new AppError("NOT_FOUND", "Destination not found", 404);
  await authRepo.writeAudit({
    operatorId, action: "backup.destination.update",
    targetType: "destination", targetId: id, ip,
  });
  return d;
}

// ── Retention (called by the maintenance tick, Phase 5) ──────────────────────

async function pruneRetention() {
  const retention = await repo.getSetting("backup.retention", { daily: 7 });
  const keepDaily = retention.daily || 7;
  const toPrune = await repo.logicalRunsToPrune({ keepDaily });
  let pruned = 0;
  for (const run of toPrune) {
    try {
      const dest = run.destination_id ? await repo.getDestination(run.destination_id) : null;
      if (dest && dest.kind === "rclone" && run.artifact_key) {
        await rclone.del(run.artifact_key);
      }
      await repo.markPruned(run.run_id); // keep the audit row, drop the artifact_key
      pruned += 1;
    } catch (err) {
      logger.warn({ err: err.message, run: run.run_id }, "prune failed");
    }
  }
  return { pruned };
}

module.exports = {
  QUEUE_NAME,
  trigger,
  rerun,
  listRuns,
  getRun,
  status,
  listDestinations,
  createDestination,
  updateDestination,
  pruneRetention,
  triggerDrill,
  listDrills,
};
