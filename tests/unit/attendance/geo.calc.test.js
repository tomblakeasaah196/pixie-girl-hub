"use strict";

/**
 * Geofenced clock-in unit tests (V2.2 §6.11.1).
 *
 * geo.calc is PURE (no DB). These guard the accept/reject decision for
 * geolocated attendance — i.e. whether a staff clock-in counts as "on site".
 */

const {
  haversineMeters,
  nearestGeofence,
  evaluateClock,
  DEFAULT_MAX_ACCURACY_M,
} = require("../../../src/shared/attendance/geo.calc");

describe("haversineMeters", () => {
  test("identical points are 0 m apart", () => {
    expect(haversineMeters(6.5244, 3.3792, 6.5244, 3.3792)).toBe(0);
  });

  test("one degree of latitude is ~111 km", () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(111000);
    expect(d).toBeLessThan(111400);
  });

  test("distance is symmetric", () => {
    const a = haversineMeters(6.5, 3.3, 6.6, 3.4);
    const b = haversineMeters(6.6, 3.4, 6.5, 3.3);
    expect(a).toBe(b);
  });
});

describe("nearestGeofence", () => {
  test("returns the closest fence", () => {
    const point = { latitude: 0, longitude: 0 };
    const fences = [
      { geofence_id: "far", latitude: 0, longitude: 1, radius_m: 50 },
      { geofence_id: "near", latitude: 0, longitude: 0.0001, radius_m: 50 },
    ];
    const best = nearestGeofence(point, fences);
    expect(best.geofence.geofence_id).toBe("near");
    expect(best.distance_m).toBeLessThan(50);
  });

  test("no fences → null", () => {
    expect(nearestGeofence({ latitude: 0, longitude: 0 }, [])).toBeNull();
  });
});

describe("evaluateClock", () => {
  const fence = {
    geofence_id: "hq",
    latitude: 6.5244,
    longitude: 3.3792,
    radius_m: 100,
  };

  test("missing location → permission_denied", () => {
    const r = evaluateClock({
      point: null,
      accuracy_m: 10,
      geofences: [fence],
    });
    expect(r.accepted).toBe(false);
    expect(r.rejection_reason).toBe("permission_denied");
  });

  test("poor GPS accuracy → accuracy_too_low", () => {
    const r = evaluateClock({
      point: { latitude: 6.5244, longitude: 3.3792 },
      accuracy_m: DEFAULT_MAX_ACCURACY_M + 50,
      geofences: [fence],
    });
    expect(r.accepted).toBe(false);
    expect(r.rejection_reason).toBe("accuracy_too_low");
  });

  test("no geofences configured → outside_geofence", () => {
    const r = evaluateClock({
      point: { latitude: 6.5244, longitude: 3.3792 },
      accuracy_m: 10,
      geofences: [],
    });
    expect(r.accepted).toBe(false);
    expect(r.rejection_reason).toBe("outside_geofence");
  });

  test("inside the radius → accepted", () => {
    const r = evaluateClock({
      point: { latitude: 6.5244, longitude: 3.3792 }, // dead centre
      accuracy_m: 10,
      geofences: [fence],
    });
    expect(r.accepted).toBe(true);
    expect(r.matched_geofence_id).toBe("hq");
    expect(r.rejection_reason).toBeNull();
  });

  test("outside the radius → rejected with reason", () => {
    const r = evaluateClock({
      point: { latitude: 6.6, longitude: 3.5 }, // far from HQ
      accuracy_m: 10,
      geofences: [fence],
    });
    expect(r.accepted).toBe(false);
    expect(r.rejection_reason).toBe("outside_geofence");
  });
});
