/**
 * Approval inbox wiring for EVERY workflow-driven approval.
 *
 * Expenses, purchasing, pricing, campaigns, intercompany and the stylist
 * programme all route through the workflow engine. None of them told the
 * approver anything: the engine opened an instance and waited for someone to
 * think to visit the approvals queue. Modules that did notify (stock, cash
 * requests) each hand-rolled it, so the behaviour differed per module and
 * none of them closed the task when the decision came.
 *
 * Subscribing HERE means one wiring covers every workflow, present and
 * future — a new module that calls `wf.openInstance` gets deep-linked tasks,
 * notifications and automatic close-out without writing a line of it.
 *
 * Stage transitions matter: a two-stage approval must retire stage one's
 * tasks when it advances to stage two, or the first approver is left holding
 * a task for a decision they have already made. `settleApproval` closes every
 * open task for the record, so each stage starts clean and only the current
 * tier is holding anything.
 *
 * Everything here is best-effort: an approval must never fail because a task
 * could not be raised.
 */

"use strict";

const wf = require("../../workflows/engine");
const { requestApproval, settleApproval } = require("./approval-requests");
const { usersWhoCanApprove } = require("./approvers.repo");
const { labelFor } = require("../links/deep-links");
const { query } = require("../../config/database");
const { logger } = require("../../config/logger");

let registered = false;

/** The definition's stages, or [] when it can't be read. */
async function stagesFor(instance) {
  const { rows } = await query(
    `SELECT definition FROM shared.workflow_definitions WHERE workflow_id = $1`,
    [instance.workflow_id],
  );
  if (!rows[0]) return [];
  return wf.normaliseStages(rows[0].definition || {});
}

/** Users holding any of these role names for the brand. */
async function usersWithRoles({ business, roleNames }) {
  if (!roleNames.length) return [];
  const { rows } = await query(
    `SELECT DISTINCT u.user_id
       FROM shared.users u
       JOIN shared.user_roles ur ON ur.user_id = u.user_id
       JOIN shared.roles r ON r.role_id = ur.role_id
      WHERE u.is_active = true
        AND r.role_name = ANY($2::text[])
        AND (ur.business = '*' OR ur.business = $1)
        AND (ur.expires_at IS NULL OR ur.expires_at > now())`,
    [business, roleNames],
  );
  return rows.map((r) => r.user_id);
}

/** Active CEO/owner accounts for the brand. */
async function ceoUsers(business) {
  const { rows } = await query(
    `SELECT user_id FROM shared.users
      WHERE is_active = true AND is_ceo = true
        AND ($1 = ANY(permitted_businesses) OR permitted_businesses = '{}')`,
    [business],
  );
  return rows.map((r) => r.user_id);
}

/**
 * Who must decide on the stage this instance is sitting at.
 *
 * Mirrors the engine's own authority rule (userCanActOnStage) so nobody is
 * asked to decide something the engine would refuse them:
 *   - 'user' approvers are that user;
 *   - 'role' approvers are the holders of that role ('ceo'/'owner' → the CEO);
 *   - 'position' approvers fall back to whoever holds <module>.approve, which
 *     is what the route itself trusts for position-based stages.
 */
async function approversForCurrentStage(instance) {
  const stages = await stagesFor(instance);
  const stage = stages[(instance.current_stage || 1) - 1];
  if (!stage) return [];
  const approvers = stage.approvers || [];
  const ids = new Set();

  for (const a of approvers.filter((x) => x.type === "user" && x.value)) {
    ids.add(a.value);
  }

  const roleValues = approvers
    .filter((a) => a.type === "role" && a.value)
    .map((a) => a.value);
  const ceoWanted = roleValues.some((v) => v === "ceo" || v === "owner");
  const plainRoles = roleValues.filter((v) => v !== "ceo" && v !== "owner");
  if (ceoWanted) {
    for (const id of await ceoUsers(instance.business)) ids.add(id);
  }
  if (plainRoles.length) {
    for (const id of await usersWithRoles({
      business: instance.business,
      roleNames: plainRoles,
    })) {
      ids.add(id);
    }
  }

  // Position stages (and stages with no approver constraints at all) are
  // gated by the module's approve grant — ask exactly those people.
  const positionStage =
    approvers.some((a) => a.type === "position") || approvers.length === 0;
  if (positionStage && instance.trigger_module) {
    const users = await usersWhoCanApprove({
      brand: instance.business,
      module: instance.trigger_module,
    });
    for (const u of users) ids.add(u.user_id);
  }

  return [...ids];
}

