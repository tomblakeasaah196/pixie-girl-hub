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
const { config } = require("../../config/env");
const storage = require("../../services/storage.service");
const {
  normalizeImageInput,
} = require("../../services/media-compression.service");

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
  // iPhone HEIC → JPEG up front, so the image guard below accepts a phone
  // photo (whose browser mime is often empty) and we never store an
  // unrenderable .heic logo / OG banner. Non-HEIC images pass through.
  const img = await normalizeImageInput(file);
  if (!/^image\//.test(img.mimetype || ""))
    throw new AppError("BAD_FILE_TYPE", "Only image files are allowed", 400);
  const ext =
    String(img.originalname || "")
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 5) || "jpg";
  const key = `storefront/${brand}/${crypto.randomBytes(12).toString("hex")}.${ext}`;
  const stored = await storage.put(img.buffer, {
    key,
    contentType: img.mimetype,
  });
  return { url: stored.public_url };
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
  deletePopup,
  listSectionTemplates,
  uploadImage,
  previewInfo,
  listRevisions,
  rollbackRevision,
};
