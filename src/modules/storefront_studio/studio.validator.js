/**
 * Storefront Studio (V2.2 §6.28) — Zod validators.
 */

"use strict";

const { z } = require("zod");

// NB: these schemas intentionally STRIP unknown keys (Zod default) rather than
// `.strict()`. The Studio editors load a full DB row (page_id, business, status,
// timestamps, …) and send it back on save; `.strict()` rejected those extra
// keys with a blanket "Invalid input", which broke every page save/publish. The
// repos only ever read the explicit columns below, so ignoring extras is safe.
// String fields that originate from a DB row are `.nullish()` so a stored NULL
// (e.g. an empty meta_title) doesn't fail validation either.
const themeDraftSchema = z.object({ tokens: z.record(z.any()).default({}) });

const navDraftSchema = z.object({
  header_items: z.array(z.any()).default([]),
  footer_columns: z.array(z.any()).default([]),
  socials: z.record(z.any()).default({}),
});

const pageDraftSchema = z.object({
  page_key: z.string().min(1).max(60),
  template_key: z.string().min(1).max(80),
  url_path: z.string().min(1).max(200),
  meta_title: z.string().max(200).nullish(),
  meta_description: z.string().max(500).nullish(),
  og_image_url: z.string().max(1000).nullish(),
  slots: z.record(z.any()).default({}),
});

const popupDraftSchema = z.object({
  popup_key: z.string().min(1).max(60),
  trigger_type: z.enum([
    "time_delay",
    "scroll_depth",
    "exit_intent",
    "page_load",
    "add_to_cart",
  ]),
  trigger_value: z.number().int().nullable().optional(),
  audience: z
    .enum(["all", "new", "returning", "guest", "member"])
    .default("all"),
  content: z.record(z.any()).default({}),
  display_rules: z.record(z.any()).default({}),
  display_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
});

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateThemeDraft: mk(themeDraftSchema),
  validateNavDraft: mk(navDraftSchema),
  validatePageDraft: mk(pageDraftSchema),
  validatePopupDraft: mk(popupDraftSchema),
  themeDraftSchema,
  navDraftSchema,
  pageDraftSchema,
  popupDraftSchema,
};
