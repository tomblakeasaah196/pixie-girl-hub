/**
 * Segment presets sweep (V2.2 §6.1 CRM + §6.12 Contacts).
 * Runs nightly (04:00 Africa/Lagos).
 *
 * Two jobs in one pass, per brand:
 *   1. Seed/refresh the PRESET segments every CRM ships with — VIP, Big
 *      Spenders, Win-back, New Clients, Birthdays Soon — as ordinary rows in
 *      shared.contact_segments. Their `filter` uses the same flat dialect
 *      email campaigns already compile to SQL (audienceClauses), so the same
 *      preset drives the CRM client chips AND campaign audiences. A `preset`
 *      marker key inside the filter tags rows this job owns: on name
 *      collision with a hand-made segment the upsert leaves the user's row
 *      alone (unknown filter keys are ignored by audienceClauses).
 *   2. Refresh `cached_count`/`cached_at` on EVERY segment of the brand so
 *      dashboard counts stop being stale zeros.
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const { BRANDS } = require("../../config/brands");
const {
  audienceClauses,
} = require("../../modules/email_campaigns/email-campaigns.repo");
const P = require("../../modules/crm/crm.presets");

// Thresholds come from crm.presets.js (shared with the CRM clients list) so
// "VIP" means the same thing everywhere. The nightly upsert only rewrites
// rows still marked with their original `preset` key — a hand-edited segment
// that dropped the marker is left alone.
const PRESETS = [
  {
    name: "VIP",
    description: `Lifetime spend of ₦${P.VIP_SPEND_NGN.toLocaleString("en-NG")} or more`,
    filter: { preset: "vip", min_lifetime_spend: P.VIP_SPEND_NGN },
  },
  {
    name: "Big Spenders",
    description: `Lifetime spend of ₦${P.BIG_SPENDER_SPEND_NGN.toLocaleString("en-NG")} or more`,
    filter: { preset: "big_spender", min_lifetime_spend: P.BIG_SPENDER_SPEND_NGN },
  },
  {
    name: "Win-back",
    description: `Bought before, but nothing in the last ${P.WINBACK_LAPSED_DAYS} days`,
    filter: { preset: "win_back", lapsed_days: P.WINBACK_LAPSED_DAYS },
  },
  {
    name: "New Clients",
    description: `Joined in the last ${P.NEW_CLIENT_DAYS} days`,
    filter: { preset: "new", created_within_days: P.NEW_CLIENT_DAYS },
  },
  {
    name: "Birthdays Soon",
    description: `Birthday within the next ${P.BIRTHDAY_SOON_DAYS} days`,
    filter: { preset: "birthdays_soon", birthday_within_days: P.BIRTHDAY_SOON_DAYS },
  },
];

async function upsertPresets(brand) {
  for (const p of PRESETS) {
    await query(
      `INSERT INTO shared.contact_segments (business, name, description, filter)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (business, name) DO UPDATE
         SET description = EXCLUDED.description, filter = EXCLUDED.filter
       WHERE shared.contact_segments.filter ? 'preset'`,
      [brand, p.name, p.description, JSON.stringify(p.filter)],
    );
  }
}

/** Count brand-visible contacts matching a segment filter. */
async function countMatches(brand, filter) {
  const params = [brand];
  const clauses = audienceClauses({ filter, brand, alias: "c", params });
  const extra = clauses.length ? `AND ${clauses.join("\n        AND ")}` : "";
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n
       FROM shared.contacts c
      WHERE c.is_deleted = false
        AND ($1 = ANY(c.visible_to) OR c.visible_to = '{}')
        ${extra}`,
    params,
  );
  return rows[0].n;
}

async function refreshCounts(brand) {
  const { rows: segments } = await query(
    `SELECT segment_id, filter FROM shared.contact_segments WHERE business = $1`,
    [brand],
  );
  let refreshed = 0;
  for (const s of segments) {
    try {
      const n = await countMatches(brand, s.filter || {});
      await query(
        `UPDATE shared.contact_segments
            SET cached_count = $2, cached_at = now()
          WHERE segment_id = $1`,
        [s.segment_id, n],
      );
      refreshed += 1;
    } catch (err) {
      logger.error(
        { err: err.message, brand, segment_id: s.segment_id },
        "segment count refresh failed",
      );
    }
  }
  return refreshed;
}

async function runSegmentPresetRefresh() {
  let refreshed = 0;
  for (const brand of BRANDS) {
    try {
      await upsertPresets(brand);
      refreshed += await refreshCounts(brand);
    } catch (err) {
      logger.error({ err: err.message, brand }, "segment preset sweep failed");
    }
  }
  logger.info({ refreshed }, "segment preset sweep done");
  return { refreshed };
}

module.exports = { runSegmentPresetRefresh, PRESETS };
