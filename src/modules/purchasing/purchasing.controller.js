/**
 * Purchasing & Procurement (V2.2 §6.8) — HTTP controllers.
 * Procurement (suppliers/RFQ/PO) → purchasing.service;
 * goods receipt + payables → purchasing.payables.service.
 */

"use strict";

const service = require("./purchasing.service");
const payables = require("./purchasing.payables.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// ── Suppliers ────────────────────────────────────────────
async function listSuppliers(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listSuppliers({
      brand: req.brand,
      filters: {
        is_active:
          req.query.is_active === undefined
            ? undefined
            : req.query.is_active === "true",
        supplier_type: req.query.supplier_type,
        on_hold:
          req.query.on_hold === undefined
            ? undefined
            : req.query.on_hold === "true",
        q: req.query.q,
      },
      page,
      page_size,
    }),
  );
}
const getSupplier = async (req, res) =>
  res.json({
    data: await service.getSupplier({
      brand: req.brand,
      id: req.params.supplierId,
    }),
  });
const createSupplier = async (req, res) =>
  res.status(201).json({
    data: await service.createSupplier({ ...base(req), input: req.body }),
  });
const updateSupplier = async (req, res) =>
  res.json({
    data: await service.updateSupplier({
      ...base(req),
      id: req.params.supplierId,
      input: req.body,
    }),
  });

const listSupplierContacts = async (req, res) =>
  res.json({
    data: await service.listSupplierContacts({
      brand: req.brand,
      supplier_id: req.params.supplierId,
    }),
  });
const addSupplierContact = async (req, res) =>
  res.status(201).json({
    data: await service.addSupplierContact({
      ...base(req),
      supplier_id: req.params.supplierId,
      input: req.body,
    }),
  });
const removeSupplierContact = async (req, res) =>
  res.json({
    data: await service.removeSupplierContact({
      ...base(req),
      supplier_id: req.params.supplierId,
      contact_link_id: req.params.linkId,
    }),
  });

const listSupplierProducts = async (req, res) =>
  res.json({
    data: await service.listSupplierProducts({
      brand: req.brand,
      supplier_id: req.params.supplierId,
      variant_id: req.query.variant_id,
    }),
  });
const addSupplierProduct = async (req, res) =>
  res.status(201).json({
    data: await service.addSupplierProduct({
      ...base(req),
      supplier_id: req.params.supplierId,
      input: req.body,
    }),
  });
const updateSupplierProduct = async (req, res) =>
  res.json({
    data: await service.updateSupplierProduct({
      ...base(req),
      link_id: req.params.linkId,
      input: req.body,
    }),
  });
const removeSupplierProduct = async (req, res) =>
  res.json({
    data: await service.removeSupplierProduct({
      ...base(req),
      link_id: req.params.linkId,
    }),
  });

// ── RFQ ──────────────────────────────────────────────────
async function listRfqs(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listRfqs({
      brand: req.brand,
      filters: { status: req.query.status },
      page,
      page_size,
    }),
  );
}
const getRfq = async (req, res) =>
  res.json({
    data: await service.getRfq({ brand: req.brand, id: req.params.rfqId }),
  });
const createRfq = async (req, res) =>
  res
    .status(201)
    .json({ data: await service.createRfq({ ...base(req), input: req.body }) });
const sendRfq = async (req, res) =>
  res.json({
    data: await service.sendRfq({ ...base(req), id: req.params.rfqId }),
  });
const recordQuote = async (req, res) =>
  res.status(201).json({
    data: await service.recordQuote({
      ...base(req),
      rfq_id: req.params.rfqId,
      input: req.body,
    }),
  });
const awardQuote = async (req, res) =>
  res.json({
    data: await service.awardQuote({
      ...base(req),
      rfq_id: req.params.rfqId,
      quote_id: req.body.quote_id,
    }),
  });

// ── Purchase orders ──────────────────────────────────────
async function listPos(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listPos({
      brand: req.brand,
      filters: {
        status: req.query.status,
        supplier_id: req.query.supplier_id,
        open: req.query.open === "true",
      },
      page,
      page_size,
    }),
  );
}
const getPo = async (req, res) =>
  res.json({
    data: await service.getPo({ brand: req.brand, id: req.params.poId }),
  });
