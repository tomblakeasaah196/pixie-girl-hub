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

module.exports = {
  listInvoices,
  getById,
  createInvoice,
  sendInvoice,
  recordPayment,
  voidInvoice,
  listCreditNotes,
  getCreditNote,
  createCreditNote,
  issueCreditNote,
  listReceipts,
  issueReceipt,
};
