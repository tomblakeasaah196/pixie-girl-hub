/**
 * Geofence math for geolocated clock-in (V2.2 §6.11.1) — PURE, no DB.
 *
 * Haversine distance + the accept/reject decision for a clock event against a
 * brand's active geofences. Kept pure so the spatial logic is unit-testable.
 */

"use strict";

const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (Number(deg) * Math.PI) / 180;

/** Great-circle distance in metres between two lat/lng points. */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(
    EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)),
  );
}

/** Nearest geofence to a point: { geofence, distance_m } or null. */
function nearestGeofence(point, geofences) {
  let best = null;
  for (const g of geofences || []) {
    const distance_m = haversineMeters(
      point.latitude,
      point.longitude,
      g.latitude,
      g.longitude,
    );
    if (!best || distance_m < best.distance_m)
      best = { geofence: g, distance_m };
  }
  return best;
}

const DEFAULT_MAX_ACCURACY_M = 100;

/**
 * Decide whether a clock event is accepted.
 * @returns {{accepted, matched_geofence_id, distance_m, rejection_reason}}
 */
function evaluateClock({
  point,
  accuracy_m,
  geofences,
  maxAccuracyM = DEFAULT_MAX_ACCURACY_M,
}) {
  if (point === null || point.latitude === null || point.longitude === null) {
    return {
      accepted: false,
      matched_geofence_id: null,
      distance_m: null,
      rejection_reason: "permission_denied",
    };
  }
  if (
    accuracy_m !== null &&
    accuracy_m !== undefined &&
    Number(accuracy_m) > maxAccuracyM
  ) {
    return {
      accepted: false,
      matched_geofence_id: null,
      distance_m: null,
      rejection_reason: "accuracy_too_low",
    };
  }
  const nearest = nearestGeofence(point, geofences);
  if (!nearest) {
    return {
      accepted: false,
      matched_geofence_id: null,
      distance_m: null,
      rejection_reason: "outside_geofence",
    };
  }
  const within = nearest.distance_m <= Number(nearest.geofence.radius_m);
  return {
    accepted: within,
    matched_geofence_id: nearest.geofence.geofence_id,
    distance_m: nearest.distance_m,
    rejection_reason: within ? null : "outside_geofence",
  };
}

module.exports = {
  haversineMeters,
  nearestGeofence,
  evaluateClock,
  DEFAULT_MAX_ACCURACY_M,
};
