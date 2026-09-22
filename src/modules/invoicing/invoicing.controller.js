/**
 * Invoicing & Billing (V2.2 §6.5) — HTTP controllers.
 */

"use strict";

const service = require("./invoicing.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function listInvoices(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listInvoices({
      brand: req.brand,
      filters: {
        status: req.query.status,
        contact_id: req.query.contact_id,
        order_id: req.query.order_id,
        overdue: req.query.overdue === "true",
        // Free-text search (invoice # / customer / order # / line
        // descriptions) — the messaging invoice picker greps on these.
        search: req.query.search || undefined,
      },
      page,
      page_size,
    }),
  );
}
const getById = async (req, res) =>
  res.json({
    data: await service.getById({ brand: req.brand, id: req.params.id }),
  });
const createInvoice = async (req, res) =>
  res.status(201).json({
    data: await service.createManual({ ...base(req), input: req.body }),
  });
const sendInvoice = async (req, res) =>
  res.json({
    data: await service.send({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const recordPayment = async (req, res) =>
  res.status(201).json({
    data: await service.recordPayment({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const voidInvoice = async (req, res) =>
  res.json({
    data: await service.voidInvoice({ ...base(req), id: req.params.id }),
  });
const invoicePdf = async (req, res) =>
  res.status(201).json({
    data: await service.invoicePdf({
      brand: req.brand,
      user: req.user,
      id: req.params.id,
    }),
  });
const getDelivery = async (req, res) =>
  res.json({
    data: await service.getDelivery({ brand: req.brand, id: req.params.id }),
  });

// Public (no auth): customer-facing document views. The links are opened
// straight from an email/WhatsApp/DM — no auth, no brand header; the
// unguessable UUID IS the credential.
const viewPublicInvoice = async (req, res) => {
  // The customer now opens the canonical document link (the branded PDF).
  // Every link already in the wild (old emails, WhatsApp notes, DMs) 301s
  // there permanently — nothing a customer has saved stops working.
  res.redirect(301, `/api/public/documents/invoice/${req.params.id}`);
};
const viewPublicReceipt = async (req, res) => {
  res.redirect(301, `/api/public/documents/receipt/${req.params.id}`);
};

/** Serve the public invoice PDF (GET /i/:id). See service.publicInvoicePdf. */
const viewPublicInvoicePdf = async (req, res) => {
  const { buffer, filename } = await service.publicInvoicePdf({
    id: req.params.id,
  });
  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `inline; filename="${filename}"`);
  // The document is per-invoice and mutable (a reissue re-renders it) —
  // never let a CDN/browser cache a stale statement.
  res.set("Cache-Control", "private, no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.send(buffer);
};

/** Serve the public receipt PDF (GET /r/:id). */
const viewPublicReceiptPdf = async (req, res) => {
  const { buffer, filename } = await service.publicReceiptPdf({
    id: req.params.id,
  });
  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `inline; filename="${filename}"`);
  res.set("Cache-Control", "private, no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.send(buffer);
};

// Credit notes
async function listCreditNotes(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listCreditNotes({
      brand: req.brand,
      filters: { status: req.query.status, invoice_id: req.query.invoice_id },
      page,
      page_size,
    }),
  );
}
const getCreditNote = async (req, res) =>
  res.json({
    data: await service.getCreditNote({
      brand: req.brand,
      id: req.params.cnId,
    }),
  });
const createCreditNote = async (req, res) =>
  res.status(201).json({
    data: await service.createCreditNote({ ...base(req), input: req.body }),
  });
const issueCreditNote = async (req, res) =>
  res.json({
    data: await service.issueCreditNote({ ...base(req), id: req.params.cnId }),
  });

// Receipts
const listReceipts = async (req, res) =>
  res.json({
    data: await service.listReceipts({
      brand: req.brand,
      invoice_id: req.params.id,
    }),
  });
const issueReceipt = async (req, res) =>
  res.status(201).json({
    data: await service.issueReceipt({ ...base(req), input: req.body }),
  });
const sendReceipt = async (req, res) =>
  res.json({
    data: await service.sendReceipt({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const getReceiptDelivery = async (req, res) =>
  res.json({
    data: await service.getReceiptDelivery({
      brand: req.brand,
      id: req.params.id,
    }),
  });
// Reminders (F-10)
const listReminders = async (req, res) =>
  res.json({
    data: await service.listReminders({
      brand: req.brand,
      invoice_id: req.params.id,
    }),
  });
const cancelReminder = async (req, res) =>
  res.json({
    data: await service.cancelReminder({
      ...base(req),
      invoice_id: req.params.id,
      reminder_id: req.params.reminderId,
    }),
  });

// ── Document settings (Invoicing → Settings tab) ─────────────
const getDocumentSettings = async (req, res) =>
  res.json({
    data: await service.getDocumentSettings({ brand: req.brand }),
  });
const updateDocumentSettings = async (req, res) =>
  res.json({
    data: await service.updateDocumentSettings({
      ...base(req),
      input: req.body,
    }),
  });

module.exports = {
  listInvoices,
  getById,
  createInvoice,
  sendInvoice,
  recordPayment,
  voidInvoice,
  invoicePdf,
  getDelivery,
  viewPublicInvoice,
  viewPublicInvoicePdf,
  getDocumentSettings,
  updateDocumentSettings,
  listCreditNotes,
  getCreditNote,
  createCreditNote,
  issueCreditNote,
  listReceipts,
  issueReceipt,
  sendReceipt,
  getReceiptDelivery,
  viewPublicReceipt,
  viewPublicReceiptPdf,
  listReminders,
  cancelReminder,
};
