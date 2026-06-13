/**
 * BullMQ processor: ai-embed (J-8 / X-2 RAG corpus).
 *
 * Embeds a piece of source text and upserts the vector into shared.ai_embeddings
 * (keyed by source_table + source_id + sub_key + model + version). Enqueue with:
 *   enqueue("ai-embed", "embed", {
 *     source_table, source_id, source_text,
 *     source_sub_key?, business?, required_permissions?, sensitivity?
 *   })
 *
 * Degrades cleanly: with no embeddings provider configured (EMBEDDINGS_PROVIDER
 * = none / missing key) the job is a no-op, so the RAG pipeline stays dormant
 * until vendor creds are added — no crashes, no partial writes.
 */

"use strict";

const crypto = require("crypto");
const { logger } = require("../../config/logger");
const { query } = require("../../config/database");
const embeddings = require("../../services/embeddings.service");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const toVectorLiteral = (vec) => `[${vec.join(",")}]`;

module.exports = async function process(job) {
  const {
    source_table,
    source_id,
    source_text,
    source_sub_key = null,
    business = null,
    required_permissions = [],
    sensitivity = "normal",
  } = job.data || {};

  if (!embeddings.isConfigured()) {
    logger.info(
      { jobId: job.id },
      "ai-embed skipped — no embeddings provider configured",
    );
    return { skipped: true };
  }
  if (!source_table || !source_id || !source_text) {
    logger.warn(
      { jobId: job.id },
      "ai-embed: missing source_table/source_id/source_text",
    );
    return { skipped: true };
  }

  const [vector] = (await embeddings.embed(source_text)) || [];
  if (!vector) return { skipped: true };

  await query(
    `INSERT INTO shared.ai_embeddings
       (source_table, source_id, source_sub_key, embedding_model, embedding_dim,
        source_text, source_text_hash, embedding, business, required_permissions, sensitivity)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9,$10::text[],$11)
     ON CONFLICT (source_table, source_id, source_sub_key, embedding_model, embedding_version)
     DO UPDATE SET embedding = EXCLUDED.embedding,
                   source_text = EXCLUDED.source_text,
                   source_text_hash = EXCLUDED.source_text_hash,
                   embedding_dim = EXCLUDED.embedding_dim,
                   is_stale = false,
                   is_active = true`,
    [
      source_table,
      source_id,
      source_sub_key,
      embeddings.model(),
      vector.length,
      source_text,
      sha256(source_text),
      toVectorLiteral(vector),
      business,
      required_permissions,
      sensitivity,
    ],
  );

  logger.info(
    { jobId: job.id, source_table, source_id, dim: vector.length },
    "ai-embed stored",
  );
  return { embedded: true, dim: vector.length };
};
