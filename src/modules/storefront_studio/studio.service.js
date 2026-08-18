/**
 * Storefront Studio (V2.2 §6.28) — business logic. Draft/publish editor for
 * the brand's storefront theme, pages and navigation.
 */

"use strict";

const repo = require("./studio.repo");
const events = require("./studio.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const { config } = require("../../config/env");
const storage = require("../../services/storage.service");
const {
  compressUploadChecked,
} = require("../../services/media-compression.service");
const videoClip = require("../../services/video-clip.service");
const ogBanner = require("../../services/og-banner.service");
const fs = require("fs/promises");
const {
  uniqueSlug,
  buildPostFields,
} = require("./content-helpers");

const A = (
  brand,
  user,
  action_key,
  target_type,
  target_id,
  after,
  request_id,
) =>
  audit({
    business: brand,
    user_id: user.user_id,
    action_key,
    target_type,
    target_id,
    after,
    request_id,
  });

// ── Theme ──────────────────────────────────────────────────
function getThemes({ brand }) {
  return repo.getThemes({ brand });
}

async function saveThemeDraft({ brand, user, request_id, tokens }) {
  return transaction(async (client) => {
    const existing = await repo.getThemeDraft({ client, brand });
    const draft = existing
      ? await repo.updateThemeDraft({ client, brand, tokens })
      : await repo.insertThemeDraft({
          client,
          brand,
          tokens,
          created_by: user.user_id,
        });
    await A(
      brand,
      user,
      "studio.theme.save_draft",
      "storefront_theme",
      draft.theme_id,
      {},
      request_id,
    );
    events.emit("theme.draft_saved", { brand, theme_id: draft.theme_id });
    return draft;
  });
}

async function publishTheme({ brand, user, request_id }) {
  return transaction(async (client) => {
    const published = await repo.publish({
      client,
      entity: "theme",
      brand,
      published_by: user.user_id,
    });
    if (!published) throw new NotFoundError("Theme draft");
    await A(
      brand,
      user,
      "studio.theme.publish",
      "storefront_theme",
      published.theme_id,
      {},
      request_id,
    );
    events.emit("theme.published", { brand, theme_id: published.theme_id });
    return published;
  });
}

// ── Navigation ─────────────────────────────────────────────
function getNavigation({ brand }) {
  return repo.getNavigation({ brand });
}

async function saveNavDraft({ brand, user, request_id, nav }) {
  return transaction(async (client) => {
    const existing = await repo.getNavDraft({ client, brand });
    const draft = existing
      ? await repo.updateNavDraft({ client, brand, nav })
      : await repo.insertNavDraft({
          client,
          brand,
          nav,
          created_by: user.user_id,
        });
    await A(
      brand,
      user,
      "studio.nav.save_draft",
      "storefront_navigation",
      draft.nav_id,
      {},
      request_id,
    );
    events.emit("nav.draft_saved", { brand, nav_id: draft.nav_id });
    return draft;
  });
}

async function publishNav({ brand, user, request_id }) {
  return transaction(async (client) => {
    const published = await repo.publish({
      client,
      entity: "navigation",
      brand,
      published_by: user.user_id,
    });
    if (!published) throw new NotFoundError("Navigation draft");
    await A(
      brand,
      user,
      "studio.nav.publish",
      "storefront_navigation",
      published.nav_id,
      {},
      request_id,
    );
    events.emit("nav.published", { brand, nav_id: published.nav_id });
    return published;
  });
}

// ── Pages ──────────────────────────────────────────────────
function listPages({ brand }) {
  return repo.listPages({ brand });
}

async function savePageDraft({ brand, user, request_id, page }) {
  return transaction(async (client) => {
    const existing = await repo.getPageDraft({
      client,
      brand,
      page_key: page.page_key,
    });
    const draft = existing
      ? await repo.updatePageDraft({
          client,
          brand,
          page_key: page.page_key,
          page,
        })
      : await repo.insertPageDraft({
          client,
          brand,
          page,
          created_by: user.user_id,
        });
    await A(
      brand,
      user,
      "studio.page.save_draft",
      "storefront_page",
      draft.page_id,
      { page_key: page.page_key },
      request_id,
    );
    events.emit("page.draft_saved", { brand, page_id: draft.page_id });
    return draft;
  });
}

async function publishPage({ brand, user, request_id, page_key }) {
  return transaction(async (client) => {
    const published = await repo.publish({
      client,
      entity: "page",
      brand,
      page_key,
      published_by: user.user_id,
    });
    if (!published) throw new NotFoundError("Page draft");
    await A(
      brand,
      user,
      "studio.page.publish",
      "storefront_page",
      published.page_id,
      { page_key },
      request_id,
    );
    events.emit("page.published", { brand, page_id: published.page_id });
    return published;
  });
}

// ── Popups ─────────────────────────────────────────────────
function listPopups({ brand }) {
  return repo.listPopups({ brand });
}

async function savePopupDraft({ brand, user, request_id, popup }) {
  return transaction(async (client) => {
    const existing = await repo.getPopupDraft({
      client,
      brand,
      popup_key: popup.popup_key,
    });
    const draft = existing
      ? await repo.updatePopupDraft({
          client,
          brand,
          popup_key: popup.popup_key,
          popup,
        })
      : await repo.insertPopupDraft({
          client,
          brand,
          popup,
          created_by: user.user_id,
        });
    await A(
      brand,
      user,
      "studio.popup.save_draft",
      "storefront_popup",
      draft.popup_id,
      { popup_key: popup.popup_key },
      request_id,
    );
    events.emit("popup.draft_saved", { brand, popup_id: draft.popup_id });
    return draft;
  });
}

async function publishPopup({ brand, user, request_id, popup_key }) {
  return transaction(async (client) => {
    const published = await repo.publish({
      client,
      entity: "popup",
      brand,
      page_key: popup_key,
      published_by: user.user_id,
    });
    if (!published) throw new NotFoundError("Popup draft");
    await A(
      brand,
      user,
      "studio.popup.publish",
      "storefront_popup",
      published.popup_id,
      { popup_key },
      request_id,
    );
    events.emit("popup.published", { brand, popup_id: published.popup_id });
    return published;
  });
}

// Pull a popup off the live website, leaving its draft (and content) intact —
// "Take down" in Studio. Deactivating a draft never affected the live site,
// which is what made a deactivated popup look impossible to switch off.
async function unpublishPopup({ brand, user, request_id, popup_key }) {
  return transaction(async (client) => {
    const archived = await repo.unpublishPopup({ client, brand, popup_key });
    if (!archived) throw new NotFoundError("Published popup");
    await A(
      brand,
      user,
      "studio.popup.unpublish",
      "storefront_popup",
      archived.popup_id,
      { popup_key },
      request_id,
    );
    events.emit("popup.unpublished", { brand, popup_id: archived.popup_id });
    return archived;
  });
}

async function deletePopup({ brand, user, request_id, popup_key }) {
  return transaction(async (client) => {
    await repo.deletePopup({ client, brand, popup_key });
    await A(
      brand,
      user,
      "studio.popup.delete",
      "storefront_popup",
      null,
      { popup_key },
      request_id,
    );
    return { deleted: true, popup_key };
  });
}

// ── Section template library ───────────────────────────────
function listSectionTemplates() {
  return repo.listSectionTemplates({});
}

// ── Branding image upload (logo / favicon / OG) ────────────
// Stored via the shared storage service; the returned URL is written into the
// theme tokens by the Branding tab — dark/light logo (--logo-url-dark /
// --logo-url-light), dark/light favicon (--favicon-url-dark /
// --favicon-url-light) and the share image (--og-image).
async function uploadImage({ brand, file }) {
  if (!file || !file.buffer || !file.buffer.length)
    throw new AppError("NO_FILE", "No image was uploaded", 400);
  // iPhone HEIC → JPEG, then resize + re-encode (media-compression.service.js)
  // so the image guard below accepts a phone photo (whose browser mime is
  // often empty) and a full-size photo shrinks instead of bloating the CDN.
  // Size is gated on both sides of compression; see compressUploadChecked.
  const img = await compressUploadChecked(file);
  if (!/^image\//.test(img.mime_type || ""))
    throw new AppError("BAD_FILE_TYPE", "Only image files are allowed", 400);
  const ext =
    String(img.filename || "")
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 5) || "jpg";
  const key = `storefront/${brand}/${crypto.randomBytes(12).toString("hex")}.${ext}`;
  const stored = await storage.put(img.buffer, {
    key,
    contentType: img.mime_type,
  });
  return { url: stored.public_url };
}

// ── Looping-video upload (hero "living image") ─────────────
// The raw clip lands on disk via multer; FFmpeg trims it to the operator's
// window (≤20s), applies the chosen crop, then compresses + cleans it into
// HD/SD MP4 loops and a poster frame. The returned object is what the page
// slot stores and the storefront Hero plays.
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);

