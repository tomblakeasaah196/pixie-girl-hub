#!/usr/bin/env node
"use strict";

/**
 * Build / refresh the Praxis RAG corpus (§8.4). Embeds every active knowledge
 * chunk (Product Description, SOPs, training, entity context) and every
 * AI-enabled action-catalogue entry into shared.ai_embeddings, reusing the
 * verified ai-embed processor (embed + upsert keyed by source + model + version,
 * so re-running re-embeds — e.g. after switching embedding models).
 *
 * Requires a configured embeddings provider:
 *   EMBEDDINGS_PROVIDER=openai|deepseek|voyage  EMBEDDINGS_API_KEY=...
 * With none configured it exits cleanly (RAG stays dormant; Praxis still runs,
 * it just retrieves no context).
 *
 *   npm run rag:reembed
 */

require("dotenv").config();

const {
  initDatabase,
  query,
  closeDatabase,
} = require("../src/config/database");
const embeddings = require("../src/services/embeddings.service");
const embedJob = require("../src/jobs/processors/ai-embed-processor");

// Reuse the production ai-embed processor (embed + upsert into ai_embeddings).
const embedOne = (data) =>
  embedJob({ id: `corpus:${data.source_table}:${data.source_id}`, data });

async function main() {
  await initDatabase();

  if (!embeddings.isConfigured()) {
    /// eslint-disable-next-line no-console
    console.error(
      "EMBEDDINGS_PROVIDER is not configured — set it (+ EMBEDDINGS_API_KEY) " +
        "before building the RAG corpus. Nothing to do.",
    );
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`Embedding model: ${embeddings.model()}`);

  // 1) Knowledge chunks — the PD/SOP/training/entity-context corpus.
  const { rows: chunks } = await query(
    `SELECT chunk_id, business, content, required_permissions, sensitivity
       FROM shared.ai_knowledge_chunks
      WHERE is_active = true`,
  );
  let nChunks = 0;
  for (const c of chunks) {
    const r = await embedOne({
      source_table: "ai_knowledge_chunks",
      source_id: c.chunk_id,
      source_text: c.content,
      business: c.business || null,
      required_permissions: c.required_permissions || [],
      sensitivity: c.sensitivity || "normal",
    });
    if (r && r.embedded) nChunks += 1;
  }

  // 2) Action catalogue — so Praxis can match "what can I do" by description.
  const { rows: actions } = await query(
    `SELECT action_id, title, description, required_permission
       FROM shared.ai_action_catalogue
      WHERE is_active = true AND ai_enabled = true`,
  );
  let nActions = 0;
  for (const a of actions) {
    const r = await embedOne({
      source_table: "ai_action_catalogue",
      source_id: a.action_id,
      source_text: `${a.title}: ${a.description}`,
      business: null, // actions are cross-brand; entity_scope is enforced elsewhere
      required_permissions: a.required_permission
        ? [a.required_permission]
        : [],
      sensitivity: "normal",
    });
    if (r && r.embedded) nActions += 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    `RAG corpus embedded — knowledge_chunks: ${nChunks}/${chunks.length}, actions: ${nActions}/${actions.length}`,
  );
}

main()
  .catch((err) => {
    /// eslint-disable-next-line no-console
    console.error("rag-reembed failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeDatabase();
    } catch {
      /* ignore */
    }
  });
