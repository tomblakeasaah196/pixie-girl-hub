/**
 * Performance → Insights service (Sales-exec of the month + Attendance).
 *
 * Shapes the raw aggregates from insights.repo into the payloads the Insights
 * tab renders: a ranked sales-rep leaderboard with a highlighted winner, the
 * self-service ("Online") bucket kept separate so nobody is credited with a
 * sale they didn't close, a channel mix, and a per-staff attendance table with
 * on-time %. Money stays as strings (NGN, 2dp).
 *
 * Period: callers pass `from`/`to` (ISO dates). Missing → current calendar
 * month. A previous window of equal length is computed for the compare deltas.
 */

"use strict";

const repo = require("./insights.repo");

// Human labels for the approved V2.2 channels (plus legacy values kept for
// historical rows). Unknown values fall through to a title-cased default.
const CHANNEL_LABELS = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  storefront: "Storefront (website)",
  sales_campaign: "Sales campaign",
  walk_in: "Walk-in",
  event: "Event",
  public_form: "Order form",
  phone: "Phone",
  facebook: "Facebook",
  tiktok: "TikTok",
  pos: "POS (legacy)",
  woocommerce: "WooCommerce (legacy)",
  wholesale: "Wholesale",
  partner: "Partner",
  stylist_routed: "Stylist-routed",
  subscription: "Subscription",
  intercompany: "Inter-company",
};

// Channels where the buyer checks out themselves — no staff "closed" it, so
// their sales are counted in the total but never credited to an individual.
const SELF_SERVICE_CHANNELS = new Set([
  "storefront",
  "woocommerce",
  "public_form",
  "sales_campaign",
]);

const money = (v) => Number(v || 0);
const pct = (n, d) => (d > 0 ? Number(((n / d) * 100).toFixed(1)) : 0);
const iso = (d) => d.toISOString().slice(0, 10);

/** Resolve {from, to} (inclusive ISO dates) — defaults to the current month. */
function resolvePeriod({ from, to } = {}) {
  if (from && to) return { from, to };
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: from || iso(first), to: to || iso(last) };
}

