/**
 * Workflow Engine (V2.2 §6.27 — Org & Workflow Builder).
 *
 * Data-driven approval routing. Definitions live in
 * shared.workflow_definitions (JSONB stages); running state in
 * shared.workflow_instances; the per-approver log in
 * shared.workflow_decisions. The engine reads the definition at request
 * time — no compiled matrix, no code change to reroute an approval.
 *
 * Routing is THRESHOLD-AWARE (see conditions.js): each stage carries a
 * condition evaluated against the instance context, so a ₦150k expense
 * routes to the manager tier and a ₦250k expense routes straight to the CEO
 * tier. Non-applicable stages are skipped, not run.
 *
 * Public API (each accepts an optional `client` to join a caller's tx):
 *   - findDefinition({ business, trigger_module, trigger_action })
 *   - requiresApproval({ business, trigger_module, trigger_action, context })
 *       → false when no stage applies (caller can skip the instance).
 *   - openInstance({ business, trigger_module, trigger_action,
 *                    reference_table, reference_id, opened_by, context })
 *       → opens at the first APPLICABLE stage; if none apply, the instance
 *         is created already 'approved' and workflow.completed fires, so the
 *         module's "auto-approved below threshold" path is uniform.
 *   - findOpenInstance({ business, reference_table, reference_id })
 *   - act({ instance_id, user, action:'approve'|'reject'|'request_changes', notes })
 *       → records the decision, advances to the next applicable stage,
 *         terminates, or (request_changes) sends back to the first stage.
 *   - resolveTimeout({ instance_id })   — applies a stage's on_timeout policy
 *   - resolveApprover({ business, stage, current_position_id })
 *
 * Authority rule: the acting user must hold one of the stage's approver
 * roles (the `owner`/CEO holder may act on any stage). 'position' approvers
 * trust the route's `org_workflow.approve` RBAC grant; 'user' approvers must
 * match the acting user. The engine never widens access.
 */

"use strict";

const { EventEmitter } = require("events");
const { transaction, ex: execFor } = require("../config/database");
const { AppError } = require("../utils/errors");
const cond = require("./conditions");
const defaults = require("./default-definitions");

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const VALID_ACTIONS = new Set(["approve", "reject", "request_changes"]);

// Re-export the pure normaliser so callers/tests keep one entry point.
const normaliseStages = cond.normaliseStages;

// ── Role-name → role_id resolution (system roles are static; cache them) ──
const roleIdCache = new Map(); // role_name → role_id
async function roleIdsForNames(exec, names) {
  const wanted = [...new Set(names)].filter(Boolean);
  const missing = wanted.filter((n) => !roleIdCache.has(n));
  if (missing.length) {
    const { rows } = await exec(
      `SELECT role_id, role_name FROM shared.roles WHERE role_name = ANY($1::text[])`,
      [missing],
    );
    for (const r of rows) roleIdCache.set(r.role_name, r.role_id);
  }
  return wanted.map((n) => roleIdCache.get(n)).filter(Boolean);
}

/**
 * May this user act on this (already-applicable) stage?
 *   - owner / CEO: any stage.
 *   - 'user' approver: must match the acting user.
 *   - 'role' approver: the user must hold that role. 'ceo'/'owner' role values
 *     are CEO-only (only the owner-role holder passes, handled up top).
 *   - 'position' approver: trusted to the route's approve grant (best-effort).
 *   - no role/user constraints at all: allowed (route already gated it).
 */
async function userCanActOnStage(exec, stage, user) {
  if (user && user.is_ceo) return true;
  const approvers = stage.approvers || [];
  const userId = user && user.user_id;

  if (approvers.some((a) => a.type === "user" && a.value === userId)) {
    return true;
  }

  const roleValues = approvers
    .filter((a) => a.type === "role")
    .map((a) => a.value);

  if (roleValues.length) {
    const ceoOnly = roleValues.filter((v) => v === "ceo" || v === "owner");
    const otherRoles = roleValues.filter((v) => v !== "ceo" && v !== "owner");
    // CEO-only stage with no alternative role → non-CEO cannot act.
    if (ceoOnly.length && otherRoles.length === 0) return false;
    if (otherRoles.length) {
      const ids = await roleIdsForNames(exec, otherRoles);
      const held = user && Array.isArray(user.role_ids) ? user.role_ids : [];
      if (held.some((rid) => ids.includes(rid))) return true;
    }
    // Listed roles but the user holds none of them.
    if (!approvers.some((a) => a.type === "position")) return false;
  }

  // Position-based approval: trust the route-level approve grant.
  if (approvers.some((a) => a.type === "position")) return true;

  // No role/user/position constraints → route RBAC is the only gate.
  return roleValues.length === 0;
}

