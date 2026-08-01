/**
 * Performance → Insights repository (Sales-exec of the month + Attendance).
 *
 * Read-only aggregates for the Performance workspace's Insights tab. Two data
 * sources:
 *   • Sales-rep leaderboard + channel mix — brand-scoped <brand>.sales_orders,
 *     grouped by the staff who CLOSED the sale (sales_orders.closed_by_user_id).
 *     Orders with no closer (customer self-service storefront / public form)
 *     roll up under a NULL row → surfaced as "Online / self-service".
 *   • Attendance summary — shared.attendance_days (the reconciled one-row-per-
 *     staff-per-day truth), joined to staff_profiles → contacts for the name.
 *
 * All money stays as strings (NGN, 2dp) per API convention. Every read is
 * brand-scoped and parameterised.
 */

"use strict";

const { ex } = require("../../config/database");
const { t } = require("../../config/brands");

// Which orders count as a "closed sale" for the leaderboard: confirmed orders,
// excluding never-realised or reversed ones. This is the honest "total number
// of sales" the share is taken out of.
const NON_SALE_STATES = ["draft", "cancelled", "refunded", "failed"];

/**
 * Per-closer leaderboard for a date range. One row per staff who closed at
 * least one sale, PLUS a single NULL-closer row aggregating self-service
 * (storefront / public-form) orders. `total_ngn` is the summed order value.
 */
async function salesRepLeaderboard({ client, brand, from, to }) {
  const { rows } = await ex(client)(
    `SELECT so.closed_by_user_id,
            u.display_name                          AS staff_name,
            count(*)::int                           AS closed_count,
            COALESCE(sum(so.total_ngn), 0)::text    AS total_ngn
       FROM ${t(brand, "sales_orders")} so
       LEFT JOIN shared.users u ON u.user_id = so.closed_by_user_id
      WHERE so.status <> ALL($1)
        AND COALESCE(so.paid_at, so.placed_at, so.created_at)::date BETWEEN $2 AND $3
      GROUP BY so.closed_by_user_id, u.display_name
      ORDER BY closed_count DESC, sum(so.total_ngn) DESC NULLS LAST`,
    [NON_SALE_STATES, from, to],
  );
  return rows;
}

/**
 * Sales split by channel for the same range — powers the channel-mix donut and
 * the "which channels drive attributed vs self-service sales" breakdown.
 */
async function salesChannelMix({ client, brand, from, to }) {
  const { rows } = await ex(client)(
    `SELECT so.sales_channel,
            count(*)::int                                              AS closed_count,
            COALESCE(sum(so.total_ngn), 0)::text                       AS total_ngn,
            count(*) FILTER (WHERE so.closed_by_user_id IS NOT NULL)::int AS attributed_count
       FROM ${t(brand, "sales_orders")} so
      WHERE so.status <> ALL($1)
        AND COALESCE(so.paid_at, so.placed_at, so.created_at)::date BETWEEN $2 AND $3
      GROUP BY so.sales_channel
      ORDER BY closed_count DESC`,
    [NON_SALE_STATES, from, to],
  );
  return rows;
}

/**
 * Per-staff attendance rollup for a date range. LEFT JOIN so every active
 * staff member appears even with zero reconciled days (all-zero row). Hours
 * worked come from first_clock_in_at..last_clock_out_at on days that have both.
 */
async function attendanceSummary({ client, brand, from, to }) {
  const { rows } = await ex(client)(
    `SELECT sp.profile_id,
            c.display_name                                                  AS staff_name,
            count(*) FILTER (WHERE ad.status IN ('present','late'))::int     AS present_days,
            count(*) FILTER (WHERE ad.status = 'late')::int                  AS late_days,
            count(*) FILTER (WHERE ad.status = 'absent')::int               AS absent_days,
            count(*) FILTER (WHERE ad.status = 'on_leave')::int             AS leave_days,
            count(*) FILTER (WHERE ad.is_offsite)::int                       AS offsite_days,
            COALESCE(sum(ad.minutes_late), 0)::int                          AS total_minutes_late,
            COALESCE(round(sum(
              EXTRACT(EPOCH FROM (ad.last_clock_out_at - ad.first_clock_in_at)) / 3600.0
            ) FILTER (WHERE ad.last_clock_out_at IS NOT NULL
                        AND ad.first_clock_in_at IS NOT NULL), 2), 0)::float8 AS hours_worked
       FROM shared.staff_profiles sp
       JOIN shared.contacts c ON c.contact_id = sp.contact_id
       LEFT JOIN shared.attendance_days ad
              ON ad.profile_id = sp.profile_id
             AND ad.business = sp.business
             AND ad.work_date BETWEEN $2 AND $3
      WHERE sp.business = $1
        AND sp.is_deleted = false
      GROUP BY sp.profile_id, c.display_name
      ORDER BY present_days DESC, c.display_name ASC`,
    [brand, from, to],
  );
  return rows;
}

/**
 * Active staff logins for a brand — used to fan out the "Sales Exec of the
 * Month" announcement. Limited to users with a staff profile who are permitted
 * on this brand, so the shout-out reaches colleagues, not system accounts.
 */
async function brandStaffUserIds({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT user_id
       FROM shared.users
      WHERE is_active = true
        AND staff_profile_id IS NOT NULL
        AND $1 = ANY(permitted_businesses)`,
    [brand],
  );
  return rows.map((r) => r.user_id);
}

module.exports = {
  NON_SALE_STATES,
  salesRepLeaderboard,
  salesChannelMix,
  attendanceSummary,
  brandStaffUserIds,
};
