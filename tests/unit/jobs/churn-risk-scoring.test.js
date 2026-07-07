"use strict";

/**
 * Churn-risk recency rule (V2.2 §6.1) — the pure scoring function behind the
 * nightly churn-risk-scoring sweep. DB/log deps are mocked; the rule itself
 * (drift vs the customer's own ordering cycle + absolute day floors) is real.
 */

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  ex: jest.fn(),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../../src/config/brands", () => ({
  BRANDS: [],
  t: (b, n) => `${b}.${n}`,
}));

const {
  scoreRecency,
} = require("../../../src/jobs/schedulers/churn-risk-scoring");

describe("scoreRecency — recency rule", () => {
  test("a purchase in the last 14 days is always low risk", () => {
    const r = scoreRecency({
      days_since_last_order: 7,
      avg_gap_days: null,
      total_orders: 1,
    });
    expect(r.risk_band).toBe("low");
    expect(r.risk_score).toBeLessThanOrEqual(30);
    expect(r.reasons).toEqual([]);
  });

  test("on their own cycle → low (monthly buyer at day 30)", () => {
    const r = scoreRecency({
      days_since_last_order: 30,
      avg_gap_days: 30,
      total_orders: 6,
    });
    expect(r.risk_score).toBe(35); // drift 1.0 × 35
    expect(r.risk_band).toBe("low");
  });

  test("2.5× overdue vs own cycle → critical with gap reason", () => {
    const r = scoreRecency({
      days_since_last_order: 75,
      avg_gap_days: 30,
      total_orders: 4,
    });
    expect(r.risk_score).toBe(88);
    expect(r.risk_band).toBe("critical");
    expect(r.reasons).toContain("ordering_gap_stretched");
  });

  test("90-day floor: slow-cadence customer still lands at least HIGH", () => {
    const r = scoreRecency({
      days_since_last_order: 95,
      avg_gap_days: 90, // barely over their own cycle
      total_orders: 3,
    });
    expect(r.risk_score).toBeGreaterThanOrEqual(70);
    expect(r.risk_band).toBe("high");
    expect(r.reasons).toContain("no_purchase_90d");
  });

  test("180-day floor: always critical", () => {
    const r = scoreRecency({
      days_since_last_order: 200,
      avg_gap_days: 100,
      total_orders: 2,
    });
    expect(r.risk_score).toBeGreaterThanOrEqual(85);
    expect(r.risk_band).toBe("critical");
    expect(r.reasons).toContain("no_purchase_180d");
  });

  test("single-purchase customer lapsing at 60d gets flagged medium+", () => {
    const r = scoreRecency({
      days_since_last_order: 60,
      avg_gap_days: null, // one order — falls back to the 45-day cycle
      total_orders: 1,
    });
    expect(r.risk_band).toBe("medium");
    expect(r.reasons).toContain("single_purchase_lapsing");
  });

  test("score clamps to 100", () => {
    const r = scoreRecency({
      days_since_last_order: 1000,
      avg_gap_days: 30,
      total_orders: 2,
    });
    expect(r.risk_score).toBe(100);
    expect(r.risk_band).toBe("critical");
  });

  test("expected gap never drops below 30 days (weekly buyers don't false-alarm)", () => {
    const r = scoreRecency({
      days_since_last_order: 21, // 3 weeks after a weekly cadence
      avg_gap_days: 7,
      total_orders: 20,
    });
    // 21/30 × 35 ≈ 25 — low, not the critical a 7-day gap would imply.
    expect(r.risk_band).toBe("low");
  });
});

describe("segment presets", () => {
  const P = require("../../../src/modules/crm/crm.presets");
  const {
    PRESETS,
  } = require("../../../src/jobs/schedulers/segment-presets");

  test("every preset carries its marker key and a usable filter", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const p of PRESETS) {
      expect(p.name).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(typeof p.filter.preset).toBe("string");
    }
  });

  test("thresholds stay in lock-step with crm.presets", () => {
    const byKey = Object.fromEntries(PRESETS.map((p) => [p.filter.preset, p]));
    expect(byKey.vip.filter.min_lifetime_spend).toBe(P.VIP_SPEND_NGN);
    expect(byKey.big_spender.filter.min_lifetime_spend).toBe(
      P.BIG_SPENDER_SPEND_NGN,
    );
    expect(byKey.win_back.filter.lapsed_days).toBe(P.WINBACK_LAPSED_DAYS);
    expect(byKey.new.filter.created_within_days).toBe(P.NEW_CLIENT_DAYS);
    expect(byKey.birthdays_soon.filter.birthday_within_days).toBe(
      P.BIRTHDAY_SOON_DAYS,
    );
  });
});
