/**
 * Sales (V2.2 §6.2) — HTTP controllers.
 */

"use strict";

const service = require("./sales.service");
const amendmentService = require("./amendment.service");
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
        // Orders is a working list — the Archive drawer asks for cancelled
        // rows explicitly via `status=cancelled`, everything else hides them.
        exclude_status: req.query.exclude_status,
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
// The order's Stylist Studio job — served THROUGH the order (sales.view), so a
// salesperson who can see the order sees its studio progress even though they
// are never the assigned stylist. `meta` sibling keeps the admin api client
// from unwrapping the {data:[...]} envelope past the array.
const getOrderServiceJob = async (req, res) => {
  const { jobs, progress } = await service.getOrderServiceJob({
    brand: req.brand,
    id: req.params.id,
  });
  // `progress` rides in meta so the order screen can say "2 of 3 items ready"
  // and warn before a manual "Order Ready" that would jump the queue. The data
  // array keeps its existing shape.
  res.json({ data: jobs, meta: { count: jobs.length, studio: progress } });
};
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
// Two-phase: without `confirm` the service dry-runs and may answer
// { requires_confirmation: true, short_lines } so the UI can warn that restoring
// brings those lines back as pre-orders. That answer is a legitimate result, not
// a failure, so it returns 200 — the client reads the flag rather than having to
// unpack a thrown ApiError body. Genuine refusals (not cancelled, deposit
// forfeited) still throw from the service and surface as 409.
const restoreOrder = async (req, res) =>
  res.json({
    data: await service.restoreOrder({
      ...base(req),
      id: req.params.id,
      confirm: req.body.confirm === true,
    }),
  });
// ── Change Order (§6.2 amendments) ──────────────────────────
// Preview writes nothing: the modal calls it as the operator edits the cart so
// the difference on screen is computed by the same code the commit will run.
const previewAmendment = async (req, res) =>
  res.json({
    data: await amendmentService.previewAmendment({
      brand: req.brand,
      id: req.params.id,
      input: req.body,
    }),
  });
// Two-phase, same contract as the archive restore: without
// `acknowledge_warnings` a consequential change answers 200 with
// { requires_confirmation: true, warnings } instead of writing. That is a
// legitimate result, not a failure — genuine refusals (completed order,
// pending cancellation, unknown variant) still throw and surface as 409.
const amendOrder = async (req, res) =>
  res.json({
    data: await amendmentService.amendOrder({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const listAmendments = async (req, res) => {
  const rows = await amendmentService.listAmendments({
    brand: req.brand,
    id: req.params.id,
  });
  res.json({ data: rows, meta: { count: rows.length } });
};

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
      // Order-first fallback: accept AND mint the order in one step, for sales
      // taken offline rather than through the quote's own pay link.
      convert: req.body.convert === true,
      sales_channel: req.body.sales_channel,
    }),
  });
const getQuotationPayLink = async (req, res) =>
  res.json({
    data: await paymentLink.quotationPayLink({
      brand: req.brand,
      quotation_id: req.params.quoId,
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
  getOrderServiceJob,
  receiptPdf,
  exportReport,
  createOrder,
  updateOrder,
  setOrderStatus,
  getStatusAutomations,
  addPayment,
  cancelOrder,
  restoreOrder,
  previewAmendment,
  amendOrder,
  listAmendments,
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
  getQuotationPayLink,
  rejectQuotation,
  convertQuotation,
  requestCancellation,
  listCancellations,
  getCancellation,
  approveCancellation,
  rejectCancellation,
};
