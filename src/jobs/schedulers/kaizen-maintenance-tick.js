/**
 * Kaizen maintenance tick — hourly, under withCronLock. Two jobs:
 *   1. Evaluate the POLLED alert rules (health_degraded, disk_low,
 *      perf_p95_breach, error_spike) against current state and raise alerts.
 *      Event-driven rules (new critical, backup/drill failed) are handled by the
 *      subscribers, not here.
 *   2. Retention pruning: error occurrences (30d / 200 per group), alerts (90d),
 *      and off-site backup artifacts beyond the daily window.
 *
 * See guide §7.8 / §7.10.
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const alertsService = require("../../modules/kaizen/alerts/alerts.service");
const alertsRepo = require("../../modules/kaizen/alerts/alerts.repo");
const healthRepo = require("../../modules/kaizen/health/health.repo");
const errorsRepo = require("../../modules/kaizen/errors/errors.repo");
const backupsService = require("../../modules/kaizen/backups/backups.service");
const settingsRepo = require("../../modules/kaizen/settings/settings.repo");

async function evaluatePolledRules() {
  // Latest health snapshot per component.
  let latest = [];
  try {
    latest = await healthRepo.latestPerComponent();
  } catch (err) {
    logger.warn({ err: err.message }, "maintenance: health read failed");
  }
  const byComp = Object.fromEntries(latest.map((r) => [r.component, r]));

  // disk_low
  const disk = byComp.disk;
  if (disk && disk.detail && disk.detail.free_pct != null) {
    const rule = await alertsRepo.getRuleByType("disk_low");
    const threshold = rule?.threshold?.free_pct ?? 15;
    if (disk.detail.free_pct < threshold) {
      await alertsService.raise({
        conditionType: "disk_low",
        severity: disk.detail.free_pct < 5 ? "critical" : "warning",
        title: `Disk low: ${disk.detail.free_pct}% free`,
        body: "Off-site or local storage is running low.",
        sourceRef: "disk",
      });
    }
  }

  // health_degraded — any component down right now.
  const down = latest.filter((r) => r.status === "down").map((r) => r.component);
  if (down.length) {
    await alertsService.raise({
      conditionType: "health_degraded",
      severity: "error",
      title: `Health degraded: ${down.join(", ")} down`,
      body: "One or more components are reporting down.",
      sourceRef: down.sort().join(","),
    });
  }

  // perf_p95_breach — request-weighted p95 over the last hour.
  try {
    const rule = await alertsRepo.getRuleByType("perf_p95_breach");
    const p95Threshold = rule?.threshold?.p95_ms ?? 2000;
    const { rows } = await query(
      `SELECT CASE WHEN sum(req_count) > 0
                   THEN round(sum(p95_ms::numeric * req_count) / sum(req_count))
                   ELSE NULL END AS p95
         FROM shared.kaizen_perf_rollups
        WHERE window_start > now() - interval '1 hour'`,
    );
    const p95 = rows[0].p95 != null ? Number(rows[0].p95) : null;
    if (p95 != null && p95 > p95Threshold) {
      await alertsService.raise({
        conditionType: "perf_p95_breach",
        severity: "warning",
        title: `p95 latency ${p95}ms over ${p95Threshold}ms`,
        body: "Overall request latency breached the configured threshold.",
        sourceRef: "perf",
      });
    }
  } catch (err) {
    logger.warn({ err: err.message }, "maintenance: perf eval failed");
  }

  // error_spike — a single open group with many occurrences in the window.
  try {
    const rule = await alertsRepo.getRuleByType("error_spike");
    const count = rule?.threshold?.count ?? 20;
    const windowMin = rule?.threshold?.window_min ?? 5;
    const { rows } = await query(
      `SELECT o.group_id, count(*)::int AS n, g.title
         FROM shared.kaizen_error_occurrences o
         JOIN shared.kaizen_error_groups g ON g.group_id = o.group_id
        WHERE o.occurred_at > now() - ($1 || ' minutes')::interval
          AND g.status = 'open'
        GROUP BY o.group_id, g.title
       HAVING count(*) >= $2
        ORDER BY n DESC LIMIT 5`,
      [String(windowMin), count],
    );
    for (const r of rows) {
      await alertsService.raise({
        conditionType: "error_spike",
        severity: "error",
        title: `Error spike: ${r.n} in ${windowMin}m — ${r.title}`,
        body: "A single bug is firing rapidly.",
        sourceRef: r.group_id,
      });
    }
  } catch (err) {
    logger.warn({ err: err.message }, "maintenance: error_spike eval failed");
  }
}

async function prune() {
  try {
    await errorsRepo.pruneOccurrences({ olderThanDays: 30, keepPerGroup: 200 });
  } catch (err) {
    logger.warn({ err: err.message }, "maintenance: occurrence prune failed");
  }
  try {
    await alertsRepo.pruneOlderThan(90);
  } catch (err) {
    logger.warn({ err: err.message }, "maintenance: alert prune failed");
  }
  try {
    await backupsService.pruneRetention();
  } catch (err) {
    logger.warn({ err: err.message }, "maintenance: backup retention prune failed");
  }
}

async function run() {
  await evaluatePolledRules();
  await prune();
}

module.exports = { run };
