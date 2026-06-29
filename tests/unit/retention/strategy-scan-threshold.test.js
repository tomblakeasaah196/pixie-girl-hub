"use strict";

/**
 * Scanner threshold extraction (§6.23). Lapse strategies enrol a customer on
 * the day they cross the threshold encoded in the strategy's own conditions,
 * so the scanner must read that number (with sane defaults).
 */

jest.mock("../../../src/config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));

const { thresholdDays } = require("../../../src/jobs/schedulers/retention-strategy-scan");

describe("retention-strategy-scan.thresholdDays", () => {
  test("reads days_since_last_order from a gte condition", () => {
    expect(
      thresholdDays({
        trigger_type: "win_back",
        trigger_conditions: { all: [{ field: "days_since_last_order", op: "gte", value: 90 }] },
      }),
    ).toBe(90);
  });

  test("falls back to the per-trigger default when unset", () => {
    expect(thresholdDays({ trigger_type: "win_back", trigger_conditions: {} })).toBe(60);
    expect(thresholdDays({ trigger_type: "reorder_reminder", trigger_conditions: {} })).toBe(45);
  });

  test("ignores non-threshold conditions", () => {
    expect(
      thresholdDays({
        trigger_type: "inactivity",
        trigger_conditions: { all: [{ field: "tier_key", op: "eq", value: "gold" }] },
      }),
    ).toBe(60);
  });
});
