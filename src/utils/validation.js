/**
 * Shared validation primitives — reusable Zod schemas.
 */

"use strict";

const { z } = require("zod");
const { fromZonedTime } = require("date-fns-tz");

const uuid = z.string().uuid();
const email = z.string().email().max(255);
const phone = z.string().min(7).max(20);
const ngnAmount = z.coerce.number().nonnegative().multipleOf(0.01);
const currencyCode = z.enum(["NGN", "USD", "GBP", "EUR", "CAD", "GHS"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ── Flexible ISO 8601 datetimes ────────────────────────────
//
// Different writers send different shapes at the same endpoint: the admin
// modals send UTC ("...Z"), the AI Chief of Staff naturally emits Lagos
// offsets ("...+01:00"), and both models and humans sometimes drop the zone
// entirely ("2026-07-17T18:00") or send a bare date. Rejecting all but one
// shape is what broke CoS task writes (due_at "Invalid datetime"), so these
// helpers accept every unambiguous ISO form and normalise to a UTC instant.

const TZ_FALLBACK = "Africa/Lagos";
/**
 * Business wall-clock timezone. Read straight from process.env (same TZ var
 * config/env validates, same default) rather than through `config` — the
 * config proxy hard-exits on a missing env, which would make merely requiring
 * a validator fatal in unit tests.
 */
function businessTz() {
  return process.env.TZ || TZ_FALLBACK;
}

const HAS_ZONE_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a flexible ISO 8601 datetime string to a UTC ISO string, or null when
 * it cannot be understood. Accepted shapes:
 *   - "2026-07-17T18:00:00Z" / "...+01:00"  (any zone designator)
 *   - "2026-07-17T18:00[:00]"               (no zone — business TZ wall clock)
 *   - "2026-07-17"                          (only when `dateOnlyTime` is set —
 *                                            that wall-clock time in business TZ)
 * @param {string} value
 * @param {{dateOnlyTime?: string|null}} [opts]
 * @returns {string|null}
 */
function parseFlexDatetime(value, { dateOnlyTime = null } = {}) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  let parsed = null;
  if (DATE_ONLY_RE.test(s)) {
    if (!dateOnlyTime) return null;
    parsed = fromZonedTime(`${s}T${dateOnlyTime}`, businessTz());
  } else if (LOCAL_RE.test(s)) {
    parsed = fromZonedTime(s.replace(" ", "T"), businessTz());
  } else if (HAS_ZONE_RE.test(s)) {
    parsed = new Date(s);
  } else {
    return null;
  }
  return parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : null;
}

/**
 * Zod schema for a flexible ISO datetime (see parseFlexDatetime). Output is a
 * normalised UTC ISO string. Pass `dateOnlyTime` ("HH:MM:SS") to also accept
 * bare YYYY-MM-DD dates at that business-timezone wall-clock time.
 */
function flexDatetime(opts = {}) {
  return z.string().transform((s, ctx) => {
    const iso = parseFlexDatetime(s, opts);
    if (!iso) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Invalid datetime — use ISO 8601, e.g. 2026-07-17T18:00:00+01:00 or 2026-07-17T18:00" +
          (opts.dateOnlyTime ? " or 2026-07-17" : ""),
      });
      return z.NEVER;
    }
    return iso;
  });
}

module.exports = {
  uuid,
  email,
  phone,
  ngnAmount,
  currencyCode,
  isoDate,
  flexDatetime,
  parseFlexDatetime,
};
