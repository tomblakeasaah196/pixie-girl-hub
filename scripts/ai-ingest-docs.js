#!/usr/bin/env node
"use strict";

/**
 * Ingest the system-knowledge docs into shared.ai_knowledge_chunks so Praxis
 * has a grounding corpus (the "what is this system / how does it work" layer).
 *
 * This is the MISSING first half of the RAG pipeline. The corpus table was only
 * seeded with a few narrow slices (comms policy, brand identity, campaign help),
 * so Praxis had almost no knowledge of the platform and hallucinated. This
 * chunks a curated set of docs/*.md into knowledge chunks; run `rag:reembed`
 * afterwards (or `ai:reindex`, which does both) to turn them into vectors.
 *
 * Idempotent: it deletes and re-inserts the `docs/%` slice each run, leaving the
 * migration-seeded chunks (comms/campaign/brand) untouched.
 *
 *   npm run ai:ingest-docs      # populate knowledge chunks from docs/
 *   npm run ai:reindex          # ingest docs + embed the whole corpus
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  initDatabase,
  query,
  closeDatabase,
} = require("../src/config/database");

const DOCS_DIR = path.join(__dirname, "..", "docs");

// Curated whitelist — the docs that DESCRIBE the system (not audits/plans/TODOs).
// Edit this list to add/remove sources. `type` maps to ai_knowledge_chunks.source_type.
const MANIFEST = [
  { file: "ARCHITECTURE.md", type: "product_description" },
  { file: "ENTITY_ISOLATION.md", type: "entity_context" },
  { file: "RBAC.md", type: "product_description" },
  { file: "WORKFLOWS.md", type: "product_description" },
  { file: "AI_PRAXIS.md", type: "product_description" },
  { file: "API_CONVENTIONS.md", type: "product_description" },
  { file: "FRONTEND_SCREEN_REQUIREMENTS.md", type: "product_description" },
  { file: "SCHEMA.md", type: "schema_doc" },
];

// A hand-written orientation chunk so the model always has the big picture even
// before similarity search picks specific sections.
const SYSTEM_OVERVIEW = `Pixie Girl Hub is a single multi-entity ERP/CRM/e-commerce platform serving two Nigerian beauty businesses from one system: Pixie Girl Global (business key "pixiegirl") and Faitlynhair (business key "faitlynhair"). Data is isolated per business via separate PostgreSQL schemas; every request carries a brand context. Praxis is the in-app AI operations assistant: it reads business data freely (via a curated query catalogue), proposes any data-changing action as a confirm-first pending action, and only ever acts within the requesting user's permissions. Core modules: Sales (orders, quotations, POS/quick-sale), Catalogue (products, variants, styled products, pricing), Stock (inventory levels, movements, transfers, alerts), CRM (contacts, deals/pipeline, 360 timeline), Invoicing (invoices, receipts, credit notes, AR ageing), Retention (loyalty, rewards, earn rules, referrals, coupons, bundles), Purchasing (suppliers, purchase orders for China imports, GRNs, supplier invoices), Logistics (deliveries — dispatch vs pickup — couriers, proof of delivery), Production/Stylist Studio (service jobs, QC, wig accountability, chemical reconciliation), HR & Payroll (staff, attendance, leave, queries, performance, payroll, commissions), Cash Requests (staff cash/advance requests with finance→CEO approval and disbursement), plus Accounting, Expenses, Pricing, Intercompany, Retail Partners, Storefront Studio, Sales Campaigns and AI Control.`;

const CHUNK_TARGET = 1400; // aim ~1.4k chars/chunk (well under model limits)
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const tokenEstimate = (s) => Math.max(1, Math.ceil(s.length / 4));

/**
 * Split markdown into titled chunks: break on headings, then split any long
 * section on blank lines so no chunk is enormous.
 */
function chunkMarkdown(fileLabel, text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let heading = fileLabel;
  let buf = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) sections.push({ heading, body });
    buf = [];
  };
  for (const line of lines) {
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      flush();
      heading = `${fileLabel} › ${h[2].trim()}`;
      continue;
    }
    buf.push(line);
  }
  flush();

  // Sub-split long sections on paragraph boundaries.
  const chunks = [];
  for (const s of sections) {
    if (s.body.length <= CHUNK_TARGET) {
      chunks.push(s);
      continue;
    }
    const paras = s.body.split(/\n\s*\n/);
    let acc = "";
    for (const p of paras) {
      if ((acc + "\n\n" + p).length > CHUNK_TARGET && acc) {
        chunks.push({ heading: s.heading, body: acc.trim() });
        acc = p;
      } else {
        acc = acc ? `${acc}\n\n${p}` : p;
      }
    }
    if (acc.trim()) chunks.push({ heading: s.heading, body: acc.trim() });
  }
  return chunks.filter((c) => c.body.length >= 40); // drop trivial fragments
}

async function upsertChunk({ source_type, source_ref, title, content }) {
  await query(
    `INSERT INTO shared.ai_knowledge_chunks
       (source_type, source_ref, business, title, content, token_count,
        required_permissions, sensitivity, content_hash)
     VALUES ($1,$2,NULL,$3,$4,$5,'{}','normal',$6)`,
    [
      source_type,
      source_ref,
      title.slice(0, 240),
      content,
      tokenEstimate(content),
      sha256(content),
    ],
  );
}

async function main() {
  await initDatabase();

  // Clean re-ingest of only the docs slice (+ the synthetic overview), so this
  // is idempotent and leaves migration-seeded corpus rows alone.
  const del = await query(
    `DELETE FROM shared.ai_knowledge_chunks
      WHERE source_ref LIKE 'docs/%' OR source_ref = 'system/overview'`,
  );
  // eslint-disable-next-line no-console
  console.log(`Cleared ${del.rowCount} previously-ingested doc chunks.`);

  // 1) System overview.
  await upsertChunk({
    source_type: "entity_context",
    source_ref: "system/overview",
    title: "Pixie Girl Hub — system overview",
    content: SYSTEM_OVERVIEW,
  });
  let total = 1;

  // 2) Curated docs.
  for (const { file, type } of MANIFEST) {
    const full = path.join(DOCS_DIR, file);
    if (!fs.existsSync(full)) {
      /// eslint-disable-next-line no-console
      console.warn(`  skip (missing): ${file}`);
      continue;
    }
    const text = fs.readFileSync(full, "utf8");
    const label = file.replace(/\.md$/, "");
    const chunks = chunkMarkdown(label, text);
    let n = 0;
    for (let i = 0; i < chunks.length; i++) {
      await upsertChunk({
        source_type: type,
        source_ref: `docs/${file}#${i}`,
        title: chunks[i].heading,
        content: chunks[i].body,
      });
      n++;
    }
    total += n;
    // eslint-disable-next-line no-console
    console.log(`  ${file}: ${n} chunks`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `\nIngested ${total} knowledge chunks. Now run "npm run rag:reembed" ` +
      `(needs EMBEDDINGS_PROVIDER + key) to vectorise them.`,
  );
}

main()
  .catch((err) => {
    /// eslint-disable-next-line no-console
    console.error("ai-ingest-docs failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeDatabase();
    } catch {
      /* ignore */
    }
  });
