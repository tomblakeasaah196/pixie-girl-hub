/**
 * Social publishers (V2.2 §6.14) — real outbound posting to the four platforms.
 *
 *   instagram → Meta Graph: create media container → media_publish (image/reel)
 *   facebook  → Meta Graph Page: /photos | /videos | /feed
 *   tiktok    → Content Posting API: PULL_FROM_URL video init
 *   youtube   → Data API v3 videos.insert (multipart upload from media URL)
 *
 * Creds come from env (one account per platform; blank → that platform's
 * publish/metrics throw a clean 503, and the caller marks the post 'failed').
 * `publish(post)` returns { external_post_id, permalink }. `fetchMetrics` maps
 * to the social_post_metrics shape; unsupported metrics come back as 0.
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");
const { AppError } = require("../utils/errors");

const GRAPH = () => `https://graph.facebook.com/${config.META_GRAPH_VERSION}`;

function unavailable(platform, what) {
  throw new AppError(
    "SOCIAL_NOT_CONFIGURED",
    `${platform} ${what} is not configured`,
    503,
  );
}

function fullCaption(post) {
  const tags =
    Array.isArray(post.hashtags) && post.hashtags.length
      ? "\n\n" +
        post.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")
      : "";
  return `${post.caption || ""}${tags}`.trim();
}

function isVideo(post) {
  return ["video", "reel", "short"].includes(post.post_type);
}

function isPlatformConfigured(platform) {
  switch (platform) {
    case "instagram":
      return Boolean(config.META_IG_USER_ID && config.META_FB_PAGE_TOKEN);
    case "facebook":
      return Boolean(config.META_FB_PAGE_ID && config.META_FB_PAGE_TOKEN);
    case "tiktok":
      return Boolean(config.TIKTOK_ACCESS_TOKEN);
    case "youtube":
      return Boolean(config.YOUTUBE_ACCESS_TOKEN);
    default:
      return false;
  }
}

// ── Instagram ──────────────────────────────────────────────
async function publishInstagram(post) {
  if (!isPlatformConfigured("instagram"))
    unavailable("Instagram", "publishing");
  const igId = config.META_IG_USER_ID;
  const token = config.META_FB_PAGE_TOKEN;
  const media = (post.media_urls || [])[0];
  if (!media)
    throw new AppError("NO_MEDIA", "Instagram requires a media URL", 422);

  const containerBody = isVideo(post)
    ? { media_type: "REELS", video_url: media, caption: fullCaption(post) }
    : { image_url: media, caption: fullCaption(post) };
  const { data: container } = await axios.post(
    `${GRAPH()}/${igId}/media`,
    { ...containerBody, access_token: token },
    { timeout: 60000 },
  );
  const { data: published } = await axios.post(
    `${GRAPH()}/${igId}/media_publish`,
    { creation_id: container.id, access_token: token },
    { timeout: 60000 },
  );
  return {
    external_post_id: published.id,
    permalink: `https://www.instagram.com/p/${published.id}/`,
  };
}

async function metricsInstagram(external_post_id) {
  const token = config.META_FB_PAGE_TOKEN;
  const { data } = await axios.get(`${GRAPH()}/${external_post_id}/insights`, {
    params: {
      metric: "impressions,reach,likes,comments,saved,shares",
      access_token: token,
    },
    timeout: 30000,
  });
  const m = {};
  for (const row of data.data || []) {
    const v = row.values && row.values[0] ? row.values[0].value : 0;
    m[row.name] = v;
  }
  return {
    impressions: m.impressions || 0,
    reach: m.reach || 0,
    likes: m.likes || 0,
    comments: m.comments || 0,
    shares: m.shares || 0,
    saves: m.saved || 0,
  };
}

// ── Facebook Page ──────────────────────────────────────────
async function publishFacebook(post) {
  if (!isPlatformConfigured("facebook")) unavailable("Facebook", "publishing");
  const pageId = config.META_FB_PAGE_ID;
  const token = config.META_FB_PAGE_TOKEN;
  const media = (post.media_urls || [])[0];
  const message = fullCaption(post);

  let endpoint;
  let body;
  if (isVideo(post) && media) {
    endpoint = `${GRAPH()}/${pageId}/videos`;
    body = { file_url: media, description: message };
  } else if (media) {
    endpoint = `${GRAPH()}/${pageId}/photos`;
    body = { url: media, caption: message };
  } else {
    endpoint = `${GRAPH()}/${pageId}/feed`;
    body = { message };
  }
  const { data } = await axios.post(
    endpoint,
    { ...body, access_token: token },
    { timeout: 60000 },
  );
  const id = data.post_id || data.id;
  return { external_post_id: id, permalink: `https://www.facebook.com/${id}` };
}

async function metricsFacebook(external_post_id) {
  const token = config.META_FB_PAGE_TOKEN;
  const { data } = await axios.get(`${GRAPH()}/${external_post_id}/insights`, {
    params: {
      metric: "post_impressions,post_impressions_unique,post_clicks",
      access_token: token,
    },
    timeout: 30000,
  });
  const m = {};
  for (const row of data.data || []) {
    const v = row.values && row.values[0] ? row.values[0].value : 0;
    m[row.name] = typeof v === "object" ? 0 : v;
  }
  return {
    impressions: m.post_impressions || 0,
    reach: m.post_impressions_unique || 0,
    link_clicks: m.post_clicks || 0,
  };
}

// ── TikTok ─────────────────────────────────────────────────
async function publishTiktok(post) {
  if (!isPlatformConfigured("tiktok")) unavailable("TikTok", "publishing");
  const media = (post.media_urls || [])[0];
  if (!media)
    throw new AppError("NO_MEDIA", "TikTok requires a video URL", 422);
  const { data } = await axios.post(
    `${config.TIKTOK_BASE_URL}/v2/post/publish/video/init/`,
    {
      post_info: {
        title: fullCaption(post).slice(0, 2200),
        privacy_level: "SELF_ONLY",
      },
      source_info: { source: "PULL_FROM_URL", video_url: media },
    },
    {
      headers: {
        Authorization: `Bearer ${config.TIKTOK_ACCESS_TOKEN}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      timeout: 60000,
    },
  );
  const publishId = data && data.data && data.data.publish_id;
  return { external_post_id: publishId || null, permalink: null };
}

// ── YouTube ────────────────────────────────────────────────
async function publishYoutube(post) {
  if (!isPlatformConfigured("youtube")) unavailable("YouTube", "publishing");
  const media = (post.media_urls || [])[0];
  if (!media)
    throw new AppError("NO_MEDIA", "YouTube requires a video URL", 422);

  // Pull the media bytes, then multipart/related upload to videos.insert.
  const file = await axios.get(media, {
    responseType: "arraybuffer",
    timeout: 120000,
  });
  const metadata = {
    snippet: {
      title: (post.caption || "Untitled").slice(0, 100),
      description: fullCaption(post),
    },
    status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
  };
  const boundary = `pxg_${Date.now()}`;
  const parts = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify(metadata) +
        `\r\n--${boundary}\r\nContent-Type: video/*\r\n\r\n`,
    ),
    Buffer.from(file.data),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const { data } = await axios.post(
    `${config.YOUTUBE_BASE_URL}/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart`,
    parts,
    {
      headers: {
        Authorization: `Bearer ${config.YOUTUBE_ACCESS_TOKEN}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      maxBodyLength: Infinity,
      timeout: 180000,
    },
  );
  return {
    external_post_id: data.id,
    permalink: data.id ? `https://www.youtube.com/watch?v=${data.id}` : null,
  };
}

async function metricsYoutube(external_post_id) {
  const { data } = await axios.get(
    `${config.YOUTUBE_BASE_URL}/youtube/v3/videos`,
    {
      params: { part: "statistics", id: external_post_id },
      headers: { Authorization: `Bearer ${config.YOUTUBE_ACCESS_TOKEN}` },
      timeout: 30000,
    },
  );
  const s = (data.items && data.items[0] && data.items[0].statistics) || {};
  return {
    video_views: Number(s.viewCount || 0),
    likes: Number(s.likeCount || 0),
    comments: Number(s.commentCount || 0),
  };
}

// ── Dispatch ───────────────────────────────────────────────
const PUBLISHERS = {
  instagram: publishInstagram,
  facebook: publishFacebook,
  tiktok: publishTiktok,
  youtube: publishYoutube,
};
const METRICS = {
  instagram: metricsInstagram,
  facebook: metricsFacebook,
  youtube: metricsYoutube,
  // tiktok metrics need the (separate) research/insights scope — omitted.
};

async function publish(post) {
  const fn = PUBLISHERS[post.platform];
  if (!fn)
    throw new AppError(
      "UNSUPPORTED_PLATFORM",
      `No publisher for ${post.platform}`,
      422,
    );
  return fn(post);
}
async function fetchMetrics(platform, external_post_id) {
  const fn = METRICS[platform];
  if (!fn || !external_post_id) return null;
  return fn(external_post_id);
}

module.exports = { isPlatformConfigured, publish, fetchMetrics };
