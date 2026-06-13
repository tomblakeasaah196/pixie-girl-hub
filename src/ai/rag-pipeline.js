/**
 * RAG retrieval pipeline (V2.2 §8.4) — thin facade.
 *
 * The canonical implementation lives in the Praxis layer: embeddings via
 * services/embeddings.service and the scope-filtered pgvector search in
 * modules/praxis_ai/praxis.repo.retrieveContext (which uses the real
 * shared.ai_embeddings columns: business + sensitivity). This module forwards
 * to those so `src/ai` stays a coherent public path.
 */

"use strict";

const embeddings = require("../services/embeddings.service");
const praxisRepo = require("../modules/praxis_ai/praxis.repo");

/** Embed a string → vector (number[]), or null if no provider configured. */
async function embedText(text) {
  const vecs = await embeddings.embed(text);
  return vecs && vecs[0] ? vecs[0] : null;
}

/**
 * Permission/entity-scoped similarity search. Returns the nearest active,
 * in-scope knowledge chunks for `queryText`.
 */
async function retrieve({ brand, queryText, topK = 5 }) {
  const vec = await embedText(queryText);
  if (!vec) return [];
  return praxisRepo.retrieveContext({
    queryVector: `[${vec.join(",")}]`,
    business: brand,
    limit: topK,
  });
}

module.exports = { embedText, retrieve };
