/**
 * Automated retention workflows (F-4 / PD §6.23).
 *
 * Rule admin CRUD + the engine:
 *   - trigger(): an event (order_placed, first_purchase, …) finds matching
 *     active rules, applies the per-customer rate-limit, and enqueues an
 *     execution (respecting the rule's wait period).
 *   - executeQueued(): a cron claims due executions (FOR UPDATE SKIP LOCKED) and
 *     runs the action, composing the coupon engine, send services, and
 *     notifications. Each action is isolated — a failure marks that one
 *     execution 'failed' without affecting the others.
 */

"use strict";

const repo = require("./workflow.repo");
const couponService = require("./coupon.service");
const email = require("../../services/email.service");
const whatsapp = require("../../services/whatsapp.service");
const notifications = require("../../services/notifications.service");
const { query, transaction } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const { NotFoundError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

const { BRANDS } = require("../../config/brands");

// ── Rule CRUD ─────────────────────────────────────────────
async function createRule({ brand, user, request_id, input }) {
  const rule = await repo.createRule({ brand, input, user_id: user.user_id });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.workflow.create",
    target_type: "retention_workflow_rule",
    target_id: rule.rule_id,
    after: { rule_key: rule.rule_key },
    request_id,
  });
  return rule;
}

const listRules = ({ brand, only_active }) =>
  repo.listRules({ brand, only_active });

async function getRule({ brand, id }) {
  const r = await repo.getRule({ brand, id });
  if (!r) throw new NotFoundError("Workflow rule");
  return r;
}

async function updateRule({ brand, user, request_id, id, patch }) {
  const r = await repo.updateRule({ brand, id, patch });
  if (!r) throw new NotFoundError("Workflow rule");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.workflow.update",
    target_type: "retention_workflow_rule",
    target_id: id,
    after: patch,
    request_id,
  });
  return r;
}

async function setRuleActive({ brand, user, request_id, id, is_active }) {
  const r = await repo.setRuleActive({ brand, id, is_active });
  if (!r) throw new NotFoundError("Workflow rule");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: is_active
      ? "retention.workflow.activate"
      : "retention.workflow.deactivate",
    target_type: "retention_workflow_rule",
    target_id: id,
    request_id,
  });
  return r;
}

// ── Engine ────────────────────────────────────────────────
/**
 * Fire a trigger: enqueue an execution for every active rule whose trigger_type
 * matches, subject to the per-customer rate limit.
 */
async function trigger({
  brand,
  trigger_type,
  contact_id,
  source_table,
  source_id,
}) {
  return transaction(async (client) => {
    const rules = await repo.findActiveByTrigger({
      client,
      brand,
      trigger_type,
    });
    let queued = 0;
    for (const rule of rules) {
      if (
        rule.max_executions_per_customer &&
        rule.rate_limit_days &&
        contact_id
      ) {
        const recent = await repo.countRecentForCustomer({
          client,
          brand,
          rule_id: rule.rule_id,
          contact_id,
          days: rule.rate_limit_days,
        });
        if (recent >= rule.max_executions_per_customer) continue; // rate-limited
      }
      await repo.enqueueExecution({
        client,
        brand,
        exec: {
          rule_id: rule.rule_id,
          contact_id,
          trigger_event_type: trigger_type,
          trigger_source_table: source_table,
          trigger_source_id: source_id,
        },
      });
      queued += 1;
    }
    return { queued };
  });
}

async function loadContact(brand, contact_id) {
  if (!contact_id) return null;
  const { rows } = await query(
    `SELECT contact_id, email, phone, first_name
       FROM shared.contacts WHERE contact_id = $1 AND business = $2`,
    [contact_id, brand],
  );
  return rows[0] || null;
}

/**
 * Run one action. Returns { status, result_summary, generated_records, failure_reason }.
 */
async function runAction({ brand, rule, execution }) {
  const cfg = rule.action_config || {};
  const contact = await loadContact(brand, execution.contact_id);

  switch (rule.action_type) {
    case "issue_coupon": {
      const tpl = rule.coupon_template || {};
      const code =
        (cfg.code_prefix || rule.rule_key || "WF").toUpperCase().slice(0, 20) +
        "-" +
        Math.random().toString(36).slice(2, 8).toUpperCase();
      const coupon = await couponService.createCoupon({
        brand,
        user: { user_id: null },
        request_id: `workflow:${execution.execution_id}`,
        input: {
          ...tpl,
          coupon_code: code,
          display_name: tpl.display_name || rule.display_name,
        },
      });
      return {
        status: "completed",
        result_summary: { coupon_issued: code },
        generated_records: { coupon_id: coupon.coupon_id },
      };
    }
    case "send_email": {
      if (!contact || !contact.email)
        return { status: "suppressed", failure_reason: "no contact email" };
      await email.send({
        to: contact.email,
        subject: cfg.subject || "",
        html: cfg.html || cfg.body || "",
      });
      return { status: "completed", result_summary: { email_sent: true } };
    }
    case "send_whatsapp": {
      if (!contact || !contact.phone)
        return { status: "suppressed", failure_reason: "no contact phone" };
      await whatsapp.sendText({ to: contact.phone, body: cfg.body || "" });
      return { status: "completed", result_summary: { whatsapp_sent: true } };
    }
    case "notify_team": {
      if (!cfg.user_id)
        return { status: "suppressed", failure_reason: "no target user_id" };
      await notifications.notify({
        user_id: cfg.user_id,
        business: brand,
        type: "order_status_change",
        priority: cfg.priority || "normal",
        title: cfg.title || rule.display_name,
        body: cfg.body || "",
      });
      return { status: "completed", result_summary: { notified: cfg.user_id } };
    }
    default:
      // award_points / create_task / send_sms / assign_to_user / add_to_segment / custom
      return {
        status: "failed",
        failure_reason: `action ${rule.action_type} not yet supported`,
      };
  }
}

async function executeQueued({ limit = 50 } = {}) {
  let done = 0;
  for (const brand of BRANDS) {
    let claimed = [];
    try {
      claimed = await transaction((client) =>
        repo.claimDueExecutions({ client, brand, limit }),
      );
    } catch (err) {
      logger.error({ err: err.message, brand }, "workflow claim failed");
      continue;
    }
    for (const execution of claimed) {
      try {
        const rule = await repo.getRule({ brand, id: execution.rule_id });
        if (!rule) {
          await repo.completeExecution({
            brand,
            id: execution.execution_id,
            status: "cancelled",
            failure_reason: "rule deleted",
          });
          continue;
        }
        const out = await runAction({ brand, rule, execution });
        await repo.completeExecution({
          brand,
          id: execution.execution_id,
          ...out,
        });
        await repo.bumpRuleRun({ brand, rule_id: rule.rule_id });
        done += 1;
      } catch (err) {
        await repo.completeExecution({
          brand,
          id: execution.execution_id,
          status: "failed",
          failure_reason: String(err.message || err).slice(0, 500),
        });
      }
    }
  }
  logger.info({ done }, "retention workflows executed");
  return { done };
}

module.exports = {
  createRule,
  listRules,
  getRule,
  updateRule,
  setRuleActive,
  trigger,
  executeQueued,
};
