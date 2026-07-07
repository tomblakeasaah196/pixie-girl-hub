"use strict";

/**
 * Appraisal auto-scoring — the metric→score mapping contract.
 *
 * Locks in the bands the engine uses so a data pull turns into the right 1–5
 * KPI score: percentage sources (attendance, sales) map through bands; rating
 * sources (quality, customer) pass their average straight through, clamped to
 * the KPI scale; and a KPI's auto_score_config can override either.
 */

const {
  mapMetricToScore,
} = require("../../../src/shared/hr_payroll/appraisal.autoscore");

const kpi = { min_score: 1, max_score: 5 };

describe("mapMetricToScore — clock_in_data (on-time %)", () => {
  const s = (value) => mapMetricToScore({ source: "clock_in_data", value, kpi }).score;
  it("bands on-time percentage to 1–5", () => {
    expect(s(100)).toBe(5);
    expect(s(95)).toBe(5);
    expect(s(94)).toBe(4);
    expect(s(90)).toBe(4);
    expect(s(85)).toBe(3);
    expect(s(72)).toBe(2);
    expect(s(50)).toBe(1);
    expect(s(0)).toBe(1);
  });
});

describe("mapMetricToScore — sales_data (attainment %)", () => {
  const s = (value) => mapMetricToScore({ source: "sales_data", value, kpi }).score;
  it("bands target attainment to 1–5", () => {
    expect(s(120)).toBe(5);
    expect(s(100)).toBe(5);
    expect(s(90)).toBe(4);
    expect(s(80)).toBe(3);
    expect(s(60)).toBe(2);
    expect(s(10)).toBe(1);
  });
});

describe("mapMetricToScore — rating sources pass through", () => {
  it("uses the average directly for service_job_ratings", () => {
    const r = mapMetricToScore({ source: "service_job_ratings", value: 4.3, kpi });
    expect(r.mode).toBe("passthrough");
    expect(r.score).toBe(4.3);
  });
  it("uses the average directly for customer_ratings", () => {
    expect(mapMetricToScore({ source: "customer_ratings", value: 3.75, kpi }).score).toBe(3.75);
  });
  it("clamps to the KPI scale", () => {
    expect(mapMetricToScore({ source: "customer_ratings", value: 6, kpi }).score).toBe(5);
    expect(mapMetricToScore({ source: "customer_ratings", value: 0.2, kpi }).score).toBe(1);
  });
});

describe("mapMetricToScore — auto_score_config overrides", () => {
  it("uses custom bands when provided", () => {
    const custom = {
      min_score: 1,
      max_score: 5,
      auto_score_config: { bands: [{ gte: 80, score: 5 }, { gte: 0, score: 2 }] },
    };
    expect(mapMetricToScore({ source: "clock_in_data", value: 85, kpi: custom }).score).toBe(5);
    expect(mapMetricToScore({ source: "clock_in_data", value: 10, kpi: custom }).score).toBe(2);
  });
  it("supports passthrough mode on a percentage source", () => {
    const passthrough = {
      min_score: 1,
      max_score: 5,
      auto_score_config: { mode: "passthrough" },
    };
    expect(mapMetricToScore({ source: "sales_data", value: 3.2, kpi: passthrough }).score).toBe(3.2);
  });
});

describe("mapMetricToScore — unknown source", () => {
  it("returns null when there is no mapping", () => {
    expect(mapMetricToScore({ source: "crm_data", value: 50, kpi })).toBeNull();
  });
});
