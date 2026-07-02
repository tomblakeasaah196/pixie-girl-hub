"use strict";

/**
 * Smart routing engine (§6.26 Q13) — scoring math. The repo is mocked; we
 * assert weight normalisation, component scoring fallbacks (geo → city →
 * country), and that suggest() ranks by the weighted score.
 */

jest.mock(
  "../../../src/modules/stylist_programme/programme.repo",
  () => ({
    getConfig: jest.fn(),
    candidateStylists: jest.fn(),
  }),
);

const programmeRepo = require("../../../src/modules/stylist_programme/programme.repo");
const routing = require("../../../src/modules/stylist_programme/routing.service");

const lagosStylist = {
  stylist_id: "s-lagos",
  display_name: "Lagos Pro",
  city: "Lagos",
  state: "Lagos",
  country_code: "NG",
  latitude: null,
  longitude: null,
  service_radius_km: 25,
  current_tier_key: "pro",
  tier_rank: 2,
  avg_rating: 4.5,
  rating_count: 12,
  current_active_count: 1,
  max_active_assignments: 5,
  service_key: "install", // has the specialty
  rate: "15000.00",
};
const abujaStylist = {
  ...lagosStylist,
  stylist_id: "s-abuja",
  display_name: "Abuja Certified",
  city: "Abuja",
  state: "FCT",
  tier_rank: 1,
  current_tier_key: "certified",
  avg_rating: null,
  rating_count: 0,
  service_key: null, // no matching specialty
};

describe("normaliseWeights", () => {
  test("normalises relative weights to sum 1", () => {
    const w = routing.normaliseWeights({
      distance: 40,
      tier: 20,
      rating: 20,
      capacity: 10,
      specialty: 10,
    });
    const sum = Object.values(w).reduce((s, x) => s + x, 0);
    expect(sum).toBeCloseTo(1);
    expect(w.distance).toBeCloseTo(0.4);
  });

  test("degenerate config falls back to seeded defaults", () => {
    const w = routing.normaliseWeights({ distance: 0 });
    expect(w.distance).toBeCloseTo(0.4);
    expect(w.specialty).toBeCloseTo(0.1);
  });
});

describe("componentScores", () => {
  test("same city scores full distance", () => {
    const s = routing.componentScores(lagosStylist, { city: "lagos" });
    expect(s.distance).toBe(1);
  });

  test("same country only scores 0.3", () => {
    const s = routing.componentScores(abujaStylist, {
      city: "Lagos",
      country_code: "NG",
    });
    expect(s.distance).toBe(0.3);
  });

  test("haversine path used when coordinates are present", () => {
    const c = { ...lagosStylist, latitude: 6.5244, longitude: 3.3792 };
    const s = routing.componentScores(c, {
      latitude: 6.4550,
      longitude: 3.3941,
    });
    expect(s.distance_km).toBeGreaterThan(0);
    expect(s.distance_km).toBeLessThan(25);
    expect(s.distance).toBeGreaterThan(0.5);
  });

  test("no ratings is neutral 0.5, specialty is binary", () => {
    const s = routing.componentScores(abujaStylist, { city: "Abuja" });
    expect(s.rating).toBe(0.5);
    expect(s.specialty).toBe(0);
  });
});

describe("suggest", () => {
  test("ranks the city+specialty match above the country-only match", async () => {
    programmeRepo.getConfig.mockResolvedValue({
      routing_weights: {
        distance: 40,
        tier: 20,
        rating: 20,
        capacity: 10,
        specialty: 10,
      },
      offer_top_n: 3,
    });
    programmeRepo.candidateStylists.mockResolvedValue([
      abujaStylist,
      lagosStylist,
    ]);
    const out = await routing.suggest({
      business: "pixiegirl",
      service_key: "install",
      target: { city: "Lagos", country_code: "NG" },
    });
    expect(out.candidates[0].stylist_id).toBe("s-lagos");
    expect(out.candidates[0].match_rank).toBe(1);
    expect(out.candidates[0].match_score).toBeGreaterThan(
      out.candidates[1].match_score,
    );
    expect(out.offer_top_n).toBe(3);
  });

  test("haversineKm: Lagos→Abuja great-circle is ~525km", () => {
    const km = routing.haversineKm(6.5244, 3.3792, 9.0765, 7.3986);
    expect(km).toBeGreaterThan(450);
    expect(km).toBeLessThan(600);
  });
});
