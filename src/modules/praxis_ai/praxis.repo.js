/**
 * Praxis AI Agent (V2.2 §6.29) — repository.
 *
 * SHARED tables: ai_conversations, ai_messages, ai_pending_actions,
 * ai_run_steps. The pending-action table is the human-in-the-loop safety
 * gate: every write Praxis proposes lands here in 'proposed' and only
 * executes after explicit confirmation. Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (c) => (c ? c.query.bind(c) : query);

// ── Conversations ──────────────────────────────────────────
async function createConversation({ c }) {
  const { rows } = await query(
    `INSERT INTO shared.ai_conversations (user_id, business, title, is_voice_started)
     VALUES ($1,$2,$3,COALESCE($4,false)) RETURNING *`,
    [
      c.user_id,
      c.business || null,
      c.title || null,
      c.is_voice_started === undefined ? null : c.is_voice_started,
    ],
  );
  return rows[0];
}
async function listConversations({ user_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.ai_conversations
      WHERE user_id = $1 AND is_archived = false
      ORDER BY last_activity_at DESC`,
    [user_id],
  );
  return rows;
}
async function findConversation({ client, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.ai_conversations WHERE conversation_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function touchConversation({ client, id, tokens = 0, cost_ngn = 0 }) {
  await ex(client)(
    `UPDATE shared.ai_conversations
        SET last_activity_at = now(),
            message_count = message_count + 1,
            total_tokens = total_tokens + $2,
            total_cost_ngn = total_cost_ngn + $3
      WHERE conversation_id = $1`,
    [id, tokens, cost_ngn],
  );
}
async function archiveConversation({ id, user_id }) {
  const { rows } = await query(
    `UPDATE shared.ai_conversations SET is_archived = true, archived_at = now()
      WHERE conversation_id = $1 AND user_id = $2 RETURNING conversation_id`,
    [id, user_id],
  );
  return rows[0] || null;
}

// ── Messages ───────────────────────────────────────────────
async function insertMessage({ client, m }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.ai_messages
       (conversation_id, role, input_mode, transcribed_text, source_audio_url,
        content, pending_action_id, input_tokens, output_tokens, provider, model)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      m.conversation_id,
      m.role,
      m.input_mode || null,
      m.transcribed_text || null,
      m.source_audio_url || null,
      m.content,
      m.pending_action_id || null,
      m.input_tokens || null,
      m.output_tokens || null,
      m.provider || null,
      m.model || null,
    ],
  );
  return rows[0];
}
async function listMessages({ conversation_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.ai_messages WHERE conversation_id = $1 ORDER BY created_at`,
    [conversation_id],
  );
  return rows;
}

// ── Pending actions (the confirm gate) ─────────────────────
async function createPendingAction({ client, p }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.ai_pending_actions
       (conversation_id, message_id, proposed_by_user_id, action_id, action_key,
        business, method, route, payload, human_summary, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'{}'::jsonb),$10,$11)
     RETURNING *`,
    [
      p.conversation_id,
      p.message_id || null,
      p.proposed_by_user_id,
      p.action_id,
      p.action_key,
      p.business || null,
      p.method,
      p.route,
      p.payload ? JSON.stringify(p.payload) : null,
      p.human_summary,
      p.confidence,
    ],
  );
  return rows[0];
}
async function findPendingAction({ client, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.ai_pending_actions WHERE pending_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function listPendingActions({ user_id, conversation_id, status }) {
  const where = [];
  const params = [];
  let i = 1;
  if (user_id) {
    where.push(`proposed_by_user_id = $${i++}`);
    params.push(user_id);
  }
  if (conversation_id) {
    where.push(`conversation_id = $${i++}`);
    params.push(conversation_id);
  }
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT * FROM shared.ai_pending_actions ${w} ORDER BY created_at DESC`,
    params,
  );
  return rows;
}
async function setPendingStatus({ client, id, status, fields = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(k === "execution_result" && v !== null ? JSON.stringify(v) : v);
  }
  const { rows } = await ex(client)(
    `UPDATE shared.ai_pending_actions SET ${sets.join(", ")}
      WHERE pending_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── RAG retrieval (X-2) ────────────────────────────────────
// Cosine-nearest active embeddings, scoped to the business and to
// non-sensitive material. `queryVector` is a pgvector literal string '[..]'.
async function retrieveContext({ queryVector, business, limit = 6 }) {
  const { rows } = await query(
    `SELECT source_table, source_id, source_text,
            1 - (embedding <=> $1::vector) AS score
       FROM shared.ai_embeddings
      WHERE is_active = true
        AND sensitivity IN ('public','normal')
        AND (business IS NULL OR business = $2)
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [queryVector, business || null, limit],
  );
  return rows;
}

// ── Run steps (trace) ──────────────────────────────────────
async function insertRunStep({ client, s }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.ai_run_steps
       (conversation_id, message_id, agent, step_number, step_type, input, output,
        matched_action_id, tokens_used, cost_ngn, duration_ms, status, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,'completed'),$13)
     RETURNING *`,
    [
      s.conversation_id,
      s.message_id || null,
      s.agent,
      s.step_number,
      s.step_type,
      s.input ? JSON.stringify(s.input) : null,
      s.output ? JSON.stringify(s.output) : null,
      s.matched_action_id || null,
      s.tokens_used || null,
      s.cost_ngn || null,
      s.duration_ms || null,
      s.status || null,
      s.error_message || null,
    ],
  );
  return rows[0];
}
async function listRunSteps({ conversation_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.ai_run_steps WHERE conversation_id = $1 ORDER BY occurred_at`,
    [conversation_id],
  );
  return rows;
}

module.exports = {
  createConversation,
  listConversations,
  findConversation,
  touchConversation,
  archiveConversation,
  insertMessage,
  listMessages,
  createPendingAction,
  findPendingAction,
  listPendingActions,
  setPendingStatus,
  retrieveContext,
  insertRunStep,
  listRunSteps,
};
