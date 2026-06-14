/**
 * Sales (V2.2 §6.2) — HTTP controllers.
 */

"use strict";

const service = require("./sales.service");
const paymentLink = require("./payment-link.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function listOrders(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listOrders({
      brand: req.brand,
      filters: {
        status: req.query.status,
        contact_id: req.query.contact_id,
        sales_channel: req.query.sales_channel,
        sales_campaign_id: req.query.sales_campaign_id,
        q: req.query.q,
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
const receiptPdf = async (req, res) =>
  res.status(201).json({
    data: await service.receiptPdf({
      brand: req.brand,
      user: req.user,
      id: req.params.id,
    }),
  });
const createOrder = async (req, res) =>
  res.status(201).json({
    data: await service.createOrder({ ...base(req), input: req.body }),
  });
const updateOrder = async (req, res) =>
  res.json({
    data: await service.updateOrder({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
const addPayment = async (req, res) =>
  res.status(201).json({
    data: await service.addPayment({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const cancelOrder = async (req, res) =>
  res.json({
    data: await service.cancelOrder({ ...base(req), id: req.params.id }),
  });
const createPaymentLink = async (req, res) =>
  res.status(201).json({
    data: await paymentLink.createPaymentLink({
      brand: req.brand,
      order_id: req.params.id,
      amount_ngn: req.body.amount_ngn,
      currency: req.body.currency,
    }),
  });

// Quotations
async function listQuotations(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listQuotations({
      brand: req.brand,
      filters: { status: req.query.status, contact_id: req.query.contact_id },
      page,
      page_size,
    }),
  );
}
const getQuotation = async (req, res) =>
  res.json({
    data: await service.getQuotation({
      brand: req.brand,
      id: req.params.quoId,
    }),
  });
const createQuotation = async (req, res) =>
  res.status(201).json({
    data: await service.createQuotation({ ...base(req), input: req.body }),
  });
const sendQuotation = async (req, res) =>
  res.json({
    data: await service.sendQuotation({
      ...base(req),
      id: req.params.quoId,
      input: req.body,
    }),
  });
const acceptQuotation = async (req, res) =>
  res.json({
    data: await service.decideQuotation({
      ...base(req),
      id: req.params.quoId,
      decision: "accept",
    }),
  });
const rejectQuotation = async (req, res) =>
  res.json({
    data: await service.decideQuotation({
      ...base(req),
      id: req.params.quoId,
      decision: "reject",
      reason: req.body.reason,
    }),
  });
const convertQuotation = async (req, res) =>
  res.status(201).json({
    data: await service.convertQuotation({
      ...base(req),
      id: req.params.quoId,
      input: req.body,
    }),
  });

// Cancellation requests
const requestCancellation = async (req, res) =>
  res.status(201).json({
    data: await service.requestCancellation({
      ...base(req),
      order_id: req.params.id,
      input: req.body,
    }),
  });
async function listCancellations(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listCancellations({
      brand: req.brand,
      filters: { status: req.query.status, order_id: req.query.order_id },
      page,
      page_size,
    }),
  );
}
const getCancellation = async (req, res) =>
  res.json({
    data: await service.getCancellation({
      brand: req.brand,
      id: req.params.reqId,
    }),
  });
const approveCancellation = async (req, res) =>
  res.json({
    data: await service.reviewCancellation({
      ...base(req),
      id: req.params.reqId,
      decision: "approve",
      notes: req.body.notes,
    }),
  });
const rejectCancellation = async (req, res) =>
  res.json({
    data: await service.reviewCancellation({
      ...base(req),
      id: req.params.reqId,
      decision: "reject",
      notes: req.body.notes,
    }),
  });

module.exports = {
  listOrders,
  getById,
  receiptPdf,
  createOrder,
  updateOrder,
  addPayment,
  cancelOrder,
  createPaymentLink,
  listQuotations,
  getQuotation,
  createQuotation,
  sendQuotation,
  acceptQuotation,
  rejectQuotation,
  convertQuotation,
  requestCancellation,
  listCancellations,
  getCancellation,
  approveCancellation,
  rejectCancellation,
};
