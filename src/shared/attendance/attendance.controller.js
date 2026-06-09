/** Attendance controller (V2.2 §6.11.1). HTTP only. */
"use strict";
const service = require("./attendance.service");
const ctx = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function listGeofences(req, res) {
  res.json(
    await service.listGeofences({
      brand: req.brand,
      include_inactive: req.query.include_inactive,
    }),
  );
}
async function getGeofence(req, res) {
  res.json({
    data: await service.getGeofence({ brand: req.brand, id: req.params.id }),
  });
}
async function createGeofence(req, res) {
  res.status(201).json({
    data: await service.createGeofence({ ...ctx(req), input: req.body }),
  });
}
async function updateGeofence(req, res) {
  res.json({
    data: await service.updateGeofence({
      ...ctx(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}
async function deleteGeofence(req, res) {
  await service.deactivateGeofence({ ...ctx(req), id: req.params.id });
  res.status(204).end();
}

async function clock(req, res) {
  const event = await service.clock({
    ...ctx(req),
    input: req.body,
    requestMeta: { user_agent: req.headers["user-agent"], ip_address: req.ip },
  });
  // 201 whether accepted or not — the attempt is recorded either way.
  res.status(201).json({ data: event });
}
async function listEvents(req, res) {
  res.json(
    await service.listEvents({
      brand: req.brand,
      filters: req.query,
      page: parseInt(req.query.page || "1", 10),
      page_size: Math.min(parseInt(req.query.page_size || "50", 10), 200),
    }),
  );
}

module.exports = {
  listGeofences,
  getGeofence,
  createGeofence,
  updateGeofence,
  deleteGeofence,
  clock,
  listEvents,
};
