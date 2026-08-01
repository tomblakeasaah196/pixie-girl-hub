/**
 * Chief of Staff — feedback repository (Phase 1: the training loop).
 *
 * Reuses shared.ai_message_feedback (the same table Praxis's 👍/👎 uses — CoS
 * messages live in the same shared.ai_messages), one upsertable row per
 * (message, user). A 👎 that carries a correction is ALSO turned into a durable
 * CoS memory chunk (cos.memory.indexCorrection) so it steers future turns.
 *
 * recentCorrections feeds the persona a compact "standing instructions" block
 * by recency (no embeddings needed), so behavioural feedback ("stop suggesting
 * 8am meetings") reaches the prompt on the very next turn. Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

/** Insert or update the up/down signal + optional comment for a message. */
async function upsertFeedback({
  message_id,
  conversation_id,
  user_id,
  rating,
  comment,
  taught_chunk_id,
}) {
  const { rows } = await query(
    `INSERT INTO shared.ai_message_feedback
       (message_id, conversation_id, user_id, rating, comment, taught_chunk_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (message_id, user_id)
     DO UPDATE SET rating = EXCLUDED.rating,
                   comment = EXCLUDED.comment,
                   taught_chunk_id = COALESCE(EXCLUDED.taught_chunk_id,
                                              shared.ai_message_feedback.taught_chunk_id),
                   updated_at = now()
     RETURNING message_id, rating, comment, taught_chunk_id`,
    [message_id, conversation_id || null, user_id, rating, comment || null, taught_chunk_id || null],
  );
  return rows[0];
}

/**
 * The CEO's most recent corrections (👎 + comment), newest first — injected
 * into the persona as standing instructions.
 */
async function recentCorrections({ user_id, limit = 5 }) {
  const { rows } = await query(
    `SELECT comment
       FROM shared.ai_message_feedback
      WHERE user_id = $1
        AND rating = 'down'
        AND comment IS NOT NULL
        AND btrim(comment) <> ''
      ORDER BY updated_at DESC
      LIMIT $2`,
    [user_id, Math.min(Number(limit) || 5, 20)],
  );
  return rows.map((r) => r.comment);
}

/** Existing rating/comment per message for a conversation (to hydrate the UI). */
async function listForConversation({ conversation_id, user_id }) {
  const { rows } = await query(
    `SELECT message_id, rating, comment
       FROM shared.ai_message_feedback
      WHERE conversation_id = $1 AND user_id = $2`,
    [conversation_id, user_id],
  );
  return rows;
}

module.exports = { upsertFeedback, recentCorrections, listForConversation };