const poPdf = async (req, res) =>
  res.status(201).json({
    data: await service.poPdf({
      brand: req.brand,
      user: req.user,
      id: req.params.poId,
    }),
  });
const createPo = async (req, res) =>
  res
    .status(201)
    .json({ data: await service.createPo({ ...base(req), input: req.body }) });
const submitPo = async (req, res) =>
  res.json({
    data: await service.submitPo({ ...base(req), id: req.params.poId }),
  });
const approvePo = async (req, res) =>
  res.json({
    data: await service.approvePo({
      ...base(req),
      id: req.params.poId,
      notes: req.body?.notes,
    }),
  });
const advancePo = async (req, res) =>
  res.json({
    data: await service.advancePo({
      ...base(req),
      id: req.params.poId,
      to_status: req.body.to_status,
      notes: req.body.notes,
      source: req.body.source,
    }),
  });
const cancelPo = async (req, res) =>
  res.json({
    data: await service.cancelPo({
      ...base(req),
      id: req.params.poId,
      reason: req.body?.reason,
    }),
  });

// ── GRN ──────────────────────────────────────────────────
async function listGrns(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await payables.listGrns({
      brand: req.brand,
      filters: { status: req.query.status, po_id: req.query.po_id },
      page,
      page_size,
    }),
  );
}
const getGrn = async (req, res) =>
  res.json({
    data: await payables.getGrn({ brand: req.brand, id: req.params.grnId }),
  });
const createGrn = async (req, res) =>
  res.status(201).json({
    data: await payables.createGrn({ ...base(req), input: req.body }),
  });
const postGrn = async (req, res) =>
  res.json({
    data: await payables.postGrn({ ...base(req), id: req.params.grnId }),
  });

// ── Supplier invoices ────────────────────────────────────
async function listSupplierInvoices(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await payables.listSupplierInvoices({
      brand: req.brand,
      filters: {
        status: req.query.status,
        supplier_id: req.query.supplier_id,
        po_id: req.query.po_id,
        unpaid: req.query.unpaid === "true",
      },
      page,
      page_size,
    }),
  );
}
const getSupplierInvoice = async (req, res) =>
  res.json({
    data: await payables.getSupplierInvoice({
      brand: req.brand,
      id: req.params.invoiceId,
    }),
  });
const createSupplierInvoice = async (req, res) =>
  res.status(201).json({
    data: await payables.createSupplierInvoice({
      ...base(req),
      input: req.body,
    }),
  });
const matchSupplierInvoice = async (req, res) =>
  res.json({
    data: await payables.matchSupplierInvoice({
      ...base(req),
      id: req.params.invoiceId,
    }),
  });
const approveSupplierInvoice = async (req, res) =>
  res.json({
    data: await payables.approveSupplierInvoice({
      ...base(req),
      id: req.params.invoiceId,
      override_reason: req.body?.override_reason,
    }),
  });
const paySupplierInvoice = async (req, res) =>
  res.status(201).json({
    data: await payables.paySupplierInvoice({
      ...base(req),
      id: req.params.invoiceId,
      input: req.body,
    }),
  });
const voidSupplierInvoice = async (req, res) =>
  res.json({
    data: await payables.voidSupplierInvoice({
      ...base(req),
      id: req.params.invoiceId,
      reason: req.body?.reason,
    }),
  });

module.exports = {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  listSupplierContacts,
  addSupplierContact,
  removeSupplierContact,
  listSupplierProducts,
  addSupplierProduct,
  updateSupplierProduct,
  removeSupplierProduct,
  listRfqs,
  getRfq,
  createRfq,
  sendRfq,
  recordQuote,
  awardQuote,
  listPos,
  getPo,
  poPdf,
  createPo,
  submitPo,
  approvePo,
  advancePo,
  cancelPo,
  listGrns,
  getGrn,
  createGrn,
  postGrn,
  listSupplierInvoices,
  getSupplierInvoice,
  createSupplierInvoice,
  matchSupplierInvoice,
  approveSupplierInvoice,
  paySupplierInvoice,
  voidSupplierInvoice,
};
