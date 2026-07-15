/** Attendance controller (V2.2 §6.11.1). HTTP only. */
"use strict";
const service = require("./attendance.service");
const geoapify = require("../../services/geoapify.service");
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

// ── Geoapify proxy (office-location picker) ────────────────
// The Geoapify key is server-only, so the admin app can't call Geoapify
// directly — it calls these, and we forward. Gated on attendance:view (same
// as the office CRUD the picker feeds). Coordinates aren't secret, so no
// brand scoping is needed here beyond the module permission.

/** Whether the map/search features are available (drives UI degradation). */
async function geoStatus(_req, res) {
  res.set("Cache-Control", "private, max-age=300");
  res.json({ data: { configured: await geoapify.isConfigured() } });
}

/** Address autocomplete: typed text → ranked suggestions with coordinates. */
async function geoSearch(req, res) {
  const data = await geoapify.autocomplete(req.query.text, {
    lat: req.query.lat,
    lng: req.query.lng,
    limit: req.query.limit,
  });
  res.set("Cache-Control", "private, max-age=60");
  res.json({ data });
}

/** Reverse geocode: coordinates → a human address label. */
async function geoReverse(req, res) {
  const address = await geoapify.reverseGeocode(req.query.lat, req.query.lng);
  res.set("Cache-Control", "private, max-age=300");
  res.json({ data: { address } });
}

/** Centred static map image (PNG bytes) for the picker's map surface. */
async function geoStaticMap(req, res) {
  try {
    const { buffer, contentType } = await geoapify.staticMap({
      lat: req.query.lat,
      lng: req.query.lng,
      zoom: req.query.zoom,
      width: req.query.width,
      height: req.query.height,
    });
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=600");
    res.send(buffer);
  } catch (err) {
    const notConfigured = err.code === "GEOAPIFY_NOT_CONFIGURED";
    res.status(notConfigured ? 503 : 502).json({
      error: {
        code: notConfigured ? "GEOAPIFY_NOT_CONFIGURED" : "GEOAPIFY_MAP_FAILED",
        message: notConfigured
          ? "Map service is not configured."
          : "Could not load the map right now.",
      },
    });
  }
}

module.exports = {
  listGeofences,
  getGeofence,
  createGeofence,
  updateGeofence,
  deleteGeofence,
  clock,
  listEvents,
  geoStatus,
  geoSearch,
  geoReverse,
  geoStaticMap,
};
