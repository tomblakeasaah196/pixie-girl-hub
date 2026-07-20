"use strict";

/**
 * Crowns 👑 streak engine (§6.23). Verifies the period math and the
 * advance/restart logic: a consecutive period extends the run, a single missed
 * period is bridged by a freeze, and a wider gap restarts it. crown.repo is
 * mocked; we assert the streak state written back.
 */

jest.mock("../../../src/modules/retention/crown.repo");
jest.mock("../../../src/modules/retention/retention.events", () => ({
  on: jest.fn(),
  emit: jest.fn(),
}));

const repo = require("../../../src/modules/retention/crown.repo");
const streak = require("../../../src/modules/retention/crown.streak");

const CONFIG = {
  streak_type: "purchase_monthly",
  qualifying_action: "purchase",
  display_name: "Monthly Purchase Streak",
  period_unit: "month",
  period_length: 1,
  grace_days: 5,
  freeze_allowance: 1,
  nudge_lead_days: 2,
  awards_crowns_on_extend: 0,
  milestone_bonuses: [],
  earn_multiplier_curve: [],
};

/** Last upsertStreak payload's `streak` object. */
function lastStreak() {
  const calls = repo.upsertStreak.mock.calls;
  return calls[calls.length - 1][0].streak;
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.listStreakConfig.mockResolvedValue([CONFIG]);
  repo.upsertStreak.mockImplementation(({ streak: s }) => s);
});

describe("crown streak — period math", () => {
  test("same month → same period key", () => {
    expect(streak.periodKey("2026-07-01", "month", 1)).toBe(
      streak.periodKey("2026-07-20", "month", 1),
    );
  });

  test("consecutive months differ by 1", () => {
    expect(
      streak.periodKey("2026-08-03", "month", 1) -
        streak.periodKey("2026-07-20", "month", 1),
    ).toBe(1);
  });

  test("deadline is end of period + grace days", () => {
    const d = streak.deadlineFrom("2026-07-20T00:00:00Z", CONFIG);
    // Aug 1 + 5 grace days = Aug 6.
    expect(d.toISOString().slice(0, 10)).toBe("2026-08-06");
  });
});

describe("crown streak — advance", () => {
  test("first action starts the streak at length 1", async () => {
    repo.getStreak.mockResolvedValue(null);
    await streak.recordQualifyingAction({
      brand: "pixiegirl",
      contact_id: "c1",
      qualifying_action: "purchase",
      occurred_at: "2026-07-15T00:00:00Z",
    });
    const s = lastStreak();
    expect(s.current_length).toBe(1);
    expect(s.status).toBe("active");
    expect(s.freezes_available).toBe(1);
  });

  test("a consecutive month extends the run", async () => {
    repo.getStreak.mockResolvedValue({
      contact_id: "c1",
      streak_type: "purchase_monthly",
      current_length: 1,
      longest_length: 1,
      status: "active",
      last_qualified_at: "2026-07-15T00:00:00Z",
      freezes_available: 1,
      freezes_used: 0,
      started_at: "2026-07-15T00:00:00Z",
    });
    await streak.recordQualifyingAction({
      brand: "pixiegirl",
      contact_id: "c1",
      qualifying_action: "purchase",
      occurred_at: "2026-08-10T00:00:00Z",
    });
    expect(lastStreak().current_length).toBe(2);
  });

  test("a single missed month is bridged by a freeze", async () => {
    repo.getStreak.mockResolvedValue({
      contact_id: "c1",
      streak_type: "purchase_monthly",
      current_length: 3,
      longest_length: 3,
      status: "active",
      last_qualified_at: "2026-07-15T00:00:00Z",
      freezes_available: 1,
      freezes_used: 0,
      started_at: "2026-05-15T00:00:00Z",
    });
    // Skips August, acts in September (gap of 2) → freeze bridges it.
    await streak.recordQualifyingAction({
      brand: "pixiegirl",
      contact_id: "c1",
      qualifying_action: "purchase",
      occurred_at: "2026-09-10T00:00:00Z",
    });
    const s = lastStreak();
    expect(s.current_length).toBe(4);
    expect(s.freezes_available).toBe(0);
    expect(s.freezes_used).toBe(1);
  });

  test("a wide gap with no freeze restarts the run", async () => {
    repo.getStreak.mockResolvedValue({
      contact_id: "c1",
      streak_type: "purchase_monthly",
      current_length: 5,
      longest_length: 5,
      status: "active",
      last_qualified_at: "2026-07-15T00:00:00Z",
      freezes_available: 0,
      freezes_used: 1,
      started_at: "2026-03-15T00:00:00Z",
    });
    // Acts in November (gap of 4) with no freeze → restart at 1.
    await streak.recordQualifyingAction({
      brand: "pixiegirl",
      contact_id: "c1",
      qualifying_action: "purchase",
      occurred_at: "2026-11-10T00:00:00Z",
    });
    const s = lastStreak();
    expect(s.current_length).toBe(1);
    expect(s.longest_length).toBe(5); // preserved
  });
});
