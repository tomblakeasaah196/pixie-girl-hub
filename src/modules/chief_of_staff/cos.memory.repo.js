/**
 * Chief of Staff (PR5) — RAG memory repository.
 *
 * CoS memory REUSES the shared knowledge corpus (shared.ai_knowledge_chunks +
 * shared.ai_embeddings) rather than a new table — one chunk per subject
 * (goal / milestone / note / decision), keyed by (source_type, source_ref) so a
 * re-index UPDATES in place and keeps a STABLE chunk_id (the embedding row is
 * keyed off it, so the vector upserts cleanly too).
 *
 * CoS chunks are written sensitivity='restricted' with the owning user in
 * metadata.user_id, so:
 *   - Praxis's own retrieval (retrieveContext floors at 'normal') never surfaces
 *     the CEO's private planning notes; and
 *   - CoS retrieval scopes to the owner + business (retrieveCosChunks), the RAG
 *     isolation the spec requires (user A cannot read user B's goal memory).
 *
 * Parameterised SQL only.
 */

"use strict";

const crypto = require("crypto");
const { query } = require("../../config/database");

const COS_SOURCE_TYPES = [
  "cos_goal",
  "cos_milestone",
  "cos_note",
  "cos_decision",
  // A 👎 correction from the CEO — retrievable so a relevant past correction can
  // resurface semantically, on top of the recency-based persona injection.
  "cos_correction",
];
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
// Cheap token estimate — the column is NOT NULL and only used for budgeting.
const estimateTokens = (s) => Math.max(1, Math.ceil(String(s).length / 4));

/**
 * Find-or-update-or-insert a CoS knowledge chunk. Returns
 * { chunk_id, changed } — `changed` is true when the content actually moved
 * (or the row is new), so the caller only re-embeds when it needs to.
 */
async function upsertChunk({
  source_type,
  source_ref,
  business,
  title,
  content,
  metadata = {},
  sensitivity = "restricted",
  ingested_by = null,
}) {
  const content_hash = sha256(content);
  const token_count = estimateTokens(content);
  const meta = JSON.stringify(metadata || {});

  const { rows: existing } = await query(
    `SELECT chunk_id, content_hash FROM shared.ai_knowledge_chunks
      WHERE source_type = $1 AND source_ref = $2
        AND business IS NOT DISTINCT FROM $3
      LIMIT 1`,
    [source_type, source_ref, business || null],
  );

  if (existing[0]) {
    const changed = existing[0].content_hash !== content_hash;
    await query(
      `UPDATE shared.ai_knowledge_chunks
          SET title = $2, content = $3, token_count = $4, content_hash = $5,
              metadata = $6::jsonb, sensitivity = $7, is_active = true,
              ingested_at = now()
        WHERE chunk_id = $1`,
      [existing[0].chunk_id, title, content, token_count, content_hash, meta, sensitivity],
    );
    return { chunk_id: existing[0].chunk_id, changed };
  }

  const { rows } = await query(
    `INSERT INTO shared.ai_knowledge_chunks
       (source_type, source_ref, business, title, content, token_count,
        sensitivity, metadata, ingested_by, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
     RETURNING chunk_id`,
    [source_type, source_ref, business || null, title, content, token_count, sensitivity, meta, ingested_by, content_hash],
  );
  return { chunk_id: rows[0].chunk_id, changed: true };
}

/** Remove a subject's chunk(s) AND their embedding rows. Returns the count. */
async function deleteChunksForSubject({ source_type, source_ref }) {
  const { rows } = await query(
    `DELETE FROM shared.ai_knowledge_chunks
      WHERE source_type = $1 AND source_ref = $2
      RETURNING chunk_id`,
    [source_type, source_ref],
  );
  for (const r of rows) {
    await query(
      `DELETE FROM shared.ai_embeddings
        WHERE source_table = 'ai_knowledge_chunks' AND source_id = $1`,
      [r.chunk_id],
    );
  }
  return rows.length;
}

/**
 * Cosine-nearest CoS chunks for a query vector, scoped to the owning user +
 * business. Only CoS source_types are searched (never the general corpus), and
 * the user filter is what keeps one CEO's memory out of another's retrieval.
 * `queryVector` is a pgvector literal '[..]'.
 */
async function retrieveCosChunks({ queryVector, business, user_id, topK = 6, minScore = 0 }) {
  const { rows } = await query(
    `SELECT k.chunk_id, k.source_type, k.source_ref, k.title, k.content,
            1 - (e.embedding <=> $1::vector) AS score
       FROM shared.ai_embeddings e
       JOIN shared.ai_knowledge_chunks k
         ON e.source_table = 'ai_knowledge_chunks' AND k.chunk_id = e.source_id
      WHERE e.is_active = true
        AND k.is_active = true
        AND k.source_type = ANY($2::text[])
        AND (k.business IS NULL OR k.business = $3)
        AND k.metadata->>'user_id' = $4
        AND 1 - (e.embedding <=> $1::vector) >= $6
      ORDER BY e.embedding <=> $1::vector
      LIMIT $5`,
    [queryVector, COS_SOURCE_TYPES, business || null, String(user_id), topK, minScore],
  );
  return rows;
}

module.exports = {
  upsertChunk,
  deleteChunksForSubject,
  retrieveCosChunks,
  COS_SOURCE_TYPES,
  estimateTokens,
};
