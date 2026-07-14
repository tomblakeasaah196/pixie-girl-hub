/**
 * Social Studio — performance score (V2.2 §6.14 Team/Performance tab).
 *
 * Pure, unit-tested formula. Deliberately separate from creative_rating (a
 * manager's subjective star rating) — this number is 100% derived from
 * timeliness + engagement data, never blended with the subjective one. The
 * two are shown side by side as a post's "Post Grade".
 *
 *   Timeliness  (0-30) — posted on/before the deadline scores full marks;
 *               each hour late costs 1 point down to 0 at 30h late; a post
 *               that was never proven (flagged) scores 0 here.
 *   Engagement  (0-70) — (likes+comments+shares+saves) / max(reach,1),
 *               mapped against rough cross-platform engagement-rate norms.
 *               No metrics recorded yet -> 0 (component pending, not "bad";
 *               callers should treat a null score as "not yet computed").
 */

"use strict";

const TIMELINESS_MAX = 30;
const ENGAGEMENT_MAX = 70;
const LATE_GRACE_HOURS = 30; // hours late at which timeliness bottoms out at 0

const ENGAGEMENT_BANDS = [
  { minRate: 0.06, points: ENGAGEMENT_MAX },
  { minRate: 0.03, points: 50 },
  { minRate: 0.01, points: 30 },
  { minRate: 0, points: 15 },
];

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** @returns {number} 0-30 */
function timelinessScore({ scheduledFor, postedAt }) {
  if (!postedAt) return 0;
  if (!scheduledFor) return TIMELINESS_MAX;
  const lateMs =
    new Date(postedAt).getTime() - new Date(scheduledFor).getTime();
  if (lateMs <= 0) return TIMELINESS_MAX;
  const lateHours = lateMs / 3_600_000;
  const fraction = clamp(1 - lateHours / LATE_GRACE_HOURS, 0, 1);
  return Math.round(fraction * TIMELINESS_MAX);
}

/** @returns {number|null} 0-70, or null if no engagement data exists yet */
function engagementScore(metrics) {
  if (!metrics) return null;
  const reach = Number(metrics.reach) || 0;
  if (reach <= 0) return null;
  const engaged =
    (Number(metrics.likes) || 0) +
    (Number(metrics.comments) || 0) +
    (Number(metrics.shares) || 0) +
    (Number(metrics.saves) || 0);
  const rate = engaged / reach;
  const band = ENGAGEMENT_BANDS.find((b) => rate >= b.minRate);
  return band ? band.points : 0;
}

/**
 * @param {{status:string, scheduledFor:?string, postedAt:?string, metrics:?object}} post
 * @returns {number|null} 0-100, rounded to 2dp; null if the post was never
 *          posted (flagged/draft/scheduled) — there is nothing to score yet.
 */
function computePerformanceScore({ status, scheduledFor, postedAt, metrics }) {
  if (status !== "posted") return null;
  const timeliness = timelinessScore({ scheduledFor, postedAt });
  const engagement = engagementScore(metrics);
  if (engagement === null) return timeliness; // engagement pending: partial score
  return Number((timeliness + engagement).toFixed(2));
}

module.exports = {
  computePerformanceScore,
  timelinessScore,
  engagementScore,
  TIMELINESS_MAX,
  ENGAGEMENT_MAX,
  LATE_GRACE_HOURS,
};
