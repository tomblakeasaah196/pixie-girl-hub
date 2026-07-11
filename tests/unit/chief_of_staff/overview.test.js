"use strict";

/**
 * Chief of Staff cross-brand overview (cos.overview.js) — the pure merge/headline
 * logic and the CEO-only guard. No DB.
 */

const overview = require("../../../src/modules/chief_of_staff/cos.overview");

describe("ceoBrands", () => {
  test("denies a non-CEO", () => {
    expect(() => overview.ceoBrands({ is_ceo: false })).toThrow(/CEO/i);
    expect(() => overview.ceoBrands(null)).toThrow();
  });

  test("returns the CEO's explicit brand set", () => {
    const brands = overview.ceoBrands({ is_ceo: true, available_businesses: ["pixiegirl", "faitlynhair"] });
    expect(brands).toEqual(["pixiegirl", "faitlynhair"]);
  });
});

describe("shapeOverview", () => {
  const businesses = ["pixiegirl", "faitlynhair"];
  const names = { pixiegirl: "Pixie Girl", faitlynhair: "Faitlyn Hair" };

  test("returns a row for BOTH brands, even one with no goals", () => {
    const shaped = overview.shapeOverview({
      businesses,
      health: [{ business: "pixiegirl", active_goals: 4, on_track: 4, at_risk: 0, behind: 0, achieved: 2, avg_progress: 70 }],
      overdue: [{ business: "pixiegirl", overdue_milestones: 0, overdue_tasks: 0 }],
      names,
    });
    expect(shaped.brands).toHaveLength(2);
    const flh = shaped.brands.find((b) => b.business === "faitlynhair");
    expect(flh.active_goals).toBe(0);
    expect(flh.display_name).toBe("Faitlyn Hair");
    expect(flh.headline).toMatch(/no active goals/i);
  });

  test("headline reflects behind > at_risk > on_track precedence", () => {
    const shaped = overview.shapeOverview({
      businesses: ["pixiegirl"],
      health: [{ business: "pixiegirl", active_goals: 5, on_track: 2, at_risk: 1, behind: 2, avg_progress: 40 }],
      overdue: [{ business: "pixiegirl", overdue_milestones: 3, overdue_tasks: 1 }],
      names,
    });
    const pxg = shaped.brands[0];
    expect(pxg.headline).toMatch(/behind/i);
    expect(pxg.overdue_total).toBe(4);
  });

  test("aggregates portfolio totals across brands", () => {
    const shaped = overview.shapeOverview({
      businesses,
      health: [
        { business: "pixiegirl", active_goals: 3, at_risk: 1, behind: 2, avg_progress: 40 },
        { business: "faitlynhair", active_goals: 2, at_risk: 0, behind: 0, avg_progress: 90 },
      ],
      overdue: [
        { business: "pixiegirl", overdue_milestones: 2, overdue_tasks: 1 },
        { business: "faitlynhair", overdue_milestones: 0, overdue_tasks: 0 },
      ],
      names,
    });
    expect(shaped.totals).toMatchObject({ active_goals: 5, at_risk: 1, behind: 2, overdue_total: 3 });
  });
});
