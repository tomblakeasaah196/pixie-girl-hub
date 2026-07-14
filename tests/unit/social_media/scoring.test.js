"use strict";

/**
 * Social Studio performance score (social.scoring.js) — pure, no DB.
 * Timeliness + engagement components, and the rule that only a 'posted'
 * post ever gets a score.
 */

const scoring = require("../../../src/modules/social_media/social.scoring");

describe("timelinessScore", () => {
  test("full marks when posted on or before the deadline", () => {
    expect(
      scoring.timelinessScore({
        scheduledFor: "2026-07-14T09:00:00Z",
        postedAt: "2026-07-14T08:00:00Z",
      }),
    ).toBe(scoring.TIMELINESS_MAX);
  });

  test("decays linearly the later it posts, bottoming out at 0", () => {
    const onTime = scoring.timelinessScore({
      scheduledFor: "2026-07-14T09:00:00Z",
      postedAt: "2026-07-14T09:00:00Z",
    });
    expect(onTime).toBe(scoring.TIMELINESS_MAX);

    const late15h = scoring.timelinessScore({
      scheduledFor: "2026-07-14T09:00:00Z",
      postedAt: "2026-07-15T00:00:00Z", // 15h late, half of the 30h grace window
    });
    expect(late15h).toBeGreaterThan(0);
    expect(late15h).toBeLessThan(scoring.TIMELINESS_MAX);

    const veryLate = scoring.timelinessScore({
      scheduledFor: "2026-07-14T09:00:00Z",
      postedAt: "2026-07-20T09:00:00Z", // way past the grace window
    });
    expect(veryLate).toBe(0);
  });

  test("no scheduled_for (posted straight from draft) scores full marks", () => {
    expect(
      scoring.timelinessScore({
        scheduledFor: null,
        postedAt: "2026-07-14T09:00:00Z",
      }),
    ).toBe(scoring.TIMELINESS_MAX);
  });

  test("never posted scores 0", () => {
    expect(
      scoring.timelinessScore({
        scheduledFor: "2026-07-14T09:00:00Z",
        postedAt: null,
      }),
    ).toBe(0);
  });
});

describe("engagementScore", () => {
  test("null when there are no metrics yet — pending, not bad", () => {
    expect(scoring.engagementScore(null)).toBeNull();
    expect(scoring.engagementScore({ reach: 0, likes: 10 })).toBeNull();
  });

  test("bands rate into a 0-70 score", () => {
    const excellent = scoring.engagementScore({
      reach: 1000,
      likes: 60,
      comments: 10,
      shares: 0,
      saves: 0,
    }); // 7%
    const good = scoring.engagementScore({
      reach: 1000,
      likes: 35,
      comments: 0,
      shares: 0,
      saves: 0,
    }); // 3.5%
    const fair = scoring.engagementScore({
      reach: 1000,
      likes: 15,
      comments: 0,
      shares: 0,
      saves: 0,
    }); // 1.5%
    const low = scoring.engagementScore({
      reach: 1000,
      likes: 2,
      comments: 0,
      shares: 0,
      saves: 0,
    }); // 0.2%
    expect(excellent).toBe(scoring.ENGAGEMENT_MAX);
    expect(good).toBeLessThan(excellent);
    expect(fair).toBeLessThan(good);
    expect(low).toBeLessThan(fair);
    expect(low).toBeGreaterThan(0);
  });
});

describe("computePerformanceScore", () => {
  test("null for anything that isn't posted", () => {
    for (const status of [
      "draft",
      "assigned",
      "scheduled",
      "flagged",
      "archived",
    ]) {
      expect(
        scoring.computePerformanceScore({
          status,
          scheduledFor: null,
          postedAt: null,
          metrics: null,
        }),
      ).toBeNull();
    }
  });

  test("partial (timeliness-only) score before metrics are recorded", () => {
    const score = scoring.computePerformanceScore({
      status: "posted",
      scheduledFor: "2026-07-14T09:00:00Z",
      postedAt: "2026-07-14T08:00:00Z",
      metrics: null,
    });
    expect(score).toBe(scoring.TIMELINESS_MAX);
  });

  test("full score combines timeliness + engagement once metrics land", () => {
    const score = scoring.computePerformanceScore({
      status: "posted",
      scheduledFor: "2026-07-14T09:00:00Z",
      postedAt: "2026-07-14T08:00:00Z",
      metrics: { reach: 1000, likes: 60, comments: 10, shares: 0, saves: 0 },
    });
    expect(score).toBe(scoring.TIMELINESS_MAX + scoring.ENGAGEMENT_MAX);
  });
});
