/**
 * One-off backfill: archive PDFs for documents that were generated as records
 * but never pushed into the Documents vault.
 *
 *   • Invoices — for every invoice with no 'invoice' document yet, render+store
 *     it (invoicing.service.invoicePdf). Idempotent: skips invoices that already
 *     have a document.
 *   • Receipts — for every fully-paid sales order, run archiveReceiptPdf, which
 *     itself skips orders that already have a receipt document (idempotent,
 *     best-effort).
 *
 * Requires the PDF renderer to work (PDF_ENABLED + Chromium). If it's down,
 * each item fails cleanly and is counted/logged — fix the renderer, then re-run
 * (safe to repeat; already-archived items are skipped).
 *
 * RUN (project root, same .env as the app):
 *   node scripts/backfill-document-archive.js
 *   BACKFILL_BRAND=faitlynhair node scripts/backfill-document-archive.js
 */

"use strict";

const {
  initDatabase,
  closeDatabase,
  query,
} = require("../src/config/database");
const { refreshBrands, VALID } = require("../src/config/brands");
const documents = require("../src/shared/documents/documents.service");
const invoicing = require("../src/modules/invoicing/invoicing.service");
const sales = require("../src/modules/sales/sales.service");

(async () => {
  try {
    await initDatabase();
    await refreshBrands(); // populate the brand registry (VALID)

    const only = process.env.BACKFILL_BRAND || null;
    const brands = [...VALID].filter((b) => !only || b === only);
    if (!brands.length) {
      console.warn("No brands to process.");
      return;
    }

    for (const brand of brands) {
      console.warn(`\n=== ${brand} ===`);

      // ── Invoices ──────────────────────────────────────────
      const { rows: invs } = await query(
        `SELECT invoice_id FROM ${brand}.invoices ORDER BY created_at`,
      );
      let invOk = 0;
      let invSkip = 0;
      let invFail = 0;
      for (const { invoice_id } of invs) {
        try {
          const existing = await documents.listForReference({
            brand,
            reference_type: "invoice",
            reference_id: invoice_id,
          });
          if ((existing || []).some((d) => d.document_type === "invoice")) {
            invSkip += 1;
            continue;
          }
          await invoicing.invoicePdf({ brand, user: null, id: invoice_id });
          invOk += 1;
        } catch (e) {
          invFail += 1;
          console.warn(`  invoice ${invoice_id} FAILED: ${e.message}`);
        }
      }
      console.warn(
        `Invoices: archived ${invOk}, already had ${invSkip}, failed ${invFail} (of ${invs.length})`,
      );

      // ── Receipts (fully-paid orders) ──────────────────────
      // archiveReceiptPdf is idempotent (skips if a receipt doc exists) and
      // best-effort (never throws — it logs its own render failures).
      const { rows: orders } = await query(
        `SELECT order_id FROM ${brand}.sales_orders
          WHERE total_ngn > 0 AND balance_due_ngn <= 0
          ORDER BY created_at`,
      );
      for (const { order_id } of orders) {
        await sales.archiveReceiptPdf({ brand, order_id });
      }
      console.warn(
        `Receipts: ran archive for ${orders.length} fully-paid order(s) ` +
          "(idempotent — see warnings above for any render failures).",
      );
    }

    console.warn(
      "\nBackfill complete. If you saw failures, they're almost certainly the PDF " +
        "renderer (Chromium) — fix it and re-run; archived items are skipped.",
    );
  } catch (e) {
    console.error("backfill failed:", e.message);
    process.exitCode = 1;
  } finally {
    try {
      await closeDatabase();
    } catch {
      // ignore close errors
    }
    process.exit(process.exitCode || 0);
  }
})();
