/**
 * Invoicing subscriber — auto-generate the customer invoice when a sales order
 * is paid in full. Driven by the transactional outbox (H-2): runs post-commit
 * so the order is visible, with at-least-once delivery. Idempotent —
 * `createFromOrder` returns the existing invoice if one already exists
 * (`findByOrderId`), so it throws on real errors to let the outbox retry.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const salesRepo = require("../sales/sales.repo");
const service = require("./invoicing.service");
const documents = require("../../shared/documents/documents.service");
const { logger } = require("../../config/logger");

async function autoInvoice({ brand, order_id }) {
  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order) throw new Error(`order ${order_id} not found for auto-invoice`);
  const invoice = await service.createFromOrder({ brand, order, user_id: null });

  // Archive the invoice PDF into Documents. createFromOrder only writes the
  // RECORD — without this, auto-generated invoices never reach the Documents
  // vault (which is exactly what was missing). Best-effort + idempotent:
  //  • idempotent — order.paid is at-least-once and documents.store does NOT
  //    dedup, so we skip if a doc already exists for this invoice (otherwise a
  //    re-delivered event would archive a duplicate PDF);
  //  • best-effort — a render failure (e.g. PDF/Chromium unavailable) must NOT
  //    throw here, or it would fail the order.paid handler and loop forever. We
  //    log it instead so the renderer problem is visible.
  try {
    if (invoice && invoice.invoice_id) {
      const existing = await documents.listForReference({
        brand,
        reference_type: "invoice",
        reference_id: invoice.invoice_id,
      });
      if (!existing || existing.length === 0) {
        await service.invoicePdf({ brand, user: null, id: invoice.invoice_id });
      }
    }
  } catch (err) {
    logger.warn(
      { err: err.message, invoice_id: invoice && invoice.invoice_id, brand },
      "auto-invoice PDF archive failed — check PDF rendering (PDF_ENABLED / Chromium)",
    );
  }
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.paid", "invoicing", autoInvoice);
  logger.info(
    "invoicing subscribers registered (outbox order.paid → auto-invoice)",
  );
}

register();

module.exports = { register, autoInvoice };
