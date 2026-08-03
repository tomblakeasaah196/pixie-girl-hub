/**
 * Logistics & Delivery (V2.2 §6.10) — HTTP controllers.
 */

"use strict";

const service = require("./logistics.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// ── couriers ─────────────────────────────────────────────
const listCouriers = async (req, res) =>
  res.json({
    data: await service.listCouriers({
      brand: req.brand,
      is_active:
        req.query.is_active === undefined
          ? undefined
          : req.query.is_active === "true",
    }),
  });
const getCourier = async (req, res) =>
  res.json({
    data: await service.getCourier({ brand: req.brand, id: req.params.id }),
  });
const createCourier = async (req, res) =>
  res.status(201).json({
    data: await service.createCourier({ ...base(req), input: req.body }),
  });
const updateCourier = async (req, res) =>
  res.json({
    data: await service.updateCourier({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });

// ── deliveries ───────────────────────────────────────────
async function listDeliveries(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listDeliveries({
      brand: req.brand,
      filters: {
        status: req.query.status,
        courier_id: req.query.courier_id,
        order_id: req.query.order_id,
        is_pay_on_delivery:
          req.query.is_pay_on_delivery === undefined
            ? undefined
            : req.query.is_pay_on_delivery === "true",
        // Comma-separated, so the Queue/Active tabs can ask for their own
        // status sets in one call.
        status_in: req.query.status_in
          ? String(req.query.status_in).split(",").filter(Boolean)
          : undefined,
        readiness: req.query.readiness,
        has_delivery_loss:
          req.query.has_delivery_loss === undefined
            ? undefined
            : req.query.has_delivery_loss === "true",
        cost_missing: req.query.cost_missing === "true",
        completed_by: req.query.completed_by,
        delivered_from: req.query.delivered_from,
        delivered_to: req.query.delivered_to,
      },
      page,
      page_size,
    }),
  );
}
const getDelivery = async (req, res) =>
  res.json({
    data: await service.getDelivery({ brand: req.brand, id: req.params.id }),
  });
const deliveryLetter = async (req, res) =>
  res.status(201).json({
    data: await service.deliveryLetterPdf({
      brand: req.brand,
      user: req.user,
      id: req.params.id,
    }),
  });
const createDelivery = async (req, res) =>
  res.status(201).json({
    data: await service.createDelivery({ ...base(req), input: req.body }),
  });
const bookDelivery = async (req, res) =>
  res.json({
    data: await service.bookDelivery({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const advanceDelivery = async (req, res) =>
  res.json({
    data: await service.advanceDelivery({
      ...base(req),
      id: req.params.id,
      to_status: req.body.to_status,
      notes: req.body.notes,
      source: req.body.source,
    }),
  });
const cancelDelivery = async (req, res) =>
  res.json({
    data: await service.cancelDelivery({
      ...base(req),
      id: req.params.id,
      reason: req.body?.reason,
    }),
  });
const recordAttempt = async (req, res) =>
  res.status(201).json({
    data: await service.recordAttempt({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const recordProof = async (req, res) =>
  res.status(201).json({
    data: await service.recordProof({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const listWebhookEvents = async (req, res) =>
  res.json({
    data: await service.listWebhookEvents({
      brand: req.brand,
      delivery_id: req.params.id,
    }),
  });
const notifyDelivered = async (req, res) =>
  res.json({
    data: await service.notifyDelivered({ ...base(req), id: req.params.id }),
  });
const notifyBooked = async (req, res) =>
  res.json({
    data: await service.notifyBooked({ ...base(req), id: req.params.id }),
  });
const deliveryComms = async (req, res) =>
  res.json({
    data: await service.deliveryCommsView({
      brand: req.brand,
      id: req.params.id,
    }),
  });

// ── courier webhook ingest ───────────────────────────────
const ingestCourierEvent = async (req, res) =>
  res.status(201).json({
    data: await service.ingestCourierEvent({
      brand: req.brand,
      input: req.body,
    }),
  });

// ── POD collections ──────────────────────────────────────
async function listPodCollections(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listPodCollections({
      brand: req.brand,
      filters: { status: req.query.status, courier_id: req.query.courier_id },
      page,
      page_size,
    }),
  );
}
const getPodCollection = async (req, res) =>
  res.json({
    data: await service.getPodCollection({
      brand: req.brand,
      id: req.params.id,
    }),
  });
const createPodCollection = async (req, res) =>
  res.status(201).json({
    data: await service.createPodCollection({
      ...base(req),
      input: req.body,
    }),
  });
const markPodCollected = async (req, res) =>
  res.json({
    data: await service.markPodCollected({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const remitPodCollection = async (req, res) =>
  res.json({
    data: await service.remitPodCollection({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const reconcilePodCollection = async (req, res) =>
  res.json({
    data: await service.reconcilePodCollection({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });

// ── delivery costs + reconciliation ──────────────────────
const addDeliveryCost = async (req, res) =>
  res.status(201).json({
    data: await service.addDeliveryCost({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const removeDeliveryCost = async (req, res) =>
  res.json({
    data: await service.removeDeliveryCost({
      ...base(req),
      id: req.params.id,
      cost_id: req.params.cost_id,
    }),
  });
const setFeeWaiver = async (req, res) =>
  res.json({
    data: await service.setFeeWaiver({
      ...base(req),
      id: req.params.id,
      reason: req.body.reason,
    }),
  });
const deliveryReconciliation = async (req, res) =>
  res.json({
    data: await service.deliveryReconciliation({
      brand: req.brand,
      from: req.query.from,
      to: req.query.to,
    }),
  });
const listUnsettledCosts = async (req, res) =>
  res.json({
    data: await service.listUnsettledCosts({
      brand: req.brand,
      courier_id: req.query.courier_id,
      to: req.query.to,
    }),
  });

// ── public tracking (no auth) ────────────────────────────
const trackPublic = async (req, res) =>
  res.json({ data: await service.trackPublic({ token: req.params.token }) });
module.exports = {
  listCouriers,
  getCourier,
  createCourier,
  updateCourier,
  listDeliveries,
  getDelivery,
  deliveryLetter,
  createDelivery,
  bookDelivery,
  advanceDelivery,
  cancelDelivery,
  recordAttempt,
  recordProof,
  addDeliveryCost,
  removeDeliveryCost,
  setFeeWaiver,
  deliveryReconciliation,
  listUnsettledCosts,
  listWebhookEvents,
  notifyDelivered,
  notifyBooked,
  deliveryComms,
  ingestCourierEvent,
  listPodCollections,
  getPodCollection,
  createPodCollection,
  markPodCollected,
  remitPodCollection,
  reconcilePodCollection,
  trackPublic,
};
