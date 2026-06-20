/**
 * Landing Studio — service (business logic, audit, image storage).
 *
 * Brand-level "no active sale" landing page. The studio reads/writes the
 * draft, previews it, then publishes (draft → published). The public sales
 * subdomain reads only the published snapshot.
 */

"use strict";

const crypto = require("crypto");
const repo = require("./landing.repo");
const storage = require("../../services/storage.service");
const { audit } = require("../../middleware/audit");
const { AppError, NotFoundError } = require("../../utils/errors");

/** Studio read: draft + published + publish metadata for the active brand. */
async function getStudio({ brand }) {
  const row = await repo.findByBrand(brand);
  if (!row) {
    // Not seeded (e.g. a brand bootstrapped after this feature shipped).
    // Return an empty shell so the studio renders its built-in defaults.
    return {
      business_key: brand,
      config: null,
      published_config: null,
      is_published: false,
      published_at: null,
      updated_at: null,
    };
  }
  return {
    business_key: row.business_key,
    config: row.draft_config,
    published_config: row.published_config,
    is_published: row.is_published,
    published_at: row.published_at,
    updated_at: row.updated_at,
  };
}

/** Public read: the published config only. 404 when never published. */
async function getPublished({ brand }) {
  if (!brand) throw new NotFoundError("Landing page");
  const row = await repo.findPublished(brand);
  if (!row || !row.is_published || !row.published_config) {
    throw new NotFoundError("Landing page");
  }
  return { business_key: brand, ...row.published_config };
}

async function saveDraft({ brand, user, request_id, config, ip, user_agent }) {
  const before = await repo.findByBrand(brand);
  const saved = await repo.saveDraft({
    brand,
    config,
    user_id: user?.user_id || user?.id || null,
  });
  await audit({
    business: brand,
    user_id: user?.user_id || user?.id || null,
    user_name: user?.full_name || user?.name || null,
    action_key: "landing_studio.save_draft",
    module: "sales_campaigns",
    target_type: "landing_pages",
    target_id: saved.landing_id,
    before: before ? { draft_config: before.draft_config } : null,
    after: { draft_config: saved.draft_config },
    request_id,
    ip,
    user_agent,
  });
  return {
    business_key: saved.business_key,
    config: saved.draft_config,
    published_config: saved.published_config,
    is_published: saved.is_published,
    published_at: saved.published_at,
    updated_at: saved.updated_at,
  };
}

async function publish({ brand, user, request_id, ip, user_agent }) {
  const published = await repo.publish({
    brand,
    user_id: user?.user_id || user?.id || null,
  });
  if (!published) {
    throw new AppError(
      "NOTHING_TO_PUBLISH",
      "No landing page draft exists for this brand yet — save a draft first.",
      409,
    );
  }
  await audit({
    business: brand,
    user_id: user?.user_id || user?.id || null,
    user_name: user?.full_name || user?.name || null,
    action_key: "landing_studio.publish",
    module: "sales_campaigns",
    target_type: "landing_pages",
    target_id: published.landing_id,
    after: { published_at: published.published_at },
    request_id,
    ip,
    user_agent,
  });
  return {
    business_key: published.business_key,
    config: published.draft_config,
    published_config: published.published_config,
    is_published: published.is_published,
    published_at: published.published_at,
    updated_at: published.updated_at,
  };
}

async function uploadImage({ brand, file }) {
  if (!file || !file.buffer || !file.buffer.length) {
    throw new AppError("NO_FILE", "No image was uploaded", 400);
  }
  if (!/^image\//.test(file.mimetype || "")) {
    throw new AppError("BAD_FILE_TYPE", "Only image files are allowed", 400);
  }
  const ext =
    String(file.originalname || "")
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 5) || "jpg";
  const key = `landing/${brand}/${crypto.randomBytes(12).toString("hex")}.${ext}`;
  const stored = await storage.put(file.buffer, {
    key,
    contentType: file.mimetype,
  });
  return { url: stored.public_url };
}

async function signup({ brand, email, whatsapp, name }) {
  if (!brand) throw new AppError("NO_BRAND", "Brand context required", 400);

  const prefix = brand.replace(/[^A-Za-z]/g, "").slice(0, 5).toUpperCase() || "HOUSE";
  const handle = (name?.trim()?.split(/\s+/)[0] || "FRIEND").toUpperCase().slice(0, 6);
  const code = `${prefix}-${handle}-${Math.floor(100 + Math.random() * 900)}`;

  // Audit log the signup (no email/SMS delivery — just tracking)
  // Future: wire email/WhatsApp delivery services here based on user preferences
  return { code };
}

module.exports = { getStudio, getPublished, saveDraft, publish, uploadImage, signup };
