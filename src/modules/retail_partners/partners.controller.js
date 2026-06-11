/**
 * Retail Partners (V2.2 §6.29) — HTTP controller.
 */

"use strict";

const service = require("./partners.service");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// ── Partners ───────────────────────────────────────────────
async function listPartners(req, res) {
  res.json({
    data: await service.listPartners({
      brand: req.brand,
      status: req.query.status,
    }),
  });
}
async function getPartner(req, res) {
  res.json({
    data: await service.getPartner({ brand: req.brand, id: req.params.id }),
  });
}
async function createPartner(req, res) {
  res.status(201).json({
    data: await service.createPartner({ ...base(req), input: req.body }),
  });
}
async function updatePartner(req, res) {
  res.json({
    data: await service.updatePartner({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}
async function setStatus(req, res) {
  res.json({
    data: await service.setStatus({
      ...base(req),
      id: req.params.id,
      status: req.body.status,
      reason: req.body.reason,
    }),
  });
}

// ── Locations ──────────────────────────────────────────────
async function listLocations(req, res) {
  res.json({
    data: await service.listLocations({
      brand: req.brand,
      partner_id: req.params.id,
    }),
  });
}
async function createLocation(req, res) {
  res.status(201).json({
    data: await service.createLocation({
      ...base(req),
      partner_id: req.params.id,
      input: req.body,
    }),
  });
}

// ── Stock + movements ──────────────────────────────────────
async function listStock(req, res) {
  res.json({
    data: await service.listStock({
      brand: req.brand,
      partner_id: req.query.partner_id,
      consignment_location_id: req.query.consignment_location_id,
    }),
  });
}
async function listMovements(req, res) {
  res.json({
    data: await service.listMovements({
      brand: req.brand,
      partner_id: req.query.partner_id,
      consignment_location_id: req.query.consignment_location_id,
      settled:
        req.query.settled === undefined
          ? undefined
          : req.query.settled === "true",
    }),
  });
}
async function recordMovement(req, res) {
  res.status(201).json({
    data: await service.recordMovement({ ...base(req), input: req.body }),
  });
}

// ── Settlements ────────────────────────────────────────────
async function listSettlements(req, res) {
  res.json({
    data: await service.listSettlements({
      brand: req.brand,
      partner_id: req.query.partner_id,
      status: req.query.status,
    }),
  });
}
async function getSettlement(req, res) {
  res.json({
    data: await service.getSettlement({ brand: req.brand, id: req.params.id }),
  });
}
async function generateSettlement(req, res) {
  res.status(201).json({
    data: await service.generateSettlement({ ...base(req), input: req.body }),
  });
}
async function approveSettlement(req, res) {
  res.json({
    data: await service.approveSettlement({ ...base(req), id: req.params.id }),
  });
}
async function markSettlementPaid(req, res) {
  res.json({
    data: await service.markSettlementPaid({
      ...base(req),
      id: req.params.id,
      payment_reference: req.body.payment_reference,
    }),
  });
}

module.exports = {
  listPartners,
  getPartner,
  createPartner,
  updatePartner,
  setStatus,
  listLocations,
  createLocation,
  listStock,
  listMovements,
  recordMovement,
  listSettlements,
  getSettlement,
  generateSettlement,
  approveSettlement,
  markSettlementPaid,
};