async function findDefinition({
  client,
  business,
  trigger_module,
  trigger_action,
}) {
  const exec = execFor(client);
  const { rows } = await exec(
    `SELECT * FROM shared.workflow_definitions
      WHERE business = $1 AND trigger_module = $2 AND trigger_action = $3
        AND is_active = true
      ORDER BY version DESC
      LIMIT 1`,
    [business, trigger_module, trigger_action],
  );
  return rows[0] || null;
}

/** Lazily create the canonical definition for a trigger if the brand has none. */
async function ensureDefaultDefinition({
  client,
  business,
  trigger_module,
  trigger_action,
  opened_by,
}) {
  const existing = await findDefinition({
    client,
    business,
    trigger_module,
    trigger_action,
  });
  if (existing) return existing;

  const spec = defaults.getSpec(trigger_module, trigger_action);
  if (!spec) {
    throw new AppError(
      "WORKFLOW_NOT_CONFIGURED",
      `No workflow definition for ${trigger_module}.${trigger_action}`,
      409,
    );
  }
  const exec = execFor(client);
  const { rows } = await exec(
    `INSERT INTO shared.workflow_definitions
       (business, name, description, trigger_module, trigger_action, definition, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (business, name, version) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [
      business,
      spec.name,
      spec.description,
      trigger_module,
      trigger_action,
      JSON.stringify(spec.definition),
      opened_by || null,
    ],
  );
  return rows[0];
}

async function requiresApproval({
  client,
  business,
  trigger_module,
  trigger_action,
  context = {},
}) {
  const def = await findDefinition({
    client,
    business,
    trigger_module,
    trigger_action,
  });
  const definition = def
    ? def.definition
    : (defaults.getSpec(trigger_module, trigger_action) || {}).definition;
  if (!definition) return false;
  return cond.requiresApproval(definition, context);
}

async function openInstance({
  client,
  business,
  trigger_module,
  trigger_action,
  reference_table,
  reference_id,
  opened_by,
  context = {},
}) {
  const def = await ensureDefaultDefinition({
    client,
    business,
    trigger_module,
    trigger_action,
    opened_by,
  });
  const exec = execFor(client);
  const first = cond.firstApplicableStage(def.definition, context);

  // Nothing to approve at this amount → record an auto-approved instance so
  // the module's completion handler runs through the same path.
  if (!first) {
    const parkStage = cond.lastStageOrder(def.definition);
    const { rows } = await exec(
      `INSERT INTO shared.workflow_instances
         (workflow_id, business, reference_table, reference_id, current_stage,
          status, context, initiated_by, stage_entered_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, 'approved', $6::jsonb, $7, now(), now())
       RETURNING *`,
      [
        def.workflow_id,
        business,
        reference_table,
        reference_id,
        parkStage,
        JSON.stringify(context),
        opened_by,
      ],
    );
    const instance = rows[0];
    emitter.emit("workflow.completed", {
      instance,
      status: "approved",
      auto: true,
    });
    return instance;
  }

  const { rows } = await exec(
    `INSERT INTO shared.workflow_instances
       (workflow_id, business, reference_table, reference_id, current_stage,
        status, context, initiated_by, stage_entered_at, stage_timeout_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6::jsonb, $7, now(),
             now() + ($8 || ' hours')::interval)
     RETURNING *`,
    [
      def.workflow_id,
      business,
      reference_table,
      reference_id,
      first.order,
      JSON.stringify(context),
      opened_by,
      String(first.timeout_hours),
    ],
  );
  const instance = rows[0];
  emitter.emit("workflow.opened", { instance });
  return instance;
}

async function findOpenInstance({
  client,
  business,
  reference_table,
  reference_id,
}) {
  const exec = execFor(client);
  const { rows } = await exec(
    `SELECT * FROM shared.workflow_instances
      WHERE business = $1 AND reference_table = $2 AND reference_id = $3
        AND status = 'pending'
      ORDER BY initiated_at DESC
      LIMIT 1`,
    [business, reference_table, reference_id],
  );
  return rows[0] || null;
}

async function act({ client, instance_id, user, action, notes }) {
  if (!VALID_ACTIONS.has(action)) {
    throw new AppError(
      "INVALID_ACTION",
      `Unknown workflow action ${action}`,
      400,
    );
  }

  const run = async (c) => {
    const exec = c.query.bind(c);
    const { rows: instRows } = await exec(
      `SELECT * FROM shared.workflow_instances WHERE instance_id = $1 FOR UPDATE`,
      [instance_id],
    );
    const instance = instRows[0];
    if (!instance) {
      throw new AppError("NOT_FOUND", "Workflow instance not found", 404);
    }
    if (instance.status !== "pending") {
      throw new AppError(
        "WORKFLOW_CLOSED",
        `Instance already ${instance.status}`,
        409,
      );
    }

    const { rows: defRows } = await exec(
      `SELECT * FROM shared.workflow_definitions WHERE workflow_id = $1`,
      [instance.workflow_id],
    );
    const definition = defRows[0] && defRows[0].definition;
    const stage = cond.stageByOrder(definition, instance.current_stage);
    if (!stage) {
      throw new AppError("WORKFLOW_STAGE_MISSING", "Stage not found", 409);
    }

    if (!(await userCanActOnStage(exec, stage, user))) {
      throw new AppError(
        "PERMISSION_DENIED",
        "You are not an approver for this stage",
        403,
      );
    }

    await exec(
      `INSERT INTO shared.workflow_decisions
         (instance_id, stage_number, decided_by, decision, comments)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        instance_id,
        instance.current_stage,
        user.user_id,
        action,
        notes || null,
      ],
    );

    // ── Reject — terminal ──────────────────────────────────────────────
    if (action === "reject") {
      const r = await exec(
        `UPDATE shared.workflow_instances
            SET status = 'rejected', completed_at = now()
          WHERE instance_id = $1 RETURNING *`,
        [instance_id],
      );
      emitter.emit("workflow.completed", {
        instance: r.rows[0],
        status: "rejected",
      });
      return r.rows[0];
    }

    // ── Request changes — send back to the first applicable stage ──────
    if (action === "request_changes") {
      const first = cond.firstApplicableStage(definition, instance.context);
      const backTo = first ? first.order : instance.current_stage;
      const timeout = first ? first.timeout_hours : stage.timeout_hours;
      const r = await exec(
        `UPDATE shared.workflow_instances
            SET current_stage = $2,
                stage_entered_at = now(),
                stage_timeout_at = now() + ($3 || ' hours')::interval
          WHERE instance_id = $1 RETURNING *`,
        [instance_id, backTo, String(timeout)],
      );
      emitter.emit("workflow.changes_requested", {
        instance: r.rows[0],
        requested_by: user.user_id,
        notes: notes || null,
      });
      return r.rows[0];
    }

    // ── Approve — advance to next applicable stage, or complete ────────
    const next = cond.nextApplicableStage(
      definition,
      instance.context,
      instance.current_stage,
    );
    if (!next) {
      const r = await exec(
        `UPDATE shared.workflow_instances
            SET status = 'approved', completed_at = now()
          WHERE instance_id = $1 RETURNING *`,
        [instance_id],
      );
      emitter.emit("workflow.completed", {
        instance: r.rows[0],
        status: "approved",
      });
      return r.rows[0];
    }
    const r = await exec(
      `UPDATE shared.workflow_instances
          SET current_stage = $2,
              stage_entered_at = now(),
              stage_timeout_at = now() + ($3 || ' hours')::interval
        WHERE instance_id = $1 RETURNING *`,
      [instance_id, next.order, String(next.timeout_hours)],
    );
    emitter.emit("workflow.advanced", { instance: r.rows[0] });
    return r.rows[0];
  };

  if (client) return run(client);
  return transaction(run);
}

