"use strict";

/**
 * Performance → Insights service — PURE shaping.
 * Mocks the repo so the winner ranking, share-of-all-sales maths, the
 * self-service ("Online") bucket, and on-time % are verified without a DB.
 */

jest.mock("../../../src/shared/hr_payroll/insights.repo");
const repo = require("../../../src/shared/hr_payroll/insights.repo");
const service = require("../../../src/shared/hr_payroll/insights.service");
const { buildWorkbook } = require("../../../src/shared/hr_payroll/insights.export");

const PERIOD = { from: "2026-07-01", to: "2026-07-31" };

describe("salesReport", () => {
  beforeEach(() => {
    repo.salesRepLeaderboard.mockReset();
    repo.salesChannelMix.mockReset();
  });

  test("ranks reps, computes share of ALL sales, and buckets self-service", async () => {
    // 10 + 6 attributed + 4 online = 20 total sales.
    repo.salesRepLeaderboard.mockResolvedValue([
      { closed_by_user_id: "u1", staff_name: "Ada", closed_count: 10, total_ngn: "500000" },
      { closed_by_user_id: "u2", staff_name: "Bola", closed_count: 6, total_ngn: "300000" },
      { closed_by_user_id: null, staff_name: null, closed_count: 4, total_ngn: "150000" },
    ]);
    repo.salesChannelMix.mockResolvedValue([
      { sales_channel: "whatsapp", closed_count: 9, attributed_count: 9, total_ngn: "450000" },
      { sales_channel: "storefront", closed_count: 4, attributed_count: 0, total_ngn: "150000" },
    ]);

    const r = await service.salesReport({ brand: "pixiegirl", ...PERIOD, withCompare: false });

    expect(r.winner.staff_name).toBe("Ada");
    expect(r.winner.rank).toBe(1);
    // 10 of 20 total sales = 50%.
    expect(r.winner.share_pct).toBe(50);
    expect(r.leaderboard).toHaveLength(2);
    expect(r.leaderboard[1].staff_name).toBe("Bola");
    // Online bucket is separate — never a leaderboard row.
    expect(r.unattributed.closed_count).toBe(4);
    expect(r.unattributed.share_pct).toBe(20);
    expect(r.totals.total_closed).toBe(20);
    expect(r.totals.attributed_closed).toBe(16);
    expect(r.totals.unattributed_closed).toBe(4);
    // Channel labels + self-service flag.
    const store = r.channel_mix.find((c) => c.channel === "storefront");
    expect(store.self_service).toBe(true);
    expect(store.label).toBe("Storefront (website)");
  });

  test("no staff-closed sales → null winner, empty leaderboard", async () => {
    repo.salesRepLeaderboard.mockResolvedValue([
      { closed_by_user_id: null, staff_name: null, closed_count: 3, total_ngn: "90000" },
    ]);
    repo.salesChannelMix.mockResolvedValue([]);
    const r = await service.salesReport({ brand: "pixiegirl", ...PERIOD, withCompare: false });
    expect(r.winner).toBeNull();
    expect(r.leaderboard).toHaveLength(0);
    expect(r.unattributed.closed_count).toBe(3);
  });
});

describe("attendanceReport", () => {
  test("computes on-time % of present days; null when never present", async () => {
    repo.attendanceSummary.mockResolvedValue([
      {
        profile_id: "p1", staff_name: "Ada", present_days: 20, late_days: 4,
        absent_days: 1, leave_days: 0, offsite_days: 2, total_minutes_late: 60, hours_worked: 160,
      },
      {
        profile_id: "p2", staff_name: "Chidi", present_days: 0, late_days: 0,
        absent_days: 22, leave_days: 0, offsite_days: 0, total_minutes_late: 0, hours_worked: 0,
      },
    ]);
    const r = await service.attendanceReport({ brand: "pixiegirl", ...PERIOD });
    // 16 punctual of 20 present = 80%.
    expect(r.staff[0].on_time_pct).toBe(80);
    // No present days → not rated.
    expect(r.staff[1].on_time_pct).toBeNull();
    expect(r.totals.present_days).toBe(20);
    expect(r.totals.absent_days).toBe(23);
    expect(r.totals.staff_count).toBe(2);
  });
});

describe("previousPeriod", () => {
  test("equal-length window immediately before", () => {
    expect(service.previousPeriod({ from: "2026-07-01", to: "2026-07-31" })).toEqual({
      from: "2026-05-31",
      to: "2026-06-30",
    });
  });
});

describe("buildWorkbook", () => {
  test("produces a non-empty xlsx buffer from reports", async () => {
    const sales = {
      period: PERIOD,
      winner: { rank: 1, staff_name: "Ada", closed_count: 10, share_pct: 50, total_ngn: "500000.00" },
      leaderboard: [{ rank: 1, staff_name: "Ada", closed_count: 10, share_pct: 50, total_ngn: "500000.00" }],
      unattributed: { closed_count: 4, total_ngn: "150000.00", share_pct: 20, label: "Online / self-service (unattributed)" },
      channel_mix: [{ channel: "whatsapp", label: "WhatsApp", self_service: false, closed_count: 9, attributed_count: 9, total_ngn: "450000.00", share_pct: 45 }],
      totals: { total_closed: 20, attributed_closed: 16, unattributed_closed: 4, total_ngn: "650000.00", attributed_ngn: "500000.00", rep_count: 2 },
    };
    const attendance = {
      period: PERIOD,
      staff: [{ profile_id: "p1", staff_name: "Ada", present_days: 20, late_days: 4, absent_days: 1, leave_days: 0, offsite_days: 2, total_minutes_late: 60, hours_worked: 160, on_time_pct: 80 }],
      totals: {},
    };
    const buf = await buildWorkbook({ sales, attendance, brand: "pixiegirl" });
    expect(buf.byteLength).toBeGreaterThan(1000);
  });
});
