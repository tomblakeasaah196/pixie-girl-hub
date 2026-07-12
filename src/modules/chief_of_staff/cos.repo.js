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
       (conversation_id, business, proposed_by_user_id, title, summary, is_complete)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,true)) RETURNING *`,
    [
      p.conversation_id,
      p.business || null,
      p.proposed_by_user_id,
      p.title,
      p.summary,
      p.is_complete === undefined ? null : p.is_complete,
    ],
  );
  return rows[0];
}

/**
 * Anchor a plan to the assistant message that proposed it, so the chat UI
 * renders the card directly under that bubble instead of at thread end.
 */
async function setPlanAnchor({ client, id, message_id }) {
  const { rows } = await ex(client)(
    `UPDATE shared.ai_pending_plans SET anchor_message_id = $2
      WHERE plan_id = $1 RETURNING *`,
    [id, message_id],
  );
  return rows[0] || null;
}

/**
 * Flip a plan's build state after a /continue round. Extends the approval
 * window too — a plan the CEO is actively building must not expire under her.
 */
async function setPlanBuildState({ client, id, is_complete }) {
  const { rows } = await ex(client)(
    `UPDATE shared.ai_pending_plans
        SET is_complete = $2,
            expires_at  = GREATEST(expires_at, now() + INTERVAL '60 minutes')
      WHERE plan_id = $1
      RETURNING *`,
    [id, is_complete],
  );
  return rows[0] || null;
}

/**
 * Cancel every OTHER still-proposed plan in a conversation (and their steps)
 * when a new plan is proposed — stale duplicate cards must not stay
 * approvable, or the CEO ends up confirming the same goal twice.
 * @returns {Promise<string[]>} the superseded plan_ids
 */
async function supersedeOtherProposedPlans({ client, conversation_id, except_plan_id }) {
  const { rows } = await ex(client)(
    `UPDATE shared.ai_pending_plans
        SET status = 'cancelled'
      WHERE conversation_id = $1 AND plan_id <> $2 AND status = 'proposed'
      RETURNING plan_id`,
    [conversation_id, except_plan_id],
  );
  const ids = rows.map((r) => r.plan_id);
  if (ids.length) {
    await ex(client)(
      `UPDATE shared.ai_pending_actions
          SET status = 'cancelled'
        WHERE plan_id = ANY($1::uuid[]) AND status IN ('proposed','confirmed')`,
      [ids],
    );
  }
  return ids;
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

/**
 * Replace a step's payload (and its regenerated summary) while it can still
 * change: 'proposed' (pre-approval review) or 'failed' (fix-and-retry — e.g.
 * rename a duplicate goal title). An edited FAILED step resets to 'confirmed'
 * with its error cleared, so "Retry remaining" re-runs it with the new
 * payload. The status guard is in the WHERE so an edit can never race an
 * executing plan — rowcount 0 means "too late", surfaced by the service.
 */
async function updateStepPayload({ client, id, plan_id, payload, human_summary }) {
  const { rows } = await ex(client)(
    `UPDATE shared.ai_pending_actions
        SET payload         = COALESCE($3,'{}'::jsonb),
            human_summary   = $4,
            status          = CASE WHEN status = 'failed' THEN 'confirmed' ELSE status END,
            execution_error = NULL,
            executed_at     = CASE WHEN status = 'failed' THEN NULL ELSE executed_at END
      WHERE pending_id = $1 AND plan_id = $2 AND status IN ('proposed','failed')
      RETURNING *`,
    [id, plan_id, payload ? JSON.stringify(payload) : null, human_summary],
  );
  return rows[0] || null;
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
  setPlanAnchor,
  setPlanBuildState,
  supersedeOtherProposedPlans,
  createPlanStep,
  listPlanSteps,
  setStepStatus,
  updateStepPayload,
};
