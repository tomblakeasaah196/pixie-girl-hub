/**
 * Social Studio — Apify profile scrape orchestration.
 *
 * Shared by the twice-daily cron sweep (jobs/schedulers/social-metrics-sync)
 * and the manual "Sync now" endpoint, so both paths behave identically.
 *
 * Every platform's Apify actor returns a differently-shaped dataset item
 * (author-specific field names), so instead of one hardcoded parser per
 * platform, shared.social_platforms.metrics_schema carries a small alias
 * list per metric (e.g. followers: ["followersCount","followers_count",
 * "followers"]) and extractMetrics() below walks the returned item looking
 * for the first matching key. The full raw item is always kept in
 * social_accounts.metrics regardless of what the heuristic finds, so nothing
 * an actor returns is ever silently dropped.
 */

"use strict";

const apify = require("./apify.service");

const BIO_ALIASES = ["bio", "biography", "about", "description", "tagline", "signature"];
const AVATAR_ALIASES = [
  "profilePicUrl",
  "profilePictureUrl",
  "profilePicture",
  "profile_image_url_https",
  "profile_image_url",
  "avatarUrl",
  "imageUrl",
  "avatar",
];

/** Case-insensitive, one-level-deep + one-nested-level lookup for the first
 *  key in `aliases` present on `item` (or on any plain-object value of
 *  `item`, since several actors nest stats under e.g. `authorStats`). */
function pluck(item, aliases) {
  if (!item || typeof item !== "object") return null;
  const wanted = new Set(aliases.map((a) => a.toLowerCase()));
  for (const [key, value] of Object.entries(item)) {
    if (wanted.has(key.toLowerCase()) && value !== null && value !== undefined) {
      return value;
    }
  }
  for (const value of Object.values(item)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = pluck(value, aliases);
      if (nested !== null && nested !== undefined) return nested;
    }
  }
  return null;
}

function toCount(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** A rating-style number kept to one decimal place (4.8, not rounded to 5). */
function toDecimal(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

/** A short display string. Arrays (e.g. LinkedIn specialties) are joined;
 *  nested objects aren't meaningful as a chip, so they yield null. */
function toText(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const s = value
      .filter((v) => v !== null && v !== undefined && typeof v !== "object")
      .join(", ");
    return s ? s.slice(0, 200) : null;
  }
  if (typeof value === "object") return null;
  const s = String(value).trim();
  return s ? s.slice(0, 200) : null;
}

// Only literal truthy/falsey words — actual booleans (the common actor shape,
// e.g. verified:true / permanentlyClosed:false) pass straight through above, so
// we deliberately don't map ambiguous words like "open"/"closed" here.
const TRUE_WORDS = new Set(["true", "yes", "1"]);
const FALSE_WORDS = new Set(["false", "no", "0"]);
function toBool(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return null;
}

/** Coerce one plucked value per the spec's declared type (default "count",
 *  so pre-typed schemas keep working). */
function coerce(raw, type) {
  switch (type) {
    case "decimal":
      return toDecimal(raw);
    case "text":
      return toText(raw);
    case "bool":
      return toBool(raw);
    default:
      return toCount(raw);
  }
}

/**
 * Extract the normalised { follower_count, bio, avatar_url, metrics } shape
 * the dashboard renders, from one actor's raw dataset item + that
 * platform's configured metrics_schema. Each spec carries a `type`
 * (count | decimal | text | bool, default count) so a card can show a
 * verified badge / category / rating alongside plain follower counts.
 */
function extractMetrics(item, metricsSchema) {
  const metrics = {};
  let follower_count = null;
  for (const spec of Array.isArray(metricsSchema) ? metricsSchema : []) {
    const raw = pluck(item, spec.aliases || [spec.key]);
    const type = spec.type || "count";
    const value = coerce(raw, type);
    if (value !== null && value !== undefined) metrics[spec.key] = value;
    if (
      type === "count" &&
      (spec.key === "followers" || spec.key === "subscribers")
    ) {
      follower_count = value;
    }
  }
  const bio = pluck(item, BIO_ALIASES);
  const avatar_url = pluck(item, AVATAR_ALIASES);
  return {
    follower_count,
    bio: typeof bio === "string" ? bio.slice(0, 2000) : null,
    avatar_url: typeof avatar_url === "string" ? avatar_url : null,
    metrics,
  };
}

/** Several actors report per-item failures inside an otherwise-successful run
 *  (e.g. Apify's Instagram scrapers emit `{error, errorDescription}` records
 *  for a blocked/private/rate-limited profile). Surface that as the scrape
 *  error instead of treating the record as profile data. */
function itemErrorOf(item) {
  for (const key of ["error", "errorDescription", "errorMessage"]) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (item.error === true) return "Actor reported an unspecified error for this profile";
  if (Array.isArray(item.requestErrorMessages) && item.requestErrorMessages.length) {
    return String(item.requestErrorMessages[0]);
  }
  return null;
}

/**
 * Scrape a single account. Returns { ok: true, ...fields } or
 * { ok: false, error }. Never throws — every failure mode (no actor
 * configured, Apify error, empty dataset, unusable record) is a soft failure
 * so the caller (cron loop or manual sync) can record it against the one
 * account without aborting the batch.
 */
async function scrapeAccount({ account, platform, apiKey }) {
  if (!platform.apify_actor_id) {
    return {
      ok: false,
      error: `No Apify actor configured for ${platform.display_name} yet — add one in Social Studio → Accounts → Add platform.`,
    };
  }
  try {
    const input = apify.buildActorInput(platform.apify_input_template, {
      handle: account.handle,
      profile_url: account.profile_url,
    });
    const items = await apify.runActorSync({
      apiKey,
      actorId: platform.apify_actor_id,
      input,
    });
    const item = items[0];
    if (!item) {
      return { ok: false, error: "Apify returned no data for this profile" };
    }
    const itemError = itemErrorOf(item);
    if (itemError) {
      return { ok: false, error: `Actor reported: ${itemError}` };
    }
    const extracted = extractMetrics(item, platform.metrics_schema);
    // A record that matched none of the platform's metrics is diagnostic, not
    // data — recording it as "ok" would blank the card (and, before this
    // guard, overwrote previously-good values with nothing). Name the fields
    // the actor actually returned so the mismatch is visible on the card.
    if (extracted.follower_count === null && Object.keys(extracted.metrics).length === 0) {
      const fields = Object.keys(item).slice(0, 12).join(", ");
      return {
        ok: false,
        error: `Actor returned a record but none of the expected metrics were in it (fields: ${fields || "none"})`,
      };
    }
    return { ok: true, ...extracted, raw: item };
  } catch (err) {
    return { ok: false, error: err.message || "Scrape failed" };
  }
}

module.exports = { scrapeAccount, extractMetrics, pluck, itemErrorOf };
