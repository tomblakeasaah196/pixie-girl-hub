/**
 * Frequency capping + quiet hours for the retention strategy engine
 * (Module 6.23). Protects the customer experience when many strategies are
 * active at once:
 *
 *   - Quiet hours: no retention email is sent during the configured night
 *     window (Africa/Lagos by default). The engine *defers* the step to the
 *     next active time rather than dropping it.
 *   - Frequency cap: at most N retention emails per customer per rolling
 *     window. Over the cap, the step is *suppressed* (logged, then skipped).
 *
 * Sends are counted from shared.outbound_comms_log, which the email action
 * writes to with event_key 'retention.strategy'.
 */

"use strict";

const { query } = require("../../config/database");

const DEFAULTS = {
  timezone: "Africa/Lagos",
  quiet_start_hour: 21, // 21:00 inclusive
  quiet_end_hour: 8, // 08:00 exclusive
  max_emails_per_window: 3,
  window_days: 7,
};

const EVENT_KEY = "retention.strategy";

/** Merge owner overrides (business_config.retention_settings) over defaults. */
function resolveSettings(businessConfig) {
  const o = (businessConfig && businessConfig.retention_settings) || {};
  return { ...DEFAULTS, ...o };
}

/** Current hour (0–23) in the configured timezone. */
function hourInTz(timezone, now = new Date()) {
  try {
    const h = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).format(now);
    return parseInt(h, 10) % 24;
  } catch {
    return now.getUTCHours();
  }
}

function isQuietHours(settings, now = new Date()) {
  const h = hourInTz(settings.timezone, now);
  const { quiet_start_hour: s, quiet_end_hour: e } = settings;
  if (s === e) return false;
  // Window crosses midnight (e.g. 21 → 8).
  return s > e ? h >= s || h < e : h >= s && h < e;
}

/**
 * Next time outside quiet hours. If we're inside the window, jump to
 * quiet_end_hour (today or tomorrow, in the TZ, approximated in UTC by adding
 * whole hours). Returns a Date.
 */
function nextActiveTime(settings, now = new Date()) {
  if (!isQuietHours(settings, now)) return now;
  let cursor = new Date(now.getTime());
  // Advance hour by hour until we exit the window (cheap + tz-correct).
  for (let i = 0; i < 24; i += 1) {
    cursor = new Date(cursor.getTime() + 3_600_000);
    if (!isQuietHours(settings, cursor)) return cursor;
  }
  return cursor;
}

async function recentEmailCount({ brand, contact_id, window_days }) {
  if (!contact_id) return 0;
  const { rows } = await query(
    `SELECT count(*)::int AS c FROM shared.outbound_comms_log
      WHERE business = $1 AND contact_id = $2 AND channel = 'email'
        AND event_key = $3 AND status = 'sent'
        AND created_at >= now() - ($4 || ' days')::interval`,
    [brand, contact_id, EVENT_KEY, String(window_days)],
  );
  return rows[0].c;
}

/**
 * Decide what to do with an email step right now.
 * @returns {Promise<{action:'send'|'defer'|'suppress', defer_until?:Date, reason?:string}>}
 */
async function checkEmail({ brand, contact_id, businessConfig, now = new Date() }) {
  const settings = resolveSettings(businessConfig);
  if (isQuietHours(settings, now)) {
    return {
      action: "defer",
      defer_until: nextActiveTime(settings, now),
      reason: "quiet hours",
    };
  }
  const count = await recentEmailCount({
    brand,
    contact_id,
    window_days: settings.window_days,
  });
  if (count >= settings.max_emails_per_window) {
    return {
      action: "suppress",
      reason: `frequency cap (${settings.max_emails_per_window} per ${settings.window_days}d) reached`,
    };
  }
  return { action: "send" };
}

module.exports = {
  DEFAULTS,
  EVENT_KEY,
  resolveSettings,
  isQuietHours,
  nextActiveTime,
  recentEmailCount,
  checkEmail,
};
