/**
 * Social proof service (V2.2 §6.14) — verifies a pasted "I posted this" link.
 *
 * Social Studio is manual-first: a creator posts natively from their own
 * device/app, then proves it here with a link. No OAuth, no Graph API
 * publishing — this only ever *reads* public oEmbed metadata for the link the
 * creator already gave us, which is a much lower bar than the Instagram/
 * Facebook Login + App Review the team was stuck on for auto-publishing.
 *
 *   instagram / facebook -> Meta's oEmbed Read endpoints. These still want an
 *     access token (an app token, or the existing page token already used for
 *     messaging) — if none is configured, we skip the rich embed card and
 *     just accept the link + screenshot as proof.
 *   tiktok / youtube     -> fully public oEmbed, no credentials needed.
 *
 * `fetchOEmbed(url)` never throws for a missing/unreachable embed — a proof
 * submission must not fail just because enrichment isn't available. It
 * returns `{ ok, platform, embed_html, thumbnail_url, author_handle, title }`
 * with fields null where unknown.
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");
const { logger } = require("../config/logger");

const GRAPH = () => `https://graph.facebook.com/${config.META_GRAPH_VERSION}`;

const HOST_PLATFORM = [
  [/(^|\.)instagram\.com$/i, "instagram"],
  [/(^|\.)(facebook\.com|fb\.watch)$/i, "facebook"],
  [/(^|\.)tiktok\.com$/i, "tiktok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/i, "youtube"],
];

/** Which platform a pasted URL belongs to, or null if it matches none of the
 *  four the brand posts to. */
function detectPlatform(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  for (const [re, platform] of HOST_PLATFORM) {
    if (re.test(host)) return platform;
  }
  return null;
}

/** Best-effort handle extraction from an oEmbed author_url, e.g.
 *  "https://www.instagram.com/pixiegirlglobal/" -> "pixiegirlglobal",
 *  "https://www.tiktok.com/@pixiegirlglobal" -> "pixiegirlglobal". */
function handleFromAuthorUrl(authorUrl) {
  if (!authorUrl) return null;
  try {
    const path = new URL(authorUrl).pathname;
    const seg = path.split("/").filter(Boolean)[0] || "";
    return seg.replace(/^@/, "") || null;
  } catch {
    return null;
  }
}

function empty(platform) {
  return {
    ok: false,
    platform,
    embed_html: null,
    thumbnail_url: null,
    author_handle: null,
    title: null,
  };
}

async function fetchMetaOEmbed(url, endpoint) {
  const token = config.META_FB_PAGE_TOKEN;
  if (!token) return null; // not configured — degrade gracefully, don't throw
  const { data } = await axios.get(`${GRAPH()}/${endpoint}`, {
    params: { url, access_token: token, omitscript: true },
    timeout: 15000,
  });
  return data;
}

async function fetchPublicOEmbed(oembedUrl, url) {
  const { data } = await axios.get(oembedUrl, {
    params: { url, format: "json" },
    timeout: 15000,
  });
  return data;
}

/** Fetch oEmbed metadata for a proof link. Never throws — a lookup failure
 *  (unconfigured token, deleted post, network error) just yields `ok: false`
 *  so the caller still accepts the link + screenshot as proof. */
async function fetchOEmbed(url) {
  const platform = detectPlatform(url);
  if (!platform) return empty(null);
  try {
    let data = null;
    if (platform === "instagram")
      data = await fetchMetaOEmbed(url, "instagram_oembed");
    else if (platform === "facebook")
      data = await fetchMetaOEmbed(url, "oembed_post");
    else if (platform === "tiktok")
      data = await fetchPublicOEmbed("https://www.tiktok.com/oembed", url);
    else if (platform === "youtube")
      data = await fetchPublicOEmbed("https://www.youtube.com/oembed", url);

    if (!data) return empty(platform);
    return {
      ok: true,
      platform,
      embed_html: data.html || null,
      thumbnail_url: data.thumbnail_url || null,
      author_handle:
        handleFromAuthorUrl(data.author_url) || data.author_name || null,
      title: data.title || null,
    };
  } catch (err) {
    logger.warn(
      { err: err.message, platform },
      "social-proof: oEmbed lookup failed, accepting link without enrichment",
    );
    return empty(platform);
  }
}

/** Soft verification: does the oEmbed author look like one of the brand's
 *  registered handles for this platform? Case-insensitive; a miss just sets
 *  `handle_mismatch` for a human to glance at, it never blocks the proof. */
function matchesRegisteredHandle(authorHandle, accounts) {
  if (!authorHandle || !accounts.length) return true; // nothing to compare against
  const needle = authorHandle.trim().toLowerCase();
  return accounts.some((a) => String(a.handle).trim().toLowerCase() === needle);
}

module.exports = { detectPlatform, fetchOEmbed, matchesRegisteredHandle };
