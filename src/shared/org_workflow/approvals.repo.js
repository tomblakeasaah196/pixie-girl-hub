/**
 * Approvals & workflow-definition repository (V2.2 §6.27).
 *
 * Parameterised SQL only. Workflow state lives in the shared schema
 * (cross-brand engine), filtered by the `business` column:
 *   shared.workflow_instances, shared.workflow_definitions, shared.workflow_decisions
 *
 * The engine (src/workflows/engine.js) owns transitions; this repo handles
 * the read surface (pending queue, instance detail) and definition authoring.
 */

"use strict";

const { ex: execFor } = require("../../config/database");
const INITIATOR_NAME = `
  COALESCE(ic.display_name, split_part(iu.email::text, '@', 1))`;

const INSTANCE_JOINS = `
  FROM shared.workflow_instances wi
  JOIN shared.workflow_definitions wd ON wd.workflow_id = wi.workflow_id
  LEFT JOIN shared.users iu            ON iu.user_id = wi.initiated_by
  LEFT JOIN shared.staff_profiles isp  ON isp.profile_id = iu.staff_profile_id
  LEFT JOIN shared.contacts ic         ON ic.contact_id = isp.contact_id`;

async function listPending({ client, business, page = 1, page_size = 25 }) {
  const exec = execFor(client);
  const offset = (page - 1) * page_size;

  const { rows: countRows } = await exec(
    `SELECT count(*)::int AS total
       FROM shared.workflow_instances
      WHERE business = $1 AND status = 'pending'`,
    [business],
  );

  const { rows } = await exec(
    `SELECT wi.instance_id, wi.workflow_id, wi.business,
            wi.reference_table, wi.reference_id, wi.current_stage,
            wi.status, wi.context, wi.initiated_by,
            ${INITIATOR_NAME} AS initiated_by_name,
            wi.initiated_at, wi.stage_entered_at, wi.stage_timeout_at,
            wd.name AS workflow_name, wd.trigger_module, wd.trigger_action,
            wd.definition
       ${INSTANCE_JOINS}
      WHERE wi.business = $1 AND wi.status = 'pending'
      ORDER BY wi.stage_entered_at ASC
      LIMIT $2 OFFSET $3`,
    [business, page_size, offset],
  );

  return { rows, total: countRows[0].total, page, page_size };
}

async function findInstance({ client, business, instance_id }) {
  const exec = execFor(client);
  const { rows } = await exec(
    `SELECT wi.*, ${INITIATOR_NAME} AS initiated_by_name,
            wd.name AS workflow_name, wd.trigger_module, wd.trigger_action,
            wd.definition
       ${INSTANCE_JOINS}
      WHERE wi.business = $1 AND wi.instance_id = $2
      LIMIT 1`,
    [business, instance_id],
  );
  return rows[0] || null;
}

async function listDecisions({ client, instance_id }) {
  const exec = execFor(client);
  const { rows } = await exec(
    `SELECT d.decision_id, d.stage_number, d.decided_by,
            COALESCE(c.display_name, split_part(u.email::text, '@', 1)) AS decided_by_name,
            d.decision, d.comments, d.decided_at
       FROM shared.workflow_decisions d
       LEFT JOIN shared.users u           ON u.user_id = d.decided_by
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c        ON c.contact_id = sp.contact_id
      WHERE d.instance_id = $1
      ORDER BY d.decided_at ASC`,
    [instance_id],
  );
  return rows;
}

// ── Definitions (the Builder read/author surface) ────────────────────────
async function listDefinitions({ client, business, include_inactive = false }) {
  const exec = execFor(client);
  const { rows } = await exec(
    `SELECT workflow_id, business, name, description, trigger_module,
            trigger_action, definition, is_active, version, created_by,
            created_at, updated_at
       FROM shared.workflow_definitions
      WHERE business = $1 ${include_inactive ? "" : "AND is_active = true"}
      ORDER BY trigger_module, trigger_action, version DESC`,
    [business],
  );
  return rows;
}

async function findDefinition({ client, business, workflow_id }) {
  const exec = execFor(client);
  const { rows } = await exec(
    `SELECT * FROM shared.workflow_definitions
      WHERE business = $1 AND workflow_id = $2 LIMIT 1`,
    [business, workflow_id],
  );
  return rows[0] || null;
}

async function createDefinition({
  client,
  business,
  name,
  description,
  trigger_module,
  trigger_action,
  definition,
  created_by,
}) {
  const exec = execFor(client);
  const { rows } = await exec(
    `SELECT COALESCE(max(version), 0) + 1 AS next_version
       FROM shared.workflow_definitions
      WHERE business = $1 AND name = $2`,
    [business, name],
  );
  const version = rows[0].next_version;
  const ins = await exec(
    `INSERT INTO shared.workflow_definitions
       (business, name, description, trigger_module, trigger_action,
        definition, version, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING *`,
    [
      business,
      name,
      description || null,
      trigger_module,
      trigger_action,
      JSON.stringify(definition),
      version,
      created_by || null,
    ],
  );
  return ins.rows[0];
}

/** Retire or re-activate a definition (the Builder's deactivate toggle). */
async function setDefinitionActive({
  client,
  business,
  workflow_id,
  is_active,
}) {
  const exec = execFor(client);
  const { rows } = await exec(
    `UPDATE shared.workflow_definitions
        SET is_active = $3, updated_at = now()
      WHERE business = $1 AND workflow_id = $2
      RETURNING *`,
    [business, workflow_id, is_active],
  );
  return rows[0] || null;
}

module.exports = {
  listPending,
  findInstance,
  listDecisions,
  listDefinitions,
  findDefinition,
  createDefinition,
  setDefinitionActive,
};