/** The equal-length window immediately before [from, to] — for compare deltas. */
function previousPeriod({ from, to }) {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const days = Math.round((t - f) / 86400000) + 1;
  const prevTo = new Date(f.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

function channelLabel(key) {
  if (CHANNEL_LABELS[key]) return CHANNEL_LABELS[key];
  return String(key || "unknown")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Sales-exec leaderboard + winner + channel mix for a period. */
async function salesReport({ brand, from, to, withCompare = true }) {
  const period = resolvePeriod({ from, to });
  const [rows, channelRows] = await Promise.all([
    repo.salesRepLeaderboard({ brand, ...period }),
    repo.salesChannelMix({ brand, ...period }),
  ]);

  const reps = rows.filter((r) => r.closed_by_user_id);
  const onlineRow = rows.find((r) => !r.closed_by_user_id);

  const totalClosed = rows.reduce((s, r) => s + r.closed_count, 0);
  const totalNgn = rows.reduce((s, r) => s + money(r.total_ngn), 0);
  const attributedClosed = reps.reduce((s, r) => s + r.closed_count, 0);
  const attributedNgn = reps.reduce((s, r) => s + money(r.total_ngn), 0);

  const leaderboard = reps.map((r, idx) => ({
    rank: idx + 1,
    user_id: r.closed_by_user_id,
    staff_name: r.staff_name || "Unknown staff",
    closed_count: r.closed_count,
    total_ngn: money(r.total_ngn).toFixed(2),
    // Share of ALL sales in the period (their closed count ÷ total sales).
    share_pct: pct(r.closed_count, totalClosed),
  }));

  const unattributed = {
    closed_count: onlineRow ? onlineRow.closed_count : 0,
    total_ngn: onlineRow ? money(onlineRow.total_ngn).toFixed(2) : "0.00",
    share_pct: onlineRow ? pct(onlineRow.closed_count, totalClosed) : 0,
    label: "Online / self-service (unattributed)",
  };

  const channel_mix = channelRows.map((c) => ({
    channel: c.sales_channel,
    label: channelLabel(c.sales_channel),
    self_service: SELF_SERVICE_CHANNELS.has(c.sales_channel),
    closed_count: c.closed_count,
    attributed_count: c.attributed_count,
    total_ngn: money(c.total_ngn).toFixed(2),
    share_pct: pct(c.closed_count, totalClosed),
  }));

  let compare = null;
  if (withCompare) {
    const prev = previousPeriod(period);
    const prevRows = await repo.salesRepLeaderboard({ brand, ...prev });
    const prevClosed = prevRows.reduce((s, r) => s + r.closed_count, 0);
    const prevNgn = prevRows.reduce((s, r) => s + money(r.total_ngn), 0);
    compare = {
      period: prev,
      total_closed: prevClosed,
      total_ngn: prevNgn.toFixed(2),
      closed_delta: totalClosed - prevClosed,
      ngn_delta: (totalNgn - prevNgn).toFixed(2),
    };
  }

  return {
    period,
    winner: leaderboard[0] || null,
    leaderboard,
    unattributed,
    channel_mix,
    totals: {
      total_closed: totalClosed,
      attributed_closed: attributedClosed,
      unattributed_closed: totalClosed - attributedClosed,
      total_ngn: totalNgn.toFixed(2),
      attributed_ngn: attributedNgn.toFixed(2),
      rep_count: reps.length,
    },
    compare,
  };
}

/** Per-staff attendance summary (present / late / absent + on-time %). */
async function attendanceReport({ brand, from, to }) {
  const period = resolvePeriod({ from, to });
  const rows = await repo.attendanceSummary({ brand, ...period });

  const staff = rows.map((r) => {
    const punctual = Math.max(r.present_days - r.late_days, 0);
    return {
      profile_id: r.profile_id,
      staff_name: r.staff_name,
      present_days: r.present_days,
      late_days: r.late_days,
      absent_days: r.absent_days,
      leave_days: r.leave_days,
      offsite_days: r.offsite_days,
      total_minutes_late: r.total_minutes_late,
      hours_worked: Number(r.hours_worked || 0),
      // On-time % of the days present (present but not late ÷ present). Null
      // when the staff had no present days in the window (nothing to rate).
      on_time_pct: r.present_days ? pct(punctual, r.present_days) : null,
    };
  });

  const totals = staff.reduce(
    (a, s) => ({
      present_days: a.present_days + s.present_days,
      late_days: a.late_days + s.late_days,
      absent_days: a.absent_days + s.absent_days,
      leave_days: a.leave_days + s.leave_days,
      offsite_days: a.offsite_days + s.offsite_days,
      hours_worked: a.hours_worked + s.hours_worked,
    }),
    { present_days: 0, late_days: 0, absent_days: 0, leave_days: 0, offsite_days: 0, hours_worked: 0 },
  );
  const punctualTotal = Math.max(totals.present_days - totals.late_days, 0);
  totals.on_time_pct = totals.present_days ? pct(punctualTotal, totals.present_days) : null;
  totals.hours_worked = Number(totals.hours_worked.toFixed(2));
  totals.staff_count = staff.length;

  return { period, staff, totals };
}

/**
 * Announce the current period's Sales Exec of the Month to brand staff as an
 * in-app notification (Q10c). The winner gets a personalised congratulations;
 * everyone else gets the shout-out. No-op-safe: returns notified: 0 when there
 * is no attributed winner in the window.
 */
async function announceWinner({ brand, from, to }) {
  const notifications = require("../../services/notifications.service");
  const sales = await salesReport({ brand, from, to, withCompare: false });
  if (!sales.winner) {
    return { winner: null, notified: 0, period: sales.period };
  }
  const w = sales.winner;
  const userIds = await repo.brandStaffUserIds({ brand });
  const body = `${w.staff_name} closed ${w.closed_count} sale${w.closed_count === 1 ? "" : "s"} (${w.share_pct}% of all sales) — ₦${money(w.total_ngn).toLocaleString("en-NG", { minimumFractionDigits: 2 })}.`;
  let notified = 0;
  await Promise.all(
    userIds.map(async (uid) => {
      const isWinner = uid === w.user_id;
      const res = await notifications.notify({
        user_id: uid,
        business: brand,
        type: "performance_recognition",
        priority: isWinner ? "high" : "normal",
        title: isWinner ? "🏆 You're Sales Exec of the Month!" : `🏆 Sales Exec of the Month: ${w.staff_name}`,
        body: isWinner ? `Congratulations! ${body}` : body,
        reference_type: "performance_insight",
        action_url: "/performance",
      });
      if (res) notified += 1;
    }),
  );
  return { winner: w, notified, period: sales.period };
}

module.exports = {
  resolvePeriod,
  previousPeriod,
  channelLabel,
  salesReport,
  attendanceReport,
  announceWinner,
  CHANNEL_LABELS,
  SELF_SERVICE_CHANNELS,
};
