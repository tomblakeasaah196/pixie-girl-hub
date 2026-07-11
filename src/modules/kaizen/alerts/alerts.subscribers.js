/**
 * Alert subscribers — bind the Kaizen domain-event bus to alert rules. This is
 * how a captured critical error / failed backup / failed restore drill turns
 * into an alert (email + in-dash), event-driven. Polled rules (health_degraded,
 * disk_low, perf_p95_breach, error_spike) are evaluated by the hourly
 * maintenance tick instead.
 *
 * init() is idempotent and should run in BOTH processes (the API emits error
 * events; the worker emits backup/drill events) — the EventEmitter is per
 * process, so there's no double-firing.
 */

"use strict";

const { bus } = require("../kaizen.events");
const service = require("./alerts.service");

let bound = false;

function init() {
  if (bound) return;
  bound = true;

  // New critical error group.
  bus.on("error.group_new", (p) => {
    if (p?.severity === "critical") {
      service.raise({
        conditionType: "error_new_critical",
        severity: "critical",
        title: `New critical error: ${p.title || p.group_id}`,
        body: `Source: ${p.source || "backend"}`,
        sourceRef: p.group_id,
      });
    }
  });

  // Regression: a resolved group came back.
  bus.on("error.group_reopened", (p) => {
    service.raise({
      conditionType: "error_new_critical",
      severity: p?.severity === "critical" ? "critical" : "error",
      title: `Error regressed (reopened ${p?.reopen_count || 1}×): ${p?.title || p?.group_id}`,
      body: "A previously resolved bug has recurred.",
      sourceRef: p?.group_id,
    });
  });

  // Backup failed.
  bus.on("backup.failed", (p) => {
    service.raise({
      conditionType: "backup_failed",
      severity: "error",
      title: `Backup failed (${p?.kind || "logical"})`,
      body: p?.error || "See the backup run log in Kaizen.",
      sourceRef: p?.run_id,
    });
  });

  // Restore drill failed — the honesty check; treat as critical.
  bus.on("drill.failed", (p) => {
    service.raise({
      conditionType: "restore_drill_failed",
      severity: "critical",
      title: "Restore drill FAILED",
      body: p?.error || "The latest backup did not restore cleanly. Do not quote recovery until fixed.",
      sourceRef: p?.drill_id,
    });
  });
}

module.exports = { init };
