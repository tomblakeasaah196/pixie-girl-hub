/**
 * Kaizen alerts service — rule evaluation, dedupe, and dispatch.
 *
 * raise() is the single entry point: it checks the matching (enabled) rule,
 * suppresses duplicates within a window, records the alert, and dispatches to
 * the rule's channels. v1 channels: email + in_dash (Socket.io push). See §7.8.
 *
 * Dispatch never throws back to the caller — an alert failing to email must not
 * break the thing that raised it.
 */

"use strict";

const { logger } = require("../../../config/logger");
const email = require("../../../services/email.service");
const repo = require("./alerts.repo");
const settingsRepo = require("../settings/settings.repo");
const operatorsRepo = require("../operators/operators.repo");
const authRepo = require("../auth/kaizen-auth.repo");

const DEFAULT_WINDOW_MIN = 60;

/** Resolve alert recipients: explicit setting, else all active operators. */
async function recipients() {
  const configured = await settingsRepo.get("alerts.recipients", null);
  if (Array.isArray(configured) && configured.length) return configured;
  const ops = await operatorsRepo.listOperators();
  return ops.filter((o) => o.status === "active").map((o) => o.email);
}

function emitInDash(alert) {
  try {
    // Lazy require avoids a socket ↔ alerts import cycle, and is a no-op in the
    // worker process (no io there) — the alert row still persists + emails send.
    require("../kaizen.realtime").emitKaizen("alert:new", {
      alert_id: alert.alert_id,
      severity: alert.severity,
      title: alert.title,
      kind: alert.kind,
      created_at: alert.created_at,
    });
  } catch {
    /* socket optional */
  }
}

async function sendEmail(alert) {
  try {
    const to = await recipients();
    if (!to.length) return false;
    const color = alert.severity === "critical" ? "#e5484d" : "#f5a623";
    await email.send({
      to: to.join(","),
      subject: `[Kaizen ${alert.severity.toUpperCase()}] ${alert.title}`,
      html: `<div style="font-family:Montserrat,Arial,sans-serif;max-width:560px">
          <p style="border-left:4px solid ${color};padding-left:12px">
            <strong>${alert.title}</strong><br>${alert.body || ""}
          </p>
          <p style="font-size:12px;color:#666">Kaizen — Pixie Girl Hub ops console.
          Open the console to acknowledge.</p>
        </div>`,
      text: `[Kaizen ${alert.severity}] ${alert.title}\n\n${alert.body || ""}`,
      brand: "pixiegirl",
    });
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, "kaizen alert email failed");
    return false;
  }
}

/**
 * @param {object} p
 * @param {string} p.conditionType   one of the rule condition_types
 * @param {string} p.severity        info|warning|error|critical
 * @param {string} p.title
 * @param {string} [p.body]
 * @param {string} [p.sourceRef]
 * @param {string} [p.dedupeKey]     defaults to conditionType:sourceRef
 * @param {number} [p.windowMin]
 * @returns {Promise<object|null>} the alert row, or null if skipped/suppressed
 */
async function raise(p) {
  try {
    const rule = await repo.getRuleByType(p.conditionType);
    if (!rule || !rule.enabled) return null; // no rule or muted

    const windowMin = p.windowMin || rule.threshold?.window_min || DEFAULT_WINDOW_MIN;
    const dedupeKey = p.dedupeKey || `${p.conditionType}:${p.sourceRef || ""}`;
    if (await repo.findRecentByDedupe(dedupeKey, windowMin)) return null; // storm-suppressed

    const channels = rule.channels || ["email", "in_dash"];
    const channelsSent = {};

    const alert = await repo.createAlert({
      ruleId: rule.rule_id,
      kind: p.conditionType,
      severity: p.severity || "warning",
      title: p.title,
      body: p.body,
      sourceRef: p.sourceRef,
      dedupeKey,
      channelsSent,
    });

    if (channels.includes("in_dash")) {
      emitInDash(alert);
      channelsSent.in_dash = new Date().toISOString();
    }
    if (channels.includes("email")) {
      channelsSent.email = (await sendEmail(alert)) ? new Date().toISOString() : false;
    }
    return alert;
  } catch (err) {
    logger.warn({ err: err.message, cond: p.conditionType }, "kaizen alert raise failed");
    return null;
  }
}

// ── Read / manage ────────────────────────────────────────────────────────────

async function list({ status, page, pageSize }) {
  const { rows, total } = await repo.listAlerts({ status, page, pageSize });
  return {
    data: rows,
    pagination: {
      page: page || 1,
      page_size: pageSize || 30,
      total,
      total_pages: Math.max(1, Math.ceil(total / (pageSize || 30))),
    },
  };
}

async function acknowledge({ alertId, operatorId, ip }) {
  const row = await repo.acknowledge(alertId, operatorId);
  if (row) {
    await authRepo.writeAudit({
      operatorId, action: "alert.acknowledge", targetType: "alert", targetId: alertId, ip,
    });
  }
  return row;
}

async function listRules() {
  return repo.listRules();
}

async function updateRule({ ruleId, input, operatorId, ip }) {
  const row = await repo.updateRule(ruleId, {
    enabled: input.enabled,
    threshold: input.threshold,
    channels: input.channels,
  });
  if (row) {
    await authRepo.writeAudit({
      operatorId, action: "alert.rule.update", targetType: "alert_rule", targetId: ruleId,
      metadata: { enabled: input.enabled }, ip,
    });
  }
  return row;
}

module.exports = { raise, list, acknowledge, listRules, updateRule, recipients };
