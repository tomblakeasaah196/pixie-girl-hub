/**
 * Chief of Staff — per-turn trace repository (PR2-C, observability).
 *
 * One compact row per turn in shared.ai_cos_turn_traces (metadata only, no
 * message content). Written best-effort from the turn (never blocks a reply),
 * read by AI Control → Health & Logs. Parameterised SQL only.
 */

"use strict";

const { query, ex } = require("../../config/database");

async function insertTrace({ client, t }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.ai_cos_turn_traces
       (conversation_id, message_id, user_id, business, outcome, rounds,
        tool_calls, reads, vendors, models, input_tokens, output_tokens,
        total_tokens, latency_ms, plan_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING trace_id`,
    [
      t.conversation_id || null,
      t.message_id || null,
      t.user_id || null,
      t.business || null,
      t.outcome || "chat",
      t.rounds || 0,
      t.tool_calls || 0,
      t.reads || 0,
      t.vendors || [],
      t.models || [],
      t.input_tokens || 0,
      t.output_tokens || 0,
      t.total_tokens || 0,
      t.latency_ms || 0,
      t.plan_id || null,
    ],
  );
  return rows[0];
}

/** Recent traces, newest first — for the AI Control health view. */
async function listTraces({ business, user_id, limit = 50 }) {
  const where = [];
  const params = [];
  let i = 1;
  if (business) {
    where.push(`business = $${i++}`);
    params.push(business);
  }
  if (user_id) {
    where.push(`user_id = $${i++}`);
    params.push(user_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(Math.min(Number(limit) || 50, 200));
  const { rows } = await query(
    `SELECT trace_id, conversation_id, message_id, user_id, business, outcome,
            rounds, tool_calls, reads, vendors, models, input_tokens,
            output_tokens, total_tokens, latency_ms, plan_id, created_at
       FROM shared.ai_cos_turn_traces
       ${w}
      ORDER BY created_at DESC
      LIMIT $${i}`,
    params,
  );
  return rows;
}

module.exports = { insertTrace, listTraces };
