/**
 * Stock (V2.2 §6.9) — HTTP controllers.
 */

"use strict";

const service = require("./stock.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

const listLocations = async (req, res) =>
  res.json({ data: await service.listLocations({ brand: req.brand }) });
const createLocation = async (req, res) =>
  res.status(201).json({
    data: await service.createLocation({ ...base(req), input: req.body }),
  });
const updateLocation = async (req, res) =>
  res.json({
    data: await service.updateLocation({
      ...base(req),
      id: req.params.locId,
      patch: req.body,
    }),
  });

async function listLevels(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json({
    data: await service.listLevels({
      brand: req.brand,
      variant_id: req.query.variant_id,
      location_id: req.query.location_id,
      page,
      page_size,
    }),
  });
}
const valuation = async (req, res) =>
  res.json({
    data: await service.valuation({
      brand: req.brand,
      location_id: req.query.location_id,
      variant_id: req.query.variant_id,
      product_id: req.query.product_id,
    }),
  });
const variantStock = async (req, res) =>
  res.json({
    data: await service.variantStock({
      brand: req.brand,
      variant_id: req.params.variantId,
    }),
  });

async function listMovements(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json({
    data: await service.listMovements({
      brand: req.brand,
      filters: {
        variant_id: req.query.variant_id,
        movement_type: req.query.movement_type,
        reference_id: req.query.reference_id,
      },
      page,
      page_size,
    }),
  });
}
const recordMovement = async (req, res) =>
  res.status(201).json({
    data: await service.recordMovement({ ...base(req), input: req.body }),
  });

// Adjustments
async function listAdjustments(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json({
    data: await service.listAdjustments({
      brand: req.brand,
      filters: { status: req.query.status, location_id: req.query.location_id },
      page,
      page_size,
    }),
  });
}
const getAdjustment = async (req, res) =>
  res.json({
    data: await service.getAdjustment({
      brand: req.brand,
      id: req.params.adjId,
    }),
  });
const createAdjustment = async (req, res) =>
  res.status(201).json({
    data: await service.createAdjustment({ ...base(req), input: req.body }),
  });
const submitAdjustment = async (req, res) =>
  res.json({
    data: await service.submitAdjustment({ ...base(req), id: req.params.adjId }),
  });
const approveAdjustment = async (req, res) =>
  res.json({
    data: await service.approveAdjustment({ ...base(req), id: req.params.adjId }),
  });
const rejectAdjustment = async (req, res) =>
  res.json({
    data: await service.rejectAdjustment({ ...base(req), id: req.params.adjId }),
  });
const postAdjustment = async (req, res) =>
  res.json({
    data: await service.postAdjustment({ ...base(req), id: req.params.adjId }),
  });

// Transfers
async function listTransfers(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json({
    data: await service.listTransfers({
      brand: req.brand,
      filters: { status: req.query.status },
      page,
      page_size,
    }),
  });
}
const getTransfer = async (req, res) =>
  res.json({
    data: await service.getTransfer({ brand: req.brand, id: req.params.trfId }),
  });
const createTransfer = async (req, res) =>
  res.status(201).json({
    data: await service.createTransfer({ ...base(req), input: req.body }),
  });
const dispatchTransfer = async (req, res) =>
  res.json({
    data: await service.dispatchTransfer({
      ...base(req),
      id: req.params.trfId,
    }),
  });
const receiveTransfer = async (req, res) =>
  res.json({
    data: await service.receiveTransfer({
      ...base(req),
      id: req.params.trfId,
      input: req.body,
    }),
  });

// Alerts
async function listAlerts(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json({
    data: await service.listAlerts({
      brand: req.brand,
      filters: { status: req.query.status, variant_id: req.query.variant_id },
      page,
      page_size,
    }),
  });
}
const ackAlert = async (req, res) =>
  res.json({
    data: await service.setAlertStatus({
      ...base(req),
      id: req.params.alertId,
      status: "acknowledged",
    }),
  });
const dismissAlert = async (req, res) =>
  res.json({
    data: await service.setAlertStatus({
      ...base(req),
      id: req.params.alertId,
      status: "dismissed",
    }),
  });
const resolveAlert = async (req, res) =>
  res.json({
    data: await service.setAlertStatus({
      ...base(req),
      id: req.params.alertId,
      status: "resolved",
    }),
  });

// Inbound shipments
async function listShipments(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json({
    data: await service.listShipments({
      brand: req.brand,
      filters: { status: req.query.status },
      page,
      page_size,
    }),
  });
}
const getShipment = async (req, res) =>
  res.json({
    data: await service.getShipment({ brand: req.brand, id: req.params.shpId }),
  });
const createShipment = async (req, res) =>
  res.status(201).json({
    data: await service.createShipment({ ...base(req), input: req.body }),
  });
const updateShipmentStatus = async (req, res) =>
  res.json({
    data: await service.updateShipmentStatus({
      ...base(req),
      id: req.params.shpId,
      status: req.body.status,
    }),
  });
const receiveShipment = async (req, res) =>
  res.json({
    data: await service.receiveShipment({
      ...base(req),
      id: req.params.shpId,
      input: req.body,
    }),
  });

module.exports = {
  listLocations,
  createLocation,
  updateLocation,
  valuation,
  listLevels,
  variantStock,
  listMovements,
  recordMovement,
  listAdjustments,
  getAdjustment,
  createAdjustment,
  submitAdjustment,
  approveAdjustment,
  rejectAdjustment,
  postAdjustment,
  listTransfers,
  getTransfer,
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  listAlerts,
  ackAlert,
  dismissAlert,
  resolveAlert,
  listShipments,
  getShipment,
  createShipment,
  updateShipmentStatus,
  receiveShipment,
};
