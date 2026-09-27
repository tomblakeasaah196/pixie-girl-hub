/**
 * Approvals service (V2.2 §6.27).
 *
 * The read surface for the pending-approvals queue + instance detail, and
 * the write path for acting on a stage (approve / reject). Stage transitions
 * are delegated to the workflow engine, which owns the locking, the decision
 * log, and the domain events. The engine enforces the CEO-only constraint;
 * the route's `org_workflow.approve` RBAC grant gates everyone else.
 *
 * When an instance completes, the originating module reacts to the engine's
 * `workflow.completed` event (see that module's events wiring) — this service
 * does not reach across module boundaries.
 */

"use strict";

const repo = require("./approvals.repo");
const wf = require("../../workflows/engine");
const events = require("./org.events");
const { audit } = require("../../middleware/audit");
const { NotFoundError } = require("../../utils/errors");

function stageRequiresCeo(definition, currentStage) {
  const stages = wf.normaliseStages(definition || {});
  const stage = stages[currentStage - 1];
  if (!stage) return false;
  return (stage.approvers || []).some(
    (a) => a.type === "role" && a.value === "ceo",
  );
}

async function listPending({ brand, user, page, page_size }) {
  const { rows, total } = await repo.listPending({
    business: brand,
    page,
    page_size,
  });
  const data = rows.map((r) => ({
    instance_id: r.instance_id,
    workflow_id: r.workflow_id,
    workflow_name: r.workflow_name,
    trigger: { module: r.trigger_module, action: r.trigger_action },
    reference: { table: r.reference_table, id: r.reference_id },
    current_stage: r.current_stage,
    status: r.status,
    context: r.context,
    initiated_by: { user_id: r.initiated_by, name: r.initiated_by_name },
    initiated_at: r.initiated_at,
    stage_entered_at: r.stage_entered_at,
    stage_timeout_at: r.stage_timeout_at,
    requires_ceo: stageRequiresCeo(r.definition, r.current_stage),
    can_act: user.is_ceo || !stageRequiresCeo(r.definition, r.current_stage),
  }));
  return {
    data,
    meta: {
      page,
      page_size,
      total,
      has_more: page * page_size < total,
    },
  };
}

async function getInstance({ brand, instance_id }) {
  const instance = await repo.findInstance({ business: brand, instance_id });
  if (!instance) throw new NotFoundError("Workflow instance");
  const decisions = await repo.listDecisions({ instance_id });
  return {
    instance_id: instance.instance_id,
    workflow_id: instance.workflow_id,
    workflow_name: instance.workflow_name,
    trigger: {
      module: instance.trigger_module,
      action: instance.trigger_action,
    },
    reference: { table: instance.reference_table, id: instance.reference_id },
    current_stage: instance.current_stage,
    status: instance.status,
    context: instance.context,
    initiated_by: {
      user_id: instance.initiated_by,
      name: instance.initiated_by_name,
    },
    initiated_at: instance.initiated_at,
    completed_at: instance.completed_at,
    stage_entered_at: instance.stage_entered_at,
    stage_timeout_at: instance.stage_timeout_at,
    requires_ceo: stageRequiresCeo(instance.definition, instance.current_stage),
    decisions,
  };
}

async function act({ brand, user, request_id, instance_id, action, notes }) {
  // A catalogue USD rate request is decided by its own module: approving it
  // must APPLY the requested rate in the same transaction as the decision, not
  // just mark the instance approved (which would leave the rate unchanged
  // while the requester is told it was approved).
  if (action === "approve" || action === "reject") {
    const found = await repo.findInstance({ business: brand, instance_id });
    const usdReprice = require("../../modules/catalogue/usd-reprice.service");
    if (found && found.reference_table === usdReprice.RATE_CHANGE_REF) {
      const decide =
        action === "approve"
          ? usdReprice.approveRateChange
          : usdReprice.rejectRateChange;
      await decide({ brand, user, request_id, instance_id, notes });
      events.emit("approval_decided", {
        brand,
        instance_id,
        action,
        status: action === "approve" ? "approved" : "rejected",
        user_id: user.user_id,
      });
      return getInstance({ brand, instance_id });
    }
  }

  // The engine opens its own transaction, locks the instance, records the
  // decision, and advances or terminates. It throws PERMISSION_DENIED if the
  // current stage requires the CEO and the actor is not one.
  const updated = await wf.act({ instance_id, user, action, notes });

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: `org_workflow.${action}`,
    target_type: "workflow_instances",
    target_id: instance_id,
    after: { status: updated.status, current_stage: updated.current_stage },
    metadata: { notes: notes || null },
    request_id,
    is_sensitive: action === "approve",
  });

  events.emit("approval_decided", {
    brand,
    instance_id,
    action,
    status: updated.status,
    user_id: user.user_id,
  });

  return getInstance({ brand, instance_id });
}

// ── Definitions ───────────────────────────────────────────────────────────
async function listDefinitions({ brand, include_inactive }) {
  const data = await repo.listDefinitions({
    business: brand,
    include_inactive,
  });
  return { data };
}

async function getDefinition({ brand, workflow_id }) {
  const def = await repo.findDefinition({ business: brand, workflow_id });
  if (!def) throw new NotFoundError("Workflow definition");
  return def;
}

async function createDefinition({ brand, user, request_id, input }) {
  const created = await repo.createDefinition({
    business: brand,
    name: input.name,
    description: input.description,
    trigger_module: input.trigger_module,
    trigger_action: input.trigger_action,
    definition: input.definition,
    created_by: user.user_id,
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "org_workflow.create",
    target_type: "workflow_definitions",
    target_id: created.workflow_id,
    after: created,
    request_id,
    is_sensitive: true,
  });
  return created;
}

async function setDefinitionActive({
  brand,
  user,
  request_id,
  workflow_id,
  is_active,
}) {
  const before = await repo.findDefinition({ business: brand, workflow_id });
  if (!before) throw new NotFoundError("Workflow definition");
  const updated = await repo.setDefinitionActive({
    business: brand,
    workflow_id,
    is_active,
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: is_active
      ? "org_workflow.activate_definition"
      : "org_workflow.deactivate_definition",
    target_type: "workflow_definitions",
    target_id: workflow_id,
    before,
    after: updated,
    request_id,
    is_sensitive: true,
  });
  return updated;
}

module.exports = {
  listPending,
  getInstance,
  act,
  listDefinitions,
  getDefinition,
  createDefinition,
  setDefinitionActive,
};
