/**
 * Attendance service (V2.2 §6.11.1).
 *
 * Geofences: admin CRUD (shared, business-scoped). Clock events: a geolocated
 * clock-in/out that validates the device position against the brand's active
 * geofences (geo.calc) and records an APPEND-ONLY event — accepted or not.
 * Rejected attempts are still recorded (the truth of what was tried), with a
 * reason from the schema's fixed set.
 */

"use strict";

const repo = require("./attendance.repo");
const geo = require("./geo.calc");
const events = require("./attendance.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError } = require("../../utils/errors");

// ── geofences ──────────────────────────────────────────────
async function listGeofences({ brand, include_inactive }) {
  return { data: await repo.listGeofences({ brand, include_inactive }) };
}
async function getGeofence({ brand, id }) {
  const g = await repo.findGeofence({ brand, id });
  if (!g) throw new NotFoundError("Geofence");
  return g;
}
async function createGeofence({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const g = await repo.createGeofence({
      client,
      brand,
      input,
      created_by: user.user_id,
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "attendance.create_geofence",
      target_type: "geofences",
      target_id: g.geofence_id,
      after: g,
      request_id,
    });
    events.emit("geofence_created", { brand, geofence_id: g.geofence_id });
    return g;
  });
}
async function updateGeofence({ brand, user, request_id, id, patch }) {
  return transaction(async (client) => {
    const before = await repo.findGeofence({ client, brand, id });
    if (!before) throw new NotFoundError("Geofence");
    const g = await repo.updateGeofence({ client, brand, id, patch });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "attendance.update_geofence",
      target_type: "geofences",
      target_id: id,
      before,
      after: g,
      request_id,
    });
    events.emit("geofence_updated", { brand, geofence_id: id });
    return g;
  });
}
async function deactivateGeofence({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const before = await repo.findGeofence({ client, brand, id });
    if (!before) throw new NotFoundError("Geofence");
    await repo.deactivateGeofence({ client, brand, id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "attendance.deactivate_geofence",
      target_type: "geofences",
      target_id: id,
      before,
      request_id,
    });
    events.emit("geofence_deactivated", { brand, geofence_id: id });
  });
}

// ── clock events (append-only) ─────────────────────────────
async function clock({ brand, user, request_id, input, requestMeta = {} }) {
  return transaction(async (client) => {
    const profileBrand = await repo.profileBusiness({
      client,
      profile_id: input.profile_id,
    });
    if (profileBrand !== brand) throw new NotFoundError("Employee");

    const geofences = await repo.activeGeofences({ client, brand });
    const decision = geo.evaluateClock({
      point:
        input.latitude !== null &&
        input.longitude !== null &&
        input.latitude !== undefined &&
        input.longitude !== undefined
          ? { latitude: input.latitude, longitude: input.longitude }
          : null,
      accuracy_m: input.accuracy_m,
      geofences,
    });

    const event = await repo.insertClockEvent({
      client,
      data: {
        profile_id: input.profile_id,
        event_type: input.event_type,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy_m: input.accuracy_m,
        device_fingerprint: input.device_fingerprint,
        device_user_agent: requestMeta.user_agent,
        ip_address: requestMeta.ip_address,
        matched_geofence_id: decision.matched_geofence_id,
        distance_m: decision.distance_m,
        accepted: decision.accepted,
        rejection_reason: decision.rejection_reason,
        occurred_at: input.occurred_at,
      },
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "attendance.clock_event",
      target_type: "staff_clock_events",
      target_id: event.event_id,
      after: {
        event_type: event.event_type,
        accepted: event.accepted,
        rejection_reason: event.rejection_reason,
      },
      request_id,
    });
    events.emit("clock_event", {
      brand,
      event_id: event.event_id,
      accepted: event.accepted,
    });
    return event;
  });
}

async function listEvents({ brand, filters, page, page_size }) {
  return repo.listClockEvents({ brand, filters, page, page_size });
}

module.exports = {
  listGeofences,
  getGeofence,
  createGeofence,
  updateGeofence,
  deactivateGeofence,
  clock,
  listEvents,
};
