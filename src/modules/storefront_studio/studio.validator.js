/**
 * Storefront Studio (V2.2 §6.28) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const themeDraftSchema = z
  .object({ tokens: z.record(z.any()).default({}) })
  .strict();

const navDraftSchema = z
  .object({
    header_items: z.array(z.any()).default([]),
    footer_columns: z.array(z.any()).default([]),
    socials: z.record(z.any()).default({}),
  })
  .strict();

const pageDraftSchema = z
  .object({
    page_key: z.string().min(1).max(60),
    template_key: z.string().min(1).max(80),
    url_path: z.string().min(1).max(200),
    meta_title: z.string().max(200).optional(),
    meta_description: z.string().max(500).optional(),
    og_image_url: z.string().max(1000).optional(),
    slots: z.record(z.any()).default({}),
  })
  .strict();

const popupDraftSchema = z
  .object({
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
  })
  .strict();

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
