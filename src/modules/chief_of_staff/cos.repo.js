/**
 * Chief of Staff (PR3) — repository for batch plans.
 *
 * SHARED tables: ai_pending_plans (the batch-plan parent) + the plan-tagged
 * rows of ai_pending_actions (plan_id / plan_step). Conversations, messages,
 * and single-action helpers are reused from praxis.repo. Parameterised SQL only.
 */

"use strict";

const { query, ex } = require("../../config/database");

// ── Plans ──────────────────────────────────────────────────
async function createPlan({ client, p }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.ai_pending_plans
       (conversation_id, business, proposed_by_user_id, title, summary)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [p.conversation_id, p.business || null, p.proposed_by_user_id, p.title, p.summary],
  );
  return rows[0];
}

async function findPlan({ client, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.ai_pending_plans WHERE plan_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function listPlansForConversation({ conversation_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.ai_pending_plans
      WHERE conversation_id = $1 ORDER BY created_at DESC`,
    [conversation_id],
  );
  return rows;
}

async function setPlanStatus({ client, id, status, fields = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  const { rows } = await ex(client)(
    `UPDATE shared.ai_pending_plans SET ${sets.join(", ")}
      WHERE plan_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Plan steps (ai_pending_actions rows carrying plan_id/plan_step) ──
async function createPlanStep({ client, s }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.ai_pending_actions
       (conversation_id, message_id, proposed_by_user_id, action_id, action_key,
        business, method, route, payload, human_summary, confidence,
        plan_id, plan_step)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'{}'::jsonb),$10,$11,$12,$13)
     RETURNING *`,
    [
      s.conversation_id,
      s.message_id || null,
      s.proposed_by_user_id,
      s.action_id,
      s.action_key,
      s.business || null,
      s.method,
      s.route,
      s.payload ? JSON.stringify(s.payload) : null,
      s.human_summary,
      s.confidence === undefined || s.confidence === null ? 0.8 : s.confidence,
      s.plan_id,
      s.plan_step,
    ],
  );
  return rows[0];
}

async function listPlanSteps({ client, plan_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.ai_pending_actions
      WHERE plan_id = $1 ORDER BY plan_step ASC, created_at ASC`,
    [plan_id],
  );
  return rows;
}

async function setStepStatus({ client, id, status, fields = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(
      k === "execution_result" && v !== null && v !== undefined
        ? JSON.stringify(v)
        : v,
    );
  }
  const { rows } = await ex(client)(
    `UPDATE shared.ai_pending_actions SET ${sets.join(", ")}
      WHERE pending_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

module.exports = {
  createPlan,
  findPlan,
  listPlansForConversation,
  setPlanStatus,
  createPlanStep,
  listPlanSteps,
  setStepStatus,
};
