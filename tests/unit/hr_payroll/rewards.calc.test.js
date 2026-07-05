"use strict";

/**
 * Rewards engine math (PURE) — qualification + reward resolution.
 * These guard the money that flows out of the reward system.
 */

const { qualifies, resolveReward, round2 } =
  require("../../../src/shared/hr_payroll/rewards.calc");

describe("qualifies", () => {
  test("gte passes at/above threshold", () => {
    expect(qualifies({ value: 15, comparator: "gte", threshold: 15 })).toBe(true);
    expect(qualifies({ value: 16, comparator: "gte", threshold: 15 })).toBe(true);
    expect(qualifies({ value: 14, comparator: "gte", threshold: 15 })).toBe(false);
  });
  test("lte passes at/below threshold", () => {
    expect(qualifies({ value: 3, comparator: "lte", threshold: 3 })).toBe(true);
    expect(qualifies({ value: 4, comparator: "lte", threshold: 3 })).toBe(false);
  });
  test("non-numeric never qualifies", () => {
    expect(qualifies({ value: null, comparator: "gte", threshold: 1 })).toBe(false);
    expect(qualifies({ value: 5, comparator: "gte", threshold: "x" })).toBe(false);
  });
});

describe("resolveReward", () => {
  test("fixed_ngn → monetary amount", () => {
    expect(resolveReward({ reward_type: "fixed_ngn", reward_value: 20000, baseSalaryNgn: 0 }))
      .toEqual({ kind: "monetary", amount_ngn: 20000 });
  });
  test("pct_salary → % of base", () => {
    expect(resolveReward({ reward_type: "pct_salary", reward_value: 20, baseSalaryNgn: 100000 }))
      .toEqual({ kind: "monetary", amount_ngn: 20000 });
  });
  test("salary_increase_pct → proposed new salary", () => {
    expect(resolveReward({ reward_type: "salary_increase_pct", reward_value: 10, baseSalaryNgn: 100000 }))
      .toEqual({ kind: "salary_increase", proposed_salary_ngn: 110000 });
  });
  test("non-positive results resolve to null", () => {
    expect(resolveReward({ reward_type: "fixed_ngn", reward_value: 0, baseSalaryNgn: 0 })).toBeNull();
    expect(resolveReward({ reward_type: "pct_salary", reward_value: 10, baseSalaryNgn: 0 })).toBeNull();
    expect(resolveReward({ reward_type: "salary_increase_pct", reward_value: 0, baseSalaryNgn: 100000 })).toBeNull();
  });
  test("unknown reward type → null", () => {
    expect(resolveReward({ reward_type: "mystery", reward_value: 5, baseSalaryNgn: 100 })).toBeNull();
  });
  test("rounds money to kobo", () => {
    expect(round2(resolveReward({ reward_type: "pct_salary", reward_value: 7.5, baseSalaryNgn: 123457 }).amount_ngn))
      .toBe(9259.28);
  });
});
