"use strict";

/**
 * flagOffsite — record-and-flag clock-in decision (HR attendance PR).
 */
const { flagOffsite } = require("../../../src/shared/attendance/geo.calc");

const OFFICE = { geofence_id: "hq", latitude: 6.5244, longitude: 3.3792, radius_m: 100 };

describe("flagOffsite", () => {
  test("no location → not recorded, permission_denied", () => {
    const r = flagOffsite({ point: null, geofences: [OFFICE] });
    expect(r.recorded).toBe(false);
    expect(r.reason).toBe("permission_denied");
  });

  test("inside the office radius → recorded, on-site", () => {
    const r = flagOffsite({
      point: { latitude: 6.5244, longitude: 3.3792 },
      accuracy_m: 12,
      geofences: [OFFICE],
    });
    expect(r.recorded).toBe(true);
    expect(r.is_offsite).toBe(false);
    expect(r.matched_geofence_id).toBe("hq");
    expect(r.distance_m).toBe(0);
  });

  test("far from the office → recorded but flagged offsite", () => {
    const r = flagOffsite({
      point: { latitude: 6.6, longitude: 3.5 },
      accuracy_m: 10,
      geofences: [OFFICE],
    });
    expect(r.recorded).toBe(true);
    expect(r.is_offsite).toBe(true);
    expect(r.reason).toBe("outside_geofence");
    expect(r.distance_m).toBeGreaterThan(100);
  });

  test("no geofences configured → recorded, not offsite", () => {
    const r = flagOffsite({ point: { latitude: 6.5, longitude: 3.4 }, geofences: [] });
    expect(r.recorded).toBe(true);
    expect(r.is_offsite).toBe(false);
    expect(r.reason).toBe("no_geofences");
  });

  test("poor accuracy is flagged but does not alone make it offsite", () => {
    const r = flagOffsite({
      point: { latitude: 6.5244, longitude: 3.3792 },
      accuracy_m: 500,
      geofences: [OFFICE],
    });
    expect(r.low_accuracy).toBe(true);
    expect(r.is_offsite).toBe(false);
  });
});