/** "Approve expense · ₦150,000" — context is whatever the module passed. */
function describe(instance) {
  const ctx = instance.context || {};
  const bits = [];
  if (ctx.reference || ctx.document_number)
    bits.push(ctx.reference || ctx.document_number);
  if (ctx.amount_ngn) bits.push(`₦${Number(ctx.amount_ngn).toLocaleString()}`);
  if (ctx.description) bits.push(ctx.description);
  return bits.join(" · ") || null;
}

/** Ask the current stage's approvers to decide. */
async function askCurrentStage(instance) {
  const approver_user_ids = await approversForCurrentStage(instance);
  if (!approver_user_ids.length) {
    logger.warn(
      {
        instance_id: instance.instance_id,
        stage: instance.current_stage,
        module: instance.trigger_module,
      },
      "approvals: no approver could be resolved for this stage — nobody was asked",
    );
    return;
  }
  const what = labelFor(instance.reference_table);
  await requestApproval({
    brand: instance.business,
    // Point at the underlying record (the expense, the PO), not the workflow
    // row — that is the screen where the approver can see what they are
    // deciding on. deep-links.js maps both singular and table-name forms.
    reference_type: instance.reference_table,
    reference_id: instance.reference_id,
    approver_user_ids,
    requested_by: instance.initiated_by,
    priority: "high",
    title: `Approve ${what}${
      instance.current_stage > 1 ? ` (stage ${instance.current_stage})` : ""
    }`,
    description: describe(instance),
    due_at: instance.stage_timeout_at || null,
  });
}

/** Retire the tasks the current stage is holding. */
async function closeStage(instance, outcome) {
  await settleApproval({
    brand: instance.business,
    reference_type: instance.reference_table,
    reference_id: instance.reference_id,
    outcome,
    // Stage hand-offs tell nobody: only the FINAL outcome is news for the
    // person who raised the request.
    requester_user_id: null,
  });
}

function register() {
  if (registered) return;
  registered = true;

  const safe = (name, fn) => (payload) =>
    Promise.resolve()
      .then(() => fn(payload))
      .catch((err) =>
        logger.error(
          { err: err.message, event: name },
          "approvals: workflow subscriber failed",
        ),
      );

  wf.onWorkflowEvent(
    "workflow.opened",
    safe("workflow.opened", ({ instance }) => instance && askCurrentStage(instance)),
  );

  // Advanced = the previous tier decided; their tasks are done, and the next
  // tier now needs asking.
  wf.onWorkflowEvent(
    "workflow.advanced",
    safe("workflow.advanced", async ({ instance }) => {
      if (!instance) return;
      await closeStage(instance, "approved");
      await askCurrentStage(instance);
    }),
  );

  // A timeout escalation moves the decision to someone else — the old holder
  // should stop seeing it, the new one should start.
  wf.onWorkflowEvent(
    "workflow.escalated",
    safe("workflow.escalated", async ({ instance }) => {
      if (!instance) return;
      await closeStage(instance, "cancelled");
      await askCurrentStage(instance);
    }),
  );

  wf.onWorkflowEvent(
    "workflow.completed",
    safe("workflow.completed", async ({ instance, status }) => {
      if (!instance) return;
      await settleApproval({
        brand: instance.business,
        reference_type: instance.reference_table,
        reference_id: instance.reference_id,
        outcome: status === "rejected" ? "rejected" : "approved",
        requester_user_id: instance.initiated_by,
        title: describe(instance) || undefined,
      });
    }),
  );

  wf.onWorkflowEvent(
    "workflow.changes_requested",
    safe("workflow.changes_requested", async ({ instance }) => {
      if (!instance) return;
      await settleApproval({
        brand: instance.business,
        reference_type: instance.reference_table,
        reference_id: instance.reference_id,
        outcome: "changes_requested",
        requester_user_id: instance.initiated_by,
      });
    }),
  );

  logger.info(
    "approval subscribers registered (workflow open/advance/escalate/complete → deep-linked tasks + close-out)",
  );
}

register();

module.exports = { register, approversForCurrentStage };
