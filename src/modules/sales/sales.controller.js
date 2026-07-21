/**
 * Sales (V2.2 §6.2) — HTTP controllers.
 */

"use strict";

const service = require("./sales.service");
const paymentLink = require("./payment-link.service");
const paymentSettings = require("./payment-settings.service");
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
        fee_pending: req.query.fee_pending === "true" ? true : undefined,
        part_paid: req.query.part_paid === "true" ? true : undefined,
        is_preorder: req.query.preorder === "true" ? true : undefined,
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
async function exportReport(req, res) {
  const { buffer, filename } = await service.exportSalesReport({
    ...base(req),
    filters: {
      from: req.query.from,
      to: req.query.to,
      status: req.query.status,
      sales_channel: req.query.sales_channel,
    },
  });
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.send(buffer);
}
const createOrder = async (req, res) => {
  const order = await service.createOrder({
    ...base(req),
    // Staff attribution (Performance → Insights): whoever raises the order
    // here (Quick Sale) is the closer by default. A supervisor logging a
    // sale for a colleague can override via `closed_by_user_id` in the body.
    input: {
      ...req.body,
      closed_by_user_id: req.body.closed_by_user_id || req.user?.user_id || null,
    },
  });
  // Surface the pre-order result (000086) so Quick Sale can confirm to staff
  // that a line went in as made-to-order. `_preorder` is non-enumerable on the
  // order, so attach it explicitly (spread drops it otherwise).
  const pre =
    order && order._preorder && order._preorder.is_preorder
      ? order._preorder
      : null;
  res.status(201).json({ data: pre ? { ...order, preorder: pre } : order });
};
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
const setOrderStatus = async (req, res) =>
  res.json({
    data: await service.setOrderStatus({
      ...base(req),
      id: req.params.id,
      status: req.body.status,
    }),
  });
// Live on/off state of the customer messages each manual status move fires —
// powers the order drawer's impact modal (definite "will send"/"won't send").
const getStatusAutomations = async (req, res) =>
  res.json({
    data: await service.getStatusAutomationStates({ brand: req.brand }),
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
const quotationPdf = async (req, res) =>
  res.status(201).json({
    data: await service.quotationPdf({
      brand: req.brand,
      user: req.user,
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

const setDeliveryFee = async (req, res) =>
  res.json({
    data: await service.setDeliveryFee({
      ...base(req),
      id: req.params.id,
      fee_ngn: req.body.fee_ngn,
    }),
  });

// Flexi Pay settings (Sales → Payments tab)
const getPaymentSettings = async (req, res) =>
  res.json({ data: await paymentSettings.getSettings(req.brand) });
const updatePaymentSettings = async (req, res) =>
  res.json({
    data: await paymentSettings.updateSettings({
      ...base(req),
      patch: req.body,
    }),
  });

module.exports = {
  listOrders,
  getById,
  receiptPdf,
  exportReport,
  createOrder,
  updateOrder,
  setOrderStatus,
  getStatusAutomations,
  addPayment,
  cancelOrder,
  createPaymentLink,
  setDeliveryFee,
  getPaymentSettings,
  updatePaymentSettings,
  listQuotations,
  getQuotation,
  quotationPdf,
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
