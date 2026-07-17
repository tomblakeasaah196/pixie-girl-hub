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

const BIO_ALIASES = ["bio", "biography", "about", "description"];
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

/**
 * Extract the normalised { follower_count, bio, avatar_url, metrics } shape
 * the dashboard renders, from one actor's raw dataset item + that
 * platform's configured metrics_schema.
 */
function extractMetrics(item, metricsSchema) {
  const metrics = {};
  let follower_count = null;
  for (const spec of Array.isArray(metricsSchema) ? metricsSchema : []) {
    const raw = pluck(item, spec.aliases || [spec.key]);
    const value = toCount(raw);
    if (value !== null) metrics[spec.key] = value;
    if (spec.key === "followers" || spec.key === "subscribers") {
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

/**
 * Scrape a single account. Returns { ok: true, ...fields } or
 * { ok: false, error }. Never throws — every failure mode (no actor
 * configured, Apify error, empty dataset) is a soft failure so the caller
 * (cron loop or manual sync) can record it against the one account without
 * aborting the batch.
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
    const extracted = extractMetrics(item, platform.metrics_schema);
    return { ok: true, ...extracted, raw: item };
  } catch (err) {
    return { ok: false, error: err.message || "Scrape failed" };
  }
}

module.exports = { scrapeAccount, extractMetrics, pluck };
