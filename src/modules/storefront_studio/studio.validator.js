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

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateThemeDraft: mk(themeDraftSchema),
  validateNavDraft: mk(navDraftSchema),
  validatePageDraft: mk(pageDraftSchema),
  themeDraftSchema,
  navDraftSchema,
  pageDraftSchema,
};
