/**
 * Delivery-fee review (PR 3, Care & Accessories) — controller.
 *
 * Thin HTTP layer over delivery-review.service. Split out of sales.controller.js
 * so the retail fee lifecycle is reviewable as one unit; mounted on the same
 * /api/v1/sales router behind the same `sales` permission key.
 *
 * Permission tiers (least privilege — the guide requires an explicit answer to
 * "which role can approve a manual fee change"):
 *   sales.view    read the queue and a review's detail/audit trail
 *   sales.edit    open a review and propose a calculated fee (no money moves)
 *   sales.approve record consent, verify a top-up or refund, confirm and settle
 *                 — i.e. anything that changes what the customer owes. This is
 *                 the same manager tier that guards the Flexi Pay settings.
 * There is no anonymous or customer-facing route to any of this.
 */

"use strict";

const service = require("./delivery-review.service");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

const parsePagination = (q) => ({
  page: Math.max(1, parseInt(q.page || "1", 10) || 1),
  page_size: Math.min(100, Math.max(1, parseInt(q.page_size || "25", 10) || 25)),
});

const listQueue = async (req, res) => {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listQueue({
      brand: req.brand,
      status: req.query.status || null,
      page,
      page_size,
    }),
  );
};

const getReview = async (req, res) =>
  res.json({
    data: await service.getReview({ brand: req.brand, order_id: req.params.id }),
  });

const openReview = async (req, res) =>
  res.json({
    data: await service.openReview({
      ...base(req),
      order_id: req.params.id,
      calculation_basis: req.body.calculation_basis,
    }),
  });

const proposeFee = async (req, res) =>
  res.json({
    data: await service.proposeFee({
      ...base(req),
      order_id: req.params.id,
      proposed_fee_ngn: req.body.proposed_fee_ngn,
      calculation_basis: req.body.calculation_basis,
    }),
  });

const recordConsent = async (req, res) =>
  res.json({
    data: await service.recordConsent({
      ...base(req),
      order_id: req.params.id,
      accepted: req.body.accepted,
      channel: req.body.channel,
      reference: req.body.reference,
      note: req.body.note,
    }),
  });

const verifyTopUp = async (req, res) =>
  res.json({
    data: await service.verifyTopUp({
      ...base(req),
      order_id: req.params.id,
      payment_id: req.body.payment_id,
    }),
  });

const verifyRefund = async (req, res) =>
  res.json({
    data: await service.verifyRefund({
      ...base(req),
      order_id: req.params.id,
      credit_note_id: req.body.credit_note_id,
      refund_payment_id: req.body.refund_payment_id,
      note: req.body.note,
    }),
  });

const confirmFee = async (req, res) =>
  res.json({
    data: await service.confirmFee({
      ...base(req),
      order_id: req.params.id,
      calculation_basis: req.body.calculation_basis,
    }),
  });

const routeDecline = async (req, res) =>
  res.json({
    data: await service.routeDecline({
      ...base(req),
      order_id: req.params.id,
      note: req.body.note,
    }),
  });

module.exports = {
  listQueue,
  getReview,
  openReview,
  proposeFee,
  recordConsent,
  verifyTopUp,
  verifyRefund,
  confirmFee,
  routeDecline,
};
