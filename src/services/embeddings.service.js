/**
 * Embeddings provider (J-8 / X-2 RAG). Env-driven, OpenAI-compatible, OFF by
 * default.
 *
 *   EMBEDDINGS_PROVIDER   none | openai | deepseek | voyage
 *   EMBEDDINGS_API_KEY    provider key
 *   EMBEDDINGS_API_BASE_URL optional override (default https://api.openai.com/v1)
 *   EMBEDDINGS_MODEL      default 'text-embedding-3-small' (1536-dim, matches the
 *                         ai_embeddings.vector(1536) column)
 *
 * `embed(texts)` returns number[][] (one vector per input) or `null` when no
 * provider is configured, so the ai-embed worker no-ops cleanly. Errors throw.
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");

const DEFAULT_BASE = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  voyage: "https://api.voyageai.com/v1",
};

function isConfigured() {
  return (
    config.EMBEDDINGS_PROVIDER !== "none" && Boolean(config.EMBEDDINGS_API_KEY)
  );
}

function model() {
  return config.EMBEDDINGS_MODEL;
}

/**
 * @param {string|string[]} input
 * @returns {Promise<number[][]|null>}
 */
async function embed(input) {
  if (!isConfigured()) return null;
  const texts = Array.isArray(input) ? input : [input];
  if (!texts.length) return [];

  const base =
    config.EMBEDDINGS_API_BASE_URL || DEFAULT_BASE[config.EMBEDDINGS_PROVIDER];
  const { data } = await axios.post(
    `${base}/embeddings`,
    { model: config.EMBEDDINGS_MODEL, input: texts },
    {
      headers: { Authorization: `Bearer ${config.EMBEDDINGS_API_KEY}` },
      timeout: 30000,
    },
  );
  if (!data || !Array.isArray(data.data))
    throw new Error("embeddings provider: unexpected response shape");
  // Preserve input order.
  return data.data
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding);
}

module.exports = { isConfigured, embed, model };
