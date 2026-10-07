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
const {
  initDatabase,
  query,
  closeDatabase,
} = require("../src/config/database");
const { syncSlice } = require("./lib/incremental-chunks");

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
  // The whole-system navigation guide: every module → route → permission → tabs
  // → "how do I…" tasks. This is what lets Praxis answer "where do I create a
  // cash request?" with a real in-app link. Kept in this manifest so every
  // deploy re-embeds it (ai:reindex) and it never drifts from the codebase —
  // see README "Praxis knowledge base (keep it seeded)".
  { file: "PRAXIS_KNOWLEDGE_BASE.md", type: "product_description" },
  // Order amendments ("Change Order"): the repair path for an order recorded
  // against the wrong product. Staff ask about this in the language of the
  // mistake ("we sold her the wrong wig, she's already paid"), so Praxis needs
  // the full mechanism — what moves in stock, the books, the invoice, Studio
  // and Logistics — not just the button's location.
  { file: "ORDER_AMENDMENTS.md", type: "product_description" },
  // Pre-order stock deduction: when the stock a pre-order is waiting on arrives,
  // the Hub draws it for paid pre-orders and reserves it for unpaid ones,
  // paid-first then oldest-first, and offers an email-only "your pre-order has
  // arrived" notice. Staff ask "when does a pre-order get fulfilled / how do I
  // tell the customer it's in?", so Praxis needs the mechanism + the button.
  { file: "PREORDER_STOCK_DEDUCTION.md", type: "product_description" },
  // Sales collections + the monthly money KPI: "which active customers owe us
  // money?", "how much did we actually take this month?", and why the raw
  // positive-balance total is not a receivables figure. Staff ask about money in
  // exactly these terms, so Praxis needs the semantics (Outstanding Balance vs
  // Partially Paid vs Cash Collected vs Order Value) and where each lives.
  { file: "SALES_COLLECTIONS_AND_CASH_KPI.md", type: "product_description" },
];

// A hand-written orientation chunk so the model always has the big picture even
// before similarity search picks specific sections.
const SYSTEM_OVERVIEW = `Pixie Girl Hub is a single multi-entity ERP/CRM/e-commerce platform serving two Nigerian beauty businesses from one system: Pixie Girl Global (business key "pixiegirl") and Faitlynhair (business key "faitlynhair"). Data is isolated per business via separate PostgreSQL schemas; every request carries a brand context. Praxis is the in-app AI operations assistant: it reads business data freely (via a curated query catalogue), proposes any data-changing action as a confirm-first pending action, and only ever acts within the requesting user's permissions. Core modules: Sales (orders, quotations, POS/quick-sale), Catalogue (products, variants, styled products, pricing), Stock (inventory levels, movements, transfers, alerts), CRM (contacts, deals/pipeline, 360 timeline), Invoicing (invoices, receipts, credit notes, AR ageing), Retention (loyalty, rewards, earn rules, referrals, coupons, bundles), Purchasing (suppliers, purchase orders for China imports, GRNs, supplier invoices), Logistics (deliveries — dispatch vs pickup — couriers, proof of delivery), Production/Stylist Studio (service jobs, QC, wig accountability, chemical reconciliation), HR & Payroll (staff, attendance, leave, queries, performance, payroll, commissions), Cash Requests (staff cash/advance requests with finance→CEO approval and disbursement), plus Accounting, Expenses, Pricing, Intercompany, Retail Partners, Storefront Studio, Sales Campaigns and AI Control.`;

const CHUNK_TARGET = 1400; // aim ~1.4k chars/chunk (well under model limits)

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

async function main() {
  await initDatabase();

  // Build the full desired slice in memory, then sync incrementally: unchanged
  // chunks keep their row + embedding, only new/changed ones are written, and
  // removed sections are pruned. (No more delete-all + re-insert + full
  // re-embed each run.)
  const desired = [
    {
      source_type: "entity_context",
      source_ref: "system/overview",
      title: "Pixie Girl Hub — system overview",
      content: SYSTEM_OVERVIEW,
    },
  ];

  for (const { file, type } of MANIFEST) {
    const full = path.join(DOCS_DIR, file);
    if (!fs.existsSync(full)) {
      // eslint-disable-next-line no-console
      console.warn(`  skip (missing): ${file}`);
      continue;
    }
    const text = fs.readFileSync(full, "utf8");
    const label = file.replace(/\.md$/, "");
    const chunks = chunkMarkdown(label, text);
    chunks.forEach((c, i) => {
      desired.push({
        source_type: type,
        source_ref: `docs/${file}#${i}`,
        title: c.heading,
        content: c.body,
      });
    });
    // eslint-disable-next-line no-console
    console.log(`  ${file}: ${chunks.length} chunks`);
  }

  const res = await syncSlice({
    query,
    prefixes: ["docs/%", "system/overview"],
    chunks: desired,
  });

  // eslint-disable-next-line no-console
  console.log(
    `\nDocs synced: ${res.inserted} new, ${res.updated} changed, ` +
      `${res.unchanged} unchanged, ${res.deleted} removed. ` +
      `Run "npm run rag:reembed -- --missing" to embed only new/changed chunks.`,
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