/**
 * Apply the current stage's on_timeout policy to one overdue instance.
 * Called by the timeout sweeper (jobs/schedulers/workflow-timeout.js).
 *   escalate (default) — re-arm the timer and emit workflow.escalated; never
 *                        auto-approves money.
 *   auto_approve       — system advances / completes (decision 'timeout_auto').
 *   auto_reject        — system rejects (status 'timeout_rejected').
 */
async function resolveTimeout({ client, instance_id }) {
  const run = async (c) => {
    const exec = c.query.bind(c);
    const { rows: instRows } = await exec(
      `SELECT * FROM shared.workflow_instances
        WHERE instance_id = $1 AND status = 'pending' FOR UPDATE`,
      [instance_id],
    );
    const instance = instRows[0];
    if (!instance) return null; // already resolved by someone else

    const { rows: defRows } = await exec(
      `SELECT * FROM shared.workflow_definitions WHERE workflow_id = $1`,
      [instance.workflow_id],
    );
    const definition = defRows[0] && defRows[0].definition;
    const stage = cond.stageByOrder(definition, instance.current_stage);
    const policy = (stage && stage.on_timeout) || "escalate";

    if (policy === "escalate") {
      const hours = stage ? stage.timeout_hours : 48;
      const r = await exec(
        `UPDATE shared.workflow_instances
            SET stage_timeout_at = now() + ($2 || ' hours')::interval
          WHERE instance_id = $1 RETURNING *`,
        [instance_id, String(hours)],
      );
      emitter.emit("workflow.escalated", {
        instance: r.rows[0],
        stage: instance.current_stage,
      });
      return r.rows[0];
    }

    // Record the automatic decision either way.
    await exec(
      `INSERT INTO shared.workflow_decisions
         (instance_id, stage_number, decided_by, decision, comments)
       VALUES ($1, $2, NULL, 'timeout_auto', $3)`,
      [instance_id, instance.current_stage, `on_timeout=${policy}`],
    );

    if (policy === "auto_reject") {
      const r = await exec(
        `UPDATE shared.workflow_instances
            SET status = 'timeout_rejected', completed_at = now()
          WHERE instance_id = $1 RETURNING *`,
        [instance_id],
      );
      emitter.emit("workflow.completed", {
        instance: r.rows[0],
        status: "timeout_rejected",
        auto: true,
      });
      return r.rows[0];
    }

    // auto_approve — advance to next applicable stage, else complete.
    const next = cond.nextApplicableStage(
      definition,
      instance.context,
      instance.current_stage,
    );
    if (!next) {
      const r = await exec(
        `UPDATE shared.workflow_instances
            SET status = 'timeout_approved', completed_at = now()
          WHERE instance_id = $1 RETURNING *`,
        [instance_id],
      );
      emitter.emit("workflow.completed", {
        instance: r.rows[0],
        status: "timeout_approved",
        auto: true,
      });
      return r.rows[0];
    }
    const r = await exec(
      `UPDATE shared.workflow_instances
          SET current_stage = $2,
              stage_entered_at = now(),
              stage_timeout_at = now() + ($3 || ' hours')::interval
        WHERE instance_id = $1 RETURNING *`,
      [instance_id, next.order, String(next.timeout_hours)],
    );
    emitter.emit("workflow.advanced", { instance: r.rows[0], auto: true });
    return r.rows[0];
  };

  if (client) return run(client);
  return transaction(run);
}

