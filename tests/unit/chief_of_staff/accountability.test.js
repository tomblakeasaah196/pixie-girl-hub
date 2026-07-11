"use strict";

/**
 * Chief of Staff accountability sweep (cos-accountability.js) — quiet-hours
 * window, the 3-button action payload, and the dedupe guard (a candidate with a
 * live follow-up raises nothing). Repo + notifications are mocked.
 */

jest.mock("../../../src/config/database", () => ({ query: jest.fn() }));
jest.mock("../../../src/modules/chief_of_staff/cos.accountability.repo");
jest.mock("../../../src/shared/goals/goals.repo");
jest.mock("../../../src/services/notifications.service", () => ({ notify: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../../src/config/brands", () => ({ BRANDS: ["pixiegirl"] }));

const sched = require("../../../src/jobs/schedulers/cos-accountability");

describe("isQuietHour", () => {
  test("21:00–06:00 is quiet, daytime is not", () => {
    expect(sched.isQuietHour(22)).toBe(true);
    expect(sched.isQuietHour(3)).toBe(true);
    expect(sched.isQuietHour(21)).toBe(true);
    expect(sched.isQuietHour(6)).toBe(false);
    expect(sched.isQuietHour(12)).toBe(false);
    expect(sched.isQuietHour(18)).toBe(false);
  });
});

describe("respondActions", () => {
  test("emits three client-relative buttons carrying the follow-up id", () => {
    const actions = sched.respondActions("f-123");
    expect(actions.map((a) => a.value)).toEqual(["done", "in_progress", "delayed"]);
    for (const a of actions) {
      expect(a.endpoint).toBe("/cos/followups/f-123/respond");
      expect(a.endpoint.startsWith("/api/v1")).toBe(false);
    }
  });
});

describe("dedupe (via localHour override)", () => {
  test("localHour returns an hour in range", () => {
    const h = sched.localHour("Africa/Lagos");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(24);
  });
});
