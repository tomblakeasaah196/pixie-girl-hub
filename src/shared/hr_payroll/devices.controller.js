/**
 * Device-binding controller (migration 000304). HTTP only — delegates to
 * devices.service. Self-service handlers read the profile from req.user;
 * the HR views are permission-gated in the router.
 */

"use strict";

const service = require("./devices.service");

const meta = (req) => ({
  ip_address: req.ip,
  user_agent: req.get ? req.get("user-agent") : undefined,
});

// ── Self-service (My HR) ───────────────────────────────────
async function listMyDevices(req, res) {
  res.json({ data: await service.listMyDevices({ brand: req.brand, user: req.user }) });
}

async function startEnrollment(req, res) {
  res.json({
    data: await service.startEnrollment({
      brand: req.brand,
      user: req.user,
      input: req.body,
    }),
  });
}

async function verifyEnrollment(req, res) {
  res.status(201).json({
    data: await service.verifyEnrollment({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: req.body,
      requestMeta: meta(req),
    }),
  });
}

async function startRemoval(req, res) {
  res.json({
    data: await service.startRemoval({
      brand: req.brand,
      user: req.user,
      deviceId: req.params.id,
    }),
  });
}

async function verifyRemoval(req, res) {
  res.json({
    data: await service.verifyRemoval({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: { ...req.body, device_id: req.params.id },
    }),
  });
}

// ── HR & Staff ─────────────────────────────────────────────
async function listAllDevices(req, res) {
  res.json(await service.listAllDevices({ brand: req.brand }));
}

async function listChangeFeed(req, res) {
  res.json(await service.listChangeFeed({ brand: req.brand, limit: req.query.limit }));
}

// listAllDevices / listChangeFeed already return { data: [...] } from the
// service; the client's api.get unwraps single-`data` envelopes so those two
// arrive correctly. listMyDevices returns { data, max_devices, can_add } which
// would collapse to just the array without the extra wrap above.

module.exports = {
  listMyDevices,
  startEnrollment,
  verifyEnrollment,
  startRemoval,
  verifyRemoval,
  listAllDevices,
  listChangeFeed,
};
