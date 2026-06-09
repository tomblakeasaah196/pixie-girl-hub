/**
 * Storefront Studio (V2.2 §6.28) — business logic. Draft/publish editor for
 * the brand's storefront theme, pages and navigation.
 */

"use strict";

const repo = require("./studio.repo");
const events = require("./studio.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError } = require("../../utils/errors");

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
};
