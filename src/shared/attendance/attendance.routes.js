/**
 * Attendance routes (V2.2 §6.11.1). Mounted at /api/v1/attendance, gated on
 * `attendance`. Geofences are admin CRUD; /clock records a geolocated event
 * (append-only); /events is the read-only history.
 */
"use strict";
const express = require("express");
const c = require("./attendance.controller");
const v = require("./attendance.validator");
const { requirePermission } = require("../../middleware/rbac");
const router = express.Router();
const P = (a) => requirePermission("attendance", a);

// ── Geoapify proxy for the office-location picker ──────────
// The Geoapify key is server-only; the admin picker calls these instead of
// Geoapify directly. Declared before /geofences/:id so the /geo/* literals
// win over the :id param route.
router.get("/geo/status", P("view"), c.geoStatus);
router.get("/geo/search", P("view"), c.geoSearch);
router.get("/geo/reverse", P("view"), c.geoReverse);
router.get("/geo/staticmap", P("view"), c.geoStaticMap);

// ── Geofences (admin CRUD) ─────────────────────────────────
router.get("/geofences", P("view"), c.listGeofences);
router.post("/geofences", P("create"), v.geofenceCreate, c.createGeofence);
router.get("/geofences/:id", P("view"), c.getGeofence);
router.patch("/geofences/:id", P("edit"), v.geofenceUpdate, c.updateGeofence);
router.delete("/geofences/:id", P("delete"), c.deleteGeofence);

// ── Clock in/out (geolocated, append-only) ─────────────────
router.post("/clock", P("create"), v.clock, c.clock);
router.get("/events", P("view"), c.listEvents);

module.exports = router;
