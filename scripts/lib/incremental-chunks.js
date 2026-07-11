"use strict";

/**
 * Incremental sync of a "slice" of shared.ai_knowledge_chunks (e.g. all docs/%
 * or all schema/%). Instead of deleting the whole slice and re-inserting it
 * (which mints new chunk_ids every run and forces a full re-embed), this keeps
 * a chunk's row — and therefore its embedding — whenever its content is
 * unchanged. Only new or changed chunks are written; removed ones are pruned.
 *
 * Identity is source_ref (stable, e.g. 'docs/RBAC.md#3' or 'schema/shared.users').
 * Change detection is content_hash. On a content change the row is updated in
 * place and its stale embedding is deleted, so `rag:reembed --missing` re-embeds
 * exactly that one chunk. Nothing else is re-embedded.
 *
 * Returns { inserted, updated, unchanged, deleted } for logging.
 */

const crypto = require("crypto");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const tokenEstimate = (s) => Math.max(1, Math.ceil((s || "").length / 4));

async function syncSlice({ query, prefixes, chunks }) {
  const patterns = Array.isArray(prefixes) ? prefixes : [prefixes];

  // Existing rows in this slice: source_ref → { chunk_id, content_hash }.
  const whereRef = patterns.map((_, i) => `source_ref LIKE $${i + 1}`).join(" OR ");
  const { rows: existing } = await query(
    `SELECT chunk_id, source_ref, content_hash
       FROM shared.ai_knowledge_chunks
      WHERE ${whereRef}`,
    patterns,
  );
  const byRef = new Map(existing.map((r) => [r.source_ref, r]));

  const seen = new Set();
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const c of chunks) {
    const content = c.content;
    const hash = sha256(content);
    seen.add(c.source_ref);
    const ex = byRef.get(c.source_ref);

    if (ex && ex.content_hash === hash) {
      unchanged += 1; // identical → keep row + embedding, do nothing
      continue;
    }

    if (ex) {
      // Content changed: update in place and invalidate the old embedding.
      await query(
        `UPDATE shared.ai_knowledge_chunks
            SET source_type = $2, business = $3, title = $4, content = $5,
                token_count = $6, sensitivity = $7, content_hash = $8,
                is_active = true, ingested_at = now()
          WHERE chunk_id = $1`,
        [
          ex.chunk_id,
          c.source_type,
          c.business ?? null,
          (c.title || "").slice(0, 240),
          content,
          tokenEstimate(content),
          c.sensitivity || "normal",
          hash,
        ],
      );
      await query(
        `DELETE FROM shared.ai_embeddings
          WHERE source_table = 'ai_knowledge_chunks' AND source_id = $1`,
        [ex.chunk_id],
      );
      updated += 1;
    } else {
      await query(
        `INSERT INTO shared.ai_knowledge_chunks
           (source_type, source_ref, business, title, content, token_count,
            required_permissions, sensitivity, content_hash)
         VALUES ($1,$2,$3,$4,$5,$6,'{}',$7,$8)`,
        [
          c.source_type,
          c.source_ref,
          c.business ?? null,
          (c.title || "").slice(0, 240),
          content,
          tokenEstimate(content),
          c.sensitivity || "normal",
          hash,
        ],
      );
      inserted += 1;
    }
  }

  // Prune chunks that vanished from the source (and their embeddings).
  const staleIds = existing
    .filter((r) => !seen.has(r.source_ref))
    .map((r) => r.chunk_id);
  let deleted = 0;
  if (staleIds.length) {
    await query(
      `DELETE FROM shared.ai_embeddings
        WHERE source_table = 'ai_knowledge_chunks' AND source_id = ANY($1::uuid[])`,
      [staleIds],
    );
    const del = await query(
      `DELETE FROM shared.ai_knowledge_chunks WHERE chunk_id = ANY($1::uuid[])`,
      [staleIds],
    );
    deleted = del.rowCount;
  }

  return { inserted, updated, unchanged, deleted };
}

module.exports = { syncSlice, sha256, tokenEstimate };