/**
 * Best-effort "who should approve the current stage" for notification
 * routing. Honours deputy fallback and CEO escalation. The CEO is the holder
 * of the `owner` system role (there is no is_ceo column).
 */
async function resolveApprover({
  client,
  business,
  stage,
  current_position_id,
}) {
  const exec = execFor(client);
  const wantsCeo = (stage.approvers || []).some(
    (a) => a.type === "role" && (a.value === "ceo" || a.value === "owner"),
  );

  const ceoLookup = async () => {
    const { rows } = await exec(
      `SELECT u.user_id,
              COALESCE(c.display_name, split_part(u.email::text, '@', 1)) AS display_name
         FROM shared.users u
         JOIN shared.user_roles ur ON ur.user_id = u.user_id
         JOIN shared.roles r       ON r.role_id = ur.role_id AND r.role_name = 'owner'
         LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
         LEFT JOIN shared.contacts c        ON c.contact_id = sp.contact_id
        WHERE u.is_active = true
          AND $1 = ANY(u.permitted_businesses)
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
        LIMIT 1`,
      [business],
    );
    return rows[0] || null;
  };

  if (wantsCeo) {
    const ceo = await ceoLookup();
    if (ceo) return { kind: "ceo", ...ceo };
  }

  if (current_position_id) {
    const { rows } = await exec(
      `SELECT position_id, profile_id, reports_to_position_id, is_deputy
         FROM shared.org_positions WHERE position_id = $1`,
      [current_position_id],
    );
    const pos = rows[0];
    if (pos && pos.profile_id) return { kind: "position", ...pos };
    if (pos) {
      const { rows: dep } = await exec(
        `SELECT position_id, profile_id FROM shared.org_positions
          WHERE reports_to_position_id = $1 AND is_deputy = true AND profile_id IS NOT NULL
          LIMIT 1`,
        [pos.reports_to_position_id],
      );
      if (dep[0]) return { kind: "deputy", ...dep[0] };
    }
  }

  const ceo = await ceoLookup();
  return ceo ? { kind: "ceo_escalation", ...ceo } : null;
}

function onWorkflowEvent(eventType, handler) {
  emitter.on(eventType, handler);
}

module.exports = {
  findDefinition,
  requiresApproval,
  openInstance,
  findOpenInstance,
  act,
  resolveTimeout,
  resolveApprover,
  onWorkflowEvent,
  emitter,
  normaliseStages, // pure re-export for callers/tests
};