function looksLikeVideo(file) {
  if (/^video\//i.test(file.mimetype || "")) return true;
  const ext = String(file.originalname || "")
    .toLowerCase()
    .replace(/^.*(\.[a-z0-9]+)$/, "$1");
  return VIDEO_EXT.has(ext);
}

async function uploadVideo({ brand, file, options = {} }) {
  if (!file || !file.path)
    throw new AppError("NO_FILE", "No video was uploaded", 400);
  try {
    if (!looksLikeVideo(file)) {
      throw new AppError("BAD_FILE_TYPE", "Only video files are allowed", 400, {
        user_message:
          "That file isn't a video. Upload an MP4, MOV or WebM clip.",
      });
    }
    // Multipart fields arrive as strings; the clip service clamps/validates.
    return await videoClip.processClip({
      brand,
      inputPath: file.path,
      trim_start: options.trim_start,
      trim_end: options.trim_end,
      aspect: options.aspect,
      focus: options.focus,
    });
  } finally {
    await fs.unlink(file.path).catch(() => {});
  }
}

// ── OG share-banner compose (Branding tab) ─────────────────
// Builds a 1200×630 Open Graph card from an uploaded photo + composition
// params (crop/zoom/gradient/logo/headline). Returns the hosted banner URL
// (written into the --og-image theme token by the Branding tab) plus the
// stored source key/params so a later tweak recomposes from the original.
async function composeOgBanner({ brand, file, body = {} }) {
  return ogBanner.composeOgBanner({
    brand,
    file,
    source_key: body.source_key || undefined,
    logo_url: body.logo_url || undefined,
    params: body,
  });
}

// ── Preview (draft preview token + storefront URL) ─────────
// Mints a short-lived signed token the storefront accepts on ?preview= to
// render the DRAFT site for this brand. Also returns the brand's storefront
// origin so the admin can build the embedded + live preview URLs.
async function previewInfo({ brand }) {
  const token = jwt.sign({ typ: "sf_preview", brand }, config.JWT_SECRET, {
    expiresIn: "30m",
  });
  let base = await repo.getStorefrontDomain({ brand });
  if (base && !/^https?:\/\//i.test(base)) base = `https://${base}`;
  return { token, base_url: base || null };
}

// ── YouTube oEmbed (auto aspect-ratio for journal video blocks) ────
// YouTube's oEmbed endpoint is public and keyless. We only ever call it with
// a video ID we ourselves extracted (never the raw operator-pasted URL) and
// only ever hit youtube.com, so there is no open-redirect/SSRF surface here.
const YOUTUBE_URL_RE =
  /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function extractYouTubeId(url) {
  const m = YOUTUBE_URL_RE.exec(String(url || ""));
  return m ? m[1] : null;
}

async function fetchOEmbed({ url }) {
  const videoId = extractYouTubeId(url);
  if (!videoId)
    throw new AppError(
      "BAD_URL",
      "That doesn't look like a YouTube link",
      400,
    );
  try {
    const { data } = await axios.get("https://www.youtube.com/oembed", {
      params: {
        url: `https://www.youtube.com/watch?v=${videoId}`,
        format: "json",
      },
      timeout: 5000,
    });
    const width = Number(data.width) || null;
    const height = Number(data.height) || null;
    const aspect =
      width && height
        ? width > height
          ? "16:9"
          : width < height
            ? "9:16"
            : "1:1"
        : null;
    return { video_id: videoId, width, height, aspect, title: data.title || null };
  } catch {
    // A private/deleted/region-locked video, or YouTube being unreachable —
    // the editor falls back to a manual aspect toggle either way.
    return { video_id: videoId, width: null, height: null, aspect: null, title: null };
  }
}

// ── Revisions (history + one-click rollback) ───────────────
function listRevisions({ brand }) {
  return repo.listRevisions({ brand });
}

// Rollback restores the revision's snapshot as the entity's DRAFT, so an
// operator reviews it and re-publishes - safer than silently flipping live.
async function rollbackRevision({ brand, user, request_id, revision_id }) {
  return transaction(async (client) => {
    const rev = await repo.getRevision({ client, brand, revision_id });
    if (!rev) throw new NotFoundError("Revision");
    const snap = rev.snapshot || {};

    if (rev.entity_type === "theme") {
      const existing = await repo.getThemeDraft({ client, brand });
      if (existing)
        await repo.updateThemeDraft({ client, brand, tokens: snap.tokens || {} });
      else
        await repo.insertThemeDraft({
          client,
          brand,
          tokens: snap.tokens || {},
          created_by: user.user_id,
        });
    } else if (rev.entity_type === "navigation") {
      const nav = {
        header_items: snap.header_items || [],
        footer_columns: snap.footer_columns || [],
        socials: snap.socials || {},
      };
      const existing = await repo.getNavDraft({ client, brand });
      if (existing) await repo.updateNavDraft({ client, brand, nav });
      else
        await repo.insertNavDraft({
          client,
          brand,
          nav,
          created_by: user.user_id,
        });
    } else if (rev.entity_type === "page") {
      const page = {
        page_key: snap.page_key,
        template_key: snap.template_key,
        url_path: snap.url_path,
        meta_title: snap.meta_title,
        meta_description: snap.meta_description,
        og_image_url: snap.og_image_url,
        slots: snap.slots || {},
      };
      const existing = await repo.getPageDraft({
        client,
        brand,
        page_key: page.page_key,
      });
      if (existing)
        await repo.updatePageDraft({
          client,
          brand,
          page_key: page.page_key,
          page,
        });
      else
        await repo.insertPageDraft({
          client,
          brand,
          page,
          created_by: user.user_id,
        });
    } else {
      throw new AppError(
        "UNSUPPORTED_ENTITY",
        "This revision type can't be rolled back.",
        422,
      );
    }

    await A(
      brand,
      user,
      "studio.revision.rollback",
      "storefront_revision",
      revision_id,
      { entity_type: rev.entity_type },
      request_id,
    );
    return { restored_to_draft: true, entity_type: rev.entity_type };
  });
}

// ── Content posts (FAQ / care guide / journal / policy) ────
// One row per post with its own status lifecycle (draft ↔ published). The
// operator types a title (+ body/answer); slug, reading time and empty SEO
// fields are derived. Praxis (Brand Brain) and the public pages read only the
// PUBLISHED rows, so a draft is never quoted or shown.

function listContentPosts({ brand, type }) {
  return repo.listContentPosts({ brand, type });
}

async function createContentPost({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const fields = buildPostFields(input);
    const slug =
      (input.slug && input.slug.trim()) ||
      (await uniqueSlug(fields.title, (s) =>
        repo.slugExists({ client, brand, slug: s }),
      ));
    // A hand-typed slug still has to be unique for the brand.
    if (input.slug && (await repo.slugExists({ client, brand, slug }))) {
      throw new AppError(
        "SLUG_TAKEN",
        "That web address is already used by another post.",
        409,
      );
    }
    const created = await repo.insertContentPost({
      client,
      brand,
      post: {
        ...fields,
        slug,
        status: "draft",
        published_at: null,
        author_user_id: user.user_id,
        author_display_name: user.display_name || user.full_name || null,
      },
    });
    await A(
      brand,
      user,
      "studio.content.create",
      "storefront_content_post",
      created.post_id,
      { post_type: created.post_type, slug: created.slug },
      request_id,
    );
    events.emit("content.created", { brand, post_id: created.post_id });
    return created;
  });
}

async function updateContentPost({ brand, user, request_id, post_id, input }) {
  return transaction(async (client) => {
    const existing = await repo.getContentPostById({ client, brand, post_id });
    if (!existing) throw new NotFoundError("Content post");
    const fields = buildPostFields(input);
    // Keep the live URL stable unless the operator explicitly changed it.
    let slug = existing.slug;
    if (input.slug && input.slug.trim() && input.slug.trim() !== existing.slug) {
      slug = input.slug.trim();
      if (await repo.slugExists({ client, brand, slug, exclude_id: post_id })) {
        throw new AppError(
          "SLUG_TAKEN",
          "That web address is already used by another post.",
          409,
        );
      }
    }
    const updated = await repo.updateContentPost({
      client,
      brand,
      post_id,
      post: {
        ...fields,
        slug,
        // Editing published copy keeps it published (and its published_at);
        // status changes go through publish/unpublish.
        status: existing.status,
        published_at: existing.published_at,
      },
    });
    await A(
      brand,
      user,
      "studio.content.update",
      "storefront_content_post",
      post_id,
      { post_type: updated.post_type, slug: updated.slug },
      request_id,
    );
    events.emit("content.updated", { brand, post_id });
    return updated;
  });
}

async function publishContentPost({ brand, user, request_id, post_id }) {
  return transaction(async (client) => {
    const existing = await repo.getContentPostById({ client, brand, post_id });
    if (!existing) throw new NotFoundError("Content post");
    const published = await repo.setContentStatus({
      client,
      brand,
      post_id,
      status: "published",
      // Preserve the original publish date on re-publish; stamp it the first time.
      published_at: existing.published_at || new Date().toISOString(),
    });
    await A(
      brand,
      user,
      "studio.content.publish",
      "storefront_content_post",
      post_id,
      { slug: published.slug },
      request_id,
    );
    events.emit("content.published", { brand, post_id });
    return published;
  });
}

async function unpublishContentPost({ brand, user, request_id, post_id }) {
  return transaction(async (client) => {
    const existing = await repo.getContentPostById({ client, brand, post_id });
    if (!existing) throw new NotFoundError("Content post");
    const draft = await repo.setContentStatus({
      client,
      brand,
      post_id,
      status: "draft",
      published_at: null,
    });
    await A(
      brand,
      user,
      "studio.content.unpublish",
      "storefront_content_post",
      post_id,
      { slug: draft.slug },
      request_id,
    );
    events.emit("content.unpublished", { brand, post_id });
    return draft;
  });
}

async function deleteContentPost({ brand, user, request_id, post_id }) {
  return transaction(async (client) => {
    const existing = await repo.getContentPostById({ client, brand, post_id });
    if (!existing) throw new NotFoundError("Content post");
    await repo.deleteContentPost({ client, brand, post_id });
    await A(
      brand,
      user,
      "studio.content.delete",
      "storefront_content_post",
      post_id,
      { slug: existing.slug, post_type: existing.post_type },
      request_id,
    );
    events.emit("content.deleted", { brand, post_id });
    return { deleted: true, post_id };
  });
}

module.exports = {
  getThemes,
  saveThemeDraft,
  publishTheme,
  getNavigation,
  saveNavDraft,
  publishNav,
  listPages,
  savePageDraft,
  publishPage,
  listPopups,
  savePopupDraft,
  publishPopup,
  unpublishPopup,
  deletePopup,
  listSectionTemplates,
  uploadImage,
  uploadVideo,
  composeOgBanner,
  fetchOEmbed,
  previewInfo,
  listRevisions,
  rollbackRevision,
  listContentPosts,
  createContentPost,
  updateContentPost,
  publishContentPost,
  unpublishContentPost,
  deleteContentPost,
};
