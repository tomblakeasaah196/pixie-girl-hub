/**
 * Action runner for the retention strategy engine (Module 6.23).
 *
 * Executes one step's action against an enrolled customer, composing the
 * existing platform services (email, coupon engine, loyalty, tasks,
 * notifications). Email is the canonical retention channel; quiet-hours /
 * frequency-cap gating happens in the engine before this runs (see
 * strategy.engine + strategy.suppression), so a `send_email` here is already
 * cleared to send. Each action is isolated — it returns a status object and
 * never throws past the engine's per-step try/catch.
 */

"use strict";

const { query } = require("../../config/database");
const email = require("../../services/email.service");
const couponService = require("./coupon.service");
const retentionService = require("./retention.service");
const tasksService = require("../../shared/tasks/tasks.service");
const notifications = require("../../services/notifications.service");
const { EVENT_KEY } = require("./strategy.suppression");
const { logger } = require("../../config/logger");

/** Replace {{token}} occurrences with facts values (missing → ""). */
function renderTokens(str, facts) {
  if (!str || typeof str !== "string") return str;
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
    const v = key
      .split(".")
      .reduce(
        (acc, k) => (acc === null || acc === undefined ? undefined : acc[k]),
        facts,
      );
    return v === null || v === undefined ? "" : String(v);
  });
}

async function loadEmailTemplate(brand, templateId) {
  if (!templateId) return null;
  try {
    const { rows } = await query(
      `SELECT subject, body_html FROM ${brand}.email_templates WHERE template_id = $1`,
      [templateId],
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function logEmail({ brand, contact_id, recipient, subject, ok, error }) {
  try {
    await query(
      `INSERT INTO shared.outbound_comms_log
         (business, contact_id, channel, event_key, recipient, subject, status, error)
       VALUES ($1,$2,'email',$3,$4,$5,$6,$7)`,
      [
        brand,
        contact_id || null,
        EVENT_KEY,
        recipient || null,
        subject || null,
        ok ? "sent" : "failed",
        error || null,
      ],
    );
  } catch (err) {
    logger.warn({ err: err.message }, "retention: outbound_comms_log write failed");
  }
}

/**
 * @param {{brand:string, step:object, enrollment:object, facts:object, request_id?:string}} args
 * @returns {Promise<{status:string, result_summary?:object, generated_records?:object, failure_reason?:string}>}
 */
async function runStep({ brand, step, enrollment, facts, request_id }) {
  const cfg = step.action_config || {};
  const contactId = enrollment.contact_id;
  const reqId = request_id || `strategy:${enrollment.enrollment_id}:${step.step_id}`;

  switch (step.action_type) {
    case "send_email": {
      const to = facts.email;
      if (!to) return { status: "suppressed", failure_reason: "no contact email" };
      const tpl = await loadEmailTemplate(brand, step.email_template_id);
      const subject = renderTokens(tpl ? tpl.subject : cfg.subject, facts) || "";
      const html = renderTokens(tpl ? tpl.body_html : cfg.html || cfg.body, facts) || "";
      try {
        await email.send({ to, subject, html, brand });
        await logEmail({ brand, contact_id: contactId, recipient: to, subject, ok: true });
        return { status: "completed", result_summary: { email_sent: true, subject } };
      } catch (err) {
        await logEmail({
          brand,
          contact_id: contactId,
          recipient: to,
          subject,
          ok: false,
          error: String(err.message || err).slice(0, 300),
        });
        throw err;
      }
    }

    case "issue_coupon": {
      const tpl = step.coupon_template || {};
      const code =
        (cfg.code_prefix || "RTN").toUpperCase().slice(0, 16) +
        "-" +
        Math.random().toString(36).slice(2, 8).toUpperCase();
      const coupon = await couponService.createCoupon({
        brand,
        user: { user_id: null },
        request_id: reqId,
        input: {
          discount_type: cfg.discount_type || tpl.discount_type || "fixed_amount",
          discount_value: cfg.discount_value ?? tpl.discount_value ?? 0,
          ...tpl,
          coupon_code: code,
          display_name: tpl.display_name || cfg.display_name || "Retention offer",
          is_single_use: true,
          per_customer_limit: 1,
        },
      });
      return {
        status: "completed",
        result_summary: { coupon_issued: code },
        generated_records: { coupon_id: coupon.coupon_id },
      };
    }

    case "award_points": {
      if (!contactId) return { status: "suppressed", failure_reason: "no contact" };
      const points = parseInt(cfg.points, 10) || 0;
      if (points <= 0)
        return { status: "suppressed", failure_reason: "no points configured" };
      await retentionService.adjustPoints({
        brand,
        user: { user_id: null },
        request_id: reqId,
        contact_id: contactId,
        points,
        notes: cfg.notes || "Retention strategy bonus",
      });
      return { status: "completed", result_summary: { points_awarded: points } };
    }

    case "add_to_segment": {
      if (!contactId) return { status: "suppressed", failure_reason: "no contact" };
      const tag = cfg.tag || cfg.segment || cfg.tag_name;
      if (!tag) return { status: "suppressed", failure_reason: "no tag configured" };
      await query(
        `INSERT INTO shared.contact_tags (contact_id, tag_name, business)
         VALUES ($1,$2,$3) ON CONFLICT (contact_id, tag_name, business) DO NOTHING`,
        [contactId, String(tag).slice(0, 80), brand],
      );
      return { status: "completed", result_summary: { tagged: tag } };
    }

    case "assign_to_user":
    case "create_task": {
      const task = await tasksService.createFromModule({
        brand,
        created_by: null,
        task: {
          title: renderTokens(cfg.title, facts) || "Retention follow-up",
          description: renderTokens(cfg.description || cfg.body, facts) || "",
          assigned_to: cfg.user_id || cfg.assigned_to || null,
          priority: cfg.priority || "normal",
          due_at: cfg.due_at || null,
          reference_type: "contact",
          reference_id: contactId || null,
        },
      });
      return {
        status: "completed",
        result_summary: { task_id: task.task_id },
        generated_records: { task_id: task.task_id },
      };
    }

    case "notify_team": {
      if (!cfg.user_id)
        return { status: "suppressed", failure_reason: "no target user_id" };
      await notifications.notify({
        user_id: cfg.user_id,
        business: brand,
        type: cfg.type || "order_status_change",
        priority: cfg.priority || "normal",
        title: renderTokens(cfg.title, facts) || "Retention",
        body: renderTokens(cfg.body, facts) || "",
      });
      return { status: "completed", result_summary: { notified: cfg.user_id } };
    }

    default:
      return {
        status: "failed",
        failure_reason: `unknown action ${step.action_type}`,
      };
  }
}

module.exports = { runStep, renderTokens };
