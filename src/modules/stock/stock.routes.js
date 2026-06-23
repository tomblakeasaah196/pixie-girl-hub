/**
 * Stock (V2.2 §6.9) — routes. Mounted at /api/v1/stock. Permission key: stock.
 */

"use strict";

const express = require("express");
const c = require("./stock.controller");
const v = require("./stock.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (a) => requirePermission("stock", a);

// Locations
router.get("/locations", can("view"), c.listLocations);
router.post(
  "/locations",
  can("create"),
  v.validateLocationCreate,
  c.createLocation,
);
router.patch(
  "/locations/:locId",
  can("edit"),
  v.validateLocationUpdate,
  c.updateLocation,
);

// Valuation (read-only; on_hand × variant standard cost)
router.get("/valuation", can("view"), c.valuation);

// Levels (read-only; on_hand changes only via movements)
router.get("/levels", can("view"), c.listLevels);
router.get("/levels/variant/:variantId", can("view"), c.variantStock);

// Movements (the only write path to stock quantity)
router.get("/movements", can("view"), c.listMovements);
router.post(
  "/movements",
  can("edit"),
  v.validateMovementCreate,
  c.recordMovement,
);

// Adjustments (count corrections; post → adjustment movements)
router.get("/adjustments", can("view"), c.listAdjustments);
router.post(
  "/adjustments",
  can("create"),
  v.validateAdjustmentCreate,
  c.createAdjustment,
);
router.get("/adjustments/:adjId", can("view"), c.getAdjustment);
router.post("/adjustments/:adjId/submit", can("edit"), c.submitAdjustment);
router.post("/adjustments/:adjId/approve", can("approve"), c.approveAdjustment);
router.post("/adjustments/:adjId/reject", can("approve"), c.rejectAdjustment);
router.post("/adjustments/:adjId/post", can("approve"), c.postAdjustment);

// Transfers (between locations; dispatch/receive → movements)
router.get("/transfers", can("view"), c.listTransfers);
router.post(
  "/transfers",
  can("create"),
  v.validateTransferCreate,
  c.createTransfer,
);
router.get("/transfers/:trfId", can("view"), c.getTransfer);
router.post("/transfers/:trfId/dispatch", can("edit"), c.dispatchTransfer);
router.post(
  "/transfers/:trfId/receive",
  can("edit"),
  v.validateTransferReceive,
  c.receiveTransfer,
);

// Alerts
router.get("/alerts", can("view"), c.listAlerts);
router.post("/alerts/:alertId/acknowledge", can("edit"), c.ackAlert);
router.post("/alerts/:alertId/dismiss", can("edit"), c.dismissAlert);
router.post("/alerts/:alertId/resolve", can("edit"), c.resolveAlert);

// Goods Reception (simplified inbound — base products + qty; stock up at once)
router.post(
  "/goods-receipts",
  can("create"),
  v.validateGoodsReceiptCreate,
  c.createGoodsReceipt,
);

// Inbound shipments (factory imports; receive → receive movements)
router.get("/shipments", can("view"), c.listShipments);
router.post(
  "/shipments",
  can("create"),
  v.validateShipmentCreate,
  c.createShipment,
);
router.get("/shipments/:shpId", can("view"), c.getShipment);
router.patch(
  "/shipments/:shpId/status",
  can("edit"),
  v.validateShipmentStatus,
  c.updateShipmentStatus,
);
router.post(
  "/shipments/:shpId/receive",
  can("edit"),
  v.validateShipmentReceive,
  c.receiveShipment,
);

module.exports = router;
