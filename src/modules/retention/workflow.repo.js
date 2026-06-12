/**
 * Automated retention workflows repository (F-4 / PD §6.23). Per-brand tables
 * retention_workflow_rules + retention_workflow_executions.
 */

"use strict";

const { query } = require("../../config/database");
const { VALID } = require("../../config/brands");

const t = (b, tbl) => {
  if (!VALID.has(b)) throw new Error(`Invalid brand: ${b}`);
  return `${b}.${tbl}`;
};
const ex = (c) => (c ? c.query.bind(c) : query);

const RULE_COLS = [
  "rule_key",
  "display_name",
  "description",
  "trigger_type",
  "trigger_conditions",
  "wait_minutes",
  "action_type",
  "action_config",
  "email_template_id",
  "coupon_template",
  "segment_id",
  "max_executions_per_customer",
  "rate_limit_days",
  "is_active",
];
const JSON_COLS = new Set([
  "trigger_conditions",
  "action_config",
  "coupon_template",
]);

function buildCols(src) {
  const f = [];
  const ph = [];
  const p = [];
  let i = 1;
  for (const c of RULE_COLS) {
    if (src[c] === undefined) continue;
    f.push(c);
    ph.push(JSON_COLS.has(c) ? `$${i++}::jsonb` : `$${i++}`);
    p.push(JSON_COLS.has(c) ? JSON.stringify(src[c]) : src[c]);
  }
  return { f, ph, p, next: i };
}

// ── Rules ─────────────────────────────────────────────────
async function createRule({ brand, input, user_id }) {
  const { f, ph, p, next } = buildCols(input);
  f.push("created_by");
  ph.push(`$${next}`);
  p.push(user_id || null);
  const { rows } = await query(
    `INSERT INTO ${t(brand, "retention_workflow_rules")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}

async function listRules({ brand, only_active }) {
  const w = only_active ? "WHERE is_active = true" : "";
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "retention_workflow_rules")} ${w} ORDER BY created_at DESC`,
  );
  return rows;
}

async function getRule({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "retention_workflow_rules")} WHERE rule_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function updateRule({ brand, id, patch }) {
  const keys = Object.keys(patch).filter((k) => RULE_COLS.includes(k));
  if (keys.length === 0) return getRule({ brand, id });
  const sets = keys.map((k, i) =>
    JSON_COLS.has(k) ? `${k} = $${i + 2}::jsonb` : `${k} = $${i + 2}`,
  );
  const vals = keys.map((k) =>
    JSON_COLS.has(k) ? JSON.stringify(patch[k]) : patch[k],
  );
  const { rows } = await query(
    `UPDATE ${t(brand, "retention_workflow_rules")} SET ${sets.join(", ")}, updated_at = now()
      WHERE rule_id = $1 RETURNING *`,
    [id, ...vals],
  );
  return rows[0] || null;
}

async function setRuleActive({ brand, id, is_active }) {
  const { rows } = await query(
    `UPDATE ${t(brand, "retention_workflow_rules")} SET is_active = $2, updated_at = now()
      WHERE rule_id = $1 RETURNING *`,
    [id, is_active],
  );
  return rows[0] || null;
}

async function findActiveByTrigger({ client, brand, trigger_type }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "retention_workflow_rules")}
      WHERE is_active = true AND trigger_type = $1`,
    [trigger_type],
  );
  return rows;
}

// ── Executions ────────────────────────────────────────────
async function countRecentForCustomer({
  client,
  brand,
  rule_id,
  contact_id,
  days,
}) {
  if (!contact_id) return 0;
  const { rows } = await ex(client)(
    `SELECT count(*)::int AS c FROM ${t(brand, "retention_workflow_executions")}
      WHERE rule_id = $1 AND contact_id = $2
        AND created_at >= now() - ($3 || ' days')::interval`,
    [rule_id, contact_id, String(days)],
  );
  return rows[0].c;
}

async function enqueueExecution({ client, brand, exec }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "retention_workflow_executions")}
       (rule_id, contact_id, trigger_event_type, trigger_source_table, trigger_source_id, status)
     VALUES ($1,$2,$3,$4,$5,'queued') RETURNING *`,
    [
      exec.rule_id,
      exec.contact_id || null,
      exec.trigger_event_type,
      exec.trigger_source_table || null,
      exec.trigger_source_id || null,
    ],
  );
  return rows[0];
}

async function claimDueExecutions({ client, brand, limit }) {
  const { rows } = await ex(client)(
    `WITH due AS (
       SELECT e.execution_id
         FROM ${t(brand, "retention_workflow_executions")} e
         JOIN ${t(brand, "retention_workflow_rules")} r ON r.rule_id = e.rule_id
        WHERE e.status = 'queued'
          AND e.queued_at + (r.wait_minutes || ' minutes')::interval <= now()
        ORDER BY e.queued_at
        FOR UPDATE OF e SKIP LOCKED
        LIMIT $1
     )
     UPDATE ${t(brand, "retention_workflow_executions")} e
        SET status = 'executing', executed_at = now()
       FROM due WHERE e.execution_id = due.execution_id
     RETURNING e.*`,
    [limit],
  );
  return rows;
}

async function completeExecution({
  brand,
  id,
  status,
  result_summary,
  generated_records,
  failure_reason,
}) {
  await query(
    `UPDATE ${t(brand, "retention_workflow_executions")}
        SET status = $2, executed_at = now(), result_summary = $3::jsonb,
            generated_records = $4::jsonb, failure_reason = $5
      WHERE execution_id = $1`,
    [
      id,
      status,
      result_summary ? JSON.stringify(result_summary) : null,
      generated_records ? JSON.stringify(generated_records) : null,
      failure_reason || null,
    ],
  );
}

async function bumpRuleRun({ brand, rule_id }) {
  await query(
    `UPDATE ${t(brand, "retention_workflow_rules")}
        SET total_executions = total_executions + 1, last_run_at = now()
      WHERE rule_id = $1`,
    [rule_id],
  );
}

module.exports = {
  createRule,
  listRules,
  getRule,
  updateRule,
  setRuleActive,
  findActiveByTrigger,
  countRecentForCustomer,
  enqueueExecution,
  claimDueExecutions,
  completeExecution,
  bumpRuleRun,
};
