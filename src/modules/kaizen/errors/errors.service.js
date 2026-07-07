/**
 * Kaizen errors service — business logic: persist a captured error (grouped +
 * auto-reopen), browse, resolve/ignore/reopen (audited), and Markdown export.
 *
 * `record()` is the single persistence path shared by the backend capture
 * (errors.capture.js), the process-level handlers, the worker failed-listener,
 * and the frontend ingest endpoint. It emits domain events for later phases
 * (realtime + alerts) but never throws them back to the caller.
 */

"use strict";

const { fingerprintOf } = require("./errors.fingerprint");
const { scrub } = require("./errors.redact");
const repo = require("./errors.repo");
const authRepo = require("../auth/kaizen-auth.repo");
const events = require("../kaizen.events");
const { logger } = require("../../../config/logger");
const { AppError } = require("../../../utils/errors");
const { buildMarkdown } = require("./errors.export");

const VALID_SOURCES = new Set([
  "backend",
  "worker",
  "admin",
  "storefront",
  "stylist",
  "landing",
  "kaizen",
  "unknown",
]);
const VALID_SEVERITY = new Set(["info", "warning", "error", "critical"]);

/**
 * Persist one captured error. Input is ALREADY redacted by the caller
 * (errors.capture.js / ingest controller). Returns the saved group summary, or
 * null if it was dropped. Never throws — capture must not break request flow.
 *
 * @param {object} p
 * @param {string} p.message           normalised, scrubbed message
 * @param {string} [p.stack]           scrubbed stack
 * @param {string} [p.errorCode]
 * @param {string} [p.source]
 * @param {string} [p.routePattern]
 * @param {number} [p.httpStatus]
 * @param {string} [p.severity]
 * @param {object} [p.occurrence]      { request_id, route, method, http_status, brand, user_ref, context }
 */
async function record(p) {
  try {
    const source = VALID_SOURCES.has(p.source) ? p.source : "unknown";
    const severity = VALID_SEVERITY.has(p.severity) ? p.severity : "error";
    const message = scrub(p.message) || p.errorCode || "Unknown error";
    const stack = p.stack ? scrub(p.stack) : null;

    const { fingerprint, title } = fingerprintOf({
      message,
      errorCode: p.errorCode,
      routePattern: p.routePattern,
      stack,
    });

    const sample = {
      message,
      route_pattern: p.routePattern || null,
      http_status: p.httpStatus || null,
      context: p.occurrence?.context || {},
      at: new Date().toISOString(),
    };

    const { group, was_insert, was_reopened } =
      await repo.upsertGroupAndOccurrence({
        group: {
          fingerprint,
          title,
          error_code: p.errorCode || null,
          source,
          route_pattern: p.routePattern || null,
          http_status: p.httpStatus || null,
          severity,
          sample,
        },
        occurrence: {
          request_id: p.occurrence?.request_id || null,
          route: p.occurrence?.route || p.routePattern || null,
          method: p.occurrence?.method || null,
          http_status: p.occurrence?.http_status || p.httpStatus || null,
          brand: p.occurrence?.brand || null,
          user_ref: p.occurrence?.user_ref || null,
          message,
          stack,
          context: p.occurrence?.context || {},
        },
      });

    events.emit(events.EVENTS.ERROR_CAPTURED, {
      group_id: group.group_id,
      severity: group.severity,
    });
    if (was_insert) {
      events.emit(events.EVENTS.ERROR_GROUP_NEW, {
        group_id: group.group_id,
        title: group.title,
        severity: group.severity,
        source: group.source,
      });
    }
    if (was_reopened) {
      events.emit(events.EVENTS.ERROR_GROUP_REOPENED, {
        group_id: group.group_id,
        title: group.title,
        severity: group.severity,
        reopen_count: group.reopen_count,
      });
    }
    return { group_id: group.group_id, was_insert, was_reopened };
  } catch (err) {
    // Capture must NEVER break the thing that produced the error.
    logger.warn({ err: err.message }, "kaizen error capture failed to persist");
    return null;
  }
}

// ── Browse ──────────────────────────────────────────────────────────────────

async function list({ status, severity, source, q, page, pageSize }) {
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  const { rows, total } = await repo.listGroups({
    status,
    severity,
    source,
    q,
    limit,
    offset,
  });
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

async function getDetail({ groupId, occPage = 1, occPageSize = 30 }) {
  const group = await repo.getGroup(groupId);
  if (!group) throw new AppError("NOT_FOUND", "Error group not found", 404);
  const { rows, total } = await repo.listOccurrences({
    groupId,
    limit: occPageSize,
    offset: (occPage - 1) * occPageSize,
  });
  return {
    group,
    occurrences: rows,
    pagination: {
      page: occPage,
      page_size: occPageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / occPageSize)),
    },
  };
}

// ── Lifecycle (audited) ──────────────────────────────────────────────────────

async function resolve({ groupIds, note, operatorId, ip }) {
  const rows = await repo.setStatusMany({
    groupIds,
    status: "resolved",
    note,
    resolvedBy: operatorId,
  });
  await authRepo.writeAudit({
    operatorId,
    action: "error.resolve",
    targetType: "error_group",
    targetId: groupIds.join(","),
    metadata: { count: rows.length, note: note || null },
    ip,
  });
  return rows;
}

async function ignore({ groupIds, operatorId, ip }) {
  const rows = await repo.setStatusMany({ groupIds, status: "ignored" });
  await authRepo.writeAudit({
    operatorId,
    action: "error.ignore",
    targetType: "error_group",
    targetId: groupIds.join(","),
    metadata: { count: rows.length },
    ip,
  });
  return rows;
}

async function reopen({ groupIds, operatorId, ip }) {
  const rows = await repo.reopenMany(groupIds);
  await authRepo.writeAudit({
    operatorId,
    action: "error.reopen",
    targetType: "error_group",
    targetId: groupIds.join(","),
    metadata: { count: rows.length },
    ip,
  });
  return rows;
}

// ── Export ───────────────────────────────────────────────────────────────────

async function exportMarkdown({ status, severity, source, q }) {
  const groups = await repo.listGroupsForExport({ status, severity, source, q });
  return buildMarkdown({ groups, filter: { status, severity, source, q } });
}

module.exports = {
  record,
  list,
  getDetail,
  resolve,
  ignore,
  reopen,
  exportMarkdown,
};
