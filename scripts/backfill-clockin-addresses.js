/**
 * One-off backfill: reverse-geocode historical clock-in coordinates into a
 * human address (audit H7). New clock-ins geocode at punch time; rows created
 * before that shipped have coordinates but no `formatted_address`, so they
 * show "View on map" instead of a label. This walks those rows and fills the
 * label via Geoapify.
 *
 * Idempotent + best-effort: only touches rows WITH coordinates and WITHOUT an
 * address; a failed geocode leaves the row untouched (safe to re-run). Also
 * backfills the reconciled `attendance_days.clock_in_address` snapshot.
 *
 * Rate-limited to stay inside the Geoapify free tier (3,000/day).
 *
 * REQUIRES: GEOAPIFY_API_KEY in the environment (same .env as the app).
 * RUN (project root):
 *   node scripts/backfill-clockin-addresses.js
 *   BACKFILL_LIMIT=500 node scripts/backfill-clockin-addresses.js
 */

"use strict";

const {
  initDatabase,
  closeDatabase,
  query,
} = require("../src/config/database");
const { reverseGeocode } = require("../src/services/geoapify.service");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!process.env.GEOAPIFY_API_KEY) {
    console.error("GEOAPIFY_API_KEY is not set — nothing to backfill. Set it and re-run.");
    process.exitCode = 1;
    return;
  }
  try {
    await initDatabase();
    const limit = Number(process.env.BACKFILL_LIMIT) || 2500; // stay under the daily cap
    const gapMs = Number(process.env.BACKFILL_GAP_MS) || 250; // ~4 req/s

    // Clock events missing an address but carrying coordinates.
    const { rows } = await query(
      `SELECT event_id, latitude, longitude
         FROM shared.staff_clock_events
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND (formatted_address IS NULL OR formatted_address = '')
        ORDER BY occurred_at DESC
        LIMIT $1`,
      [limit],
    );
    console.warn(`Clock events to backfill: ${rows.length}`);

    let ok = 0;
    let miss = 0;
    for (const r of rows) {
      const label = await reverseGeocode(r.latitude, r.longitude);
      if (label) {
        await query(
          `UPDATE shared.staff_clock_events SET formatted_address = $2 WHERE event_id = $1`,
          [r.event_id, label],
        );
        // Keep the reconciled attendance-day snapshot in sync when it points here.
        await query(
          `UPDATE shared.attendance_days
              SET clock_in_address = $2
            WHERE clock_event_id = $1
              AND (clock_in_address IS NULL OR clock_in_address = '')`,
          [r.event_id, label],
        );
        ok++;
      } else {
        miss++;
      }
      await sleep(gapMs);
    }

    console.warn(`Done. Labelled: ${ok}, no-result/failed: ${miss}.`);
  } catch (err) {
    console.error("Backfill failed:", err.message);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
})();
