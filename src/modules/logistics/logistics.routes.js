/**
 * Logistics & Delivery (V2.2 §6.10) — routes. Mounted at /api/v1/logistics.
 * Permission key: logistics. (Public tracking lives in tracking.routes.js.)
 *
 * Backing tables (per-brand): couriers, deliveries, delivery_items,
 * delivery_attempts, delivery_state_history, delivery_proofs,
 * courier_webhook_events, pay_on_delivery_collections.
 */

"use strict";

const express = require("express");
const controller = require("./logistics.controller");
const validator = require("./logistics.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("logistics", action);

// ── Couriers (Tier-1 admin config) ───────────────────────
router.get("/couriers", can("view"), controller.listCouriers);
router.post(
  "/couriers",
  can("create"),
  validator.validateCourierCreate,
  controller.createCourier,
);
router.get("/couriers/:id", can("view"), controller.getCourier);
router.patch(
  "/couriers/:id",
  can("edit"),
  validator.validateCourierUpdate,
  controller.updateCourier,
);

// ── Courier webhook ingest (maps onto the delivery state machine) ──
router.post(
  "/courier-events",
  can("edit"),
  validator.validateWebhookIngest,
  controller.ingestCourierEvent,
);

// ── Deliveries ───────────────────────────────────────────
router.get("/deliveries", can("view"), controller.listDeliveries);
router.post(
  "/deliveries",
  can("create"),
  validator.validateDeliveryCreate,
  controller.createDelivery,
);
router.get("/deliveries/:id", can("view"), controller.getDelivery);
router.post(
  "/deliveries/:id/book",
  can("edit"),
  validator.validateDeliveryBook,
  controller.bookDelivery,
);
router.post(
  "/deliveries/:id/advance",
  can("edit"),
  validator.validateDeliveryAdvance,
  controller.advanceDelivery,
);
router.post(
  "/deliveries/:id/cancel",
  can("delete"),
  validator.validateDeliveryCancel,
  controller.cancelDelivery,
);
router.post(
  "/deliveries/:id/attempts",
  can("edit"),
  validator.validateAttempt,
  controller.recordAttempt,
);
router.post(
  "/deliveries/:id/proofs",
  can("edit"),
  validator.validateProof,
  controller.recordProof,
);
router.get(
  "/deliveries/:id/webhook-events",
  can("view"),
  controller.listWebhookEvents,
);

// ── Pay-on-delivery collections ──────────────────────────
router.get("/pod-collections", can("view"), controller.listPodCollections);
router.post(
  "/pod-collections",
  can("create"),
  validator.validatePodCreate,
  controller.createPodCollection,
);
router.get("/pod-collections/:id", can("view"), controller.getPodCollection);
router.post(
  "/pod-collections/:id/collected",
  can("edit"),
  validator.validatePodCollected,
  controller.markPodCollected,
);
router.post(
  "/pod-collections/:id/remit",
  can("edit"),
  validator.validatePodRemit,
  controller.remitPodCollection,
);
router.post(
  "/pod-collections/:id/reconcile",
  can("approve"),
  validator.validatePodReconcile,
  controller.reconcilePodCollection,
);

module.exports = router;
