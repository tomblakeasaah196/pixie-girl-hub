"use strict";

/**
 * Goals progress rollup (Chief of Staff, PR1).
 * Pure formula — the single source of truth used by goals.repo.recomputeProgress.
 */

const { progressPct } = require("../../../src/shared/goals/goals.repo");

describe("goals progress formula", () => {
  test("no children → 0%", () => {
    expect(progressPct({})).toBe(0);
    expect(progressPct({ m_total: 0, t_total: 0 })).toBe(0);
  });

  test("all done → 100%", () => {
    expect(progressPct({ m_total: 3, m_done: 3 })).toBe(100);
    expect(
      progressPct({ m_total: 2, m_done: 2, t_total: 2, t_done: 2 }),
    ).toBe(100);
  });

  test("half done → 50%", () => {
    expect(progressPct({ m_total: 4, m_done: 2 })).toBe(50);
    expect(
      progressPct({ m_total: 1, m_done: 0, t_total: 1, t_done: 1 }),
    ).toBe(50);
  });

  test("milestones + tasks are equal-weighted and rounded", () => {
    // 1 of 3 items done = 33.33% → rounds to 33.
    expect(
      progressPct({ m_total: 2, m_done: 1, t_total: 1, t_done: 0 }),
    ).toBe(33);
    // 2 of 3 = 66.67% → rounds to 67.
    expect(
      progressPct({ m_total: 2, m_done: 2, t_total: 1, t_done: 0 }),
    ).toBe(67);
  });

  test("string counts (pg may return text) are coerced", () => {
    expect(progressPct({ m_total: "4", m_done: "1" })).toBe(25);
  });

  test("never exceeds 100 or drops below 0", () => {
    const pct = progressPct({ m_total: 5, m_done: 5, t_total: 5, t_done: 5 });
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });
});
