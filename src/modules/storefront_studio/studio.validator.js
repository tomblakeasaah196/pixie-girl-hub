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

// Journal article body: an ordered array of typed blocks (text / image /
// youtube / instagram / video) instead of one flat string, so Storefront
// Studio → Content can compose a magazine-style layout. Text formatting is
// data-driven (font/size/color/weight flags) rather than raw HTML — the
// renderer never uses dangerouslySetInnerHTML, so there is no markup
// injection surface even though operators fully control the copy.
const FONT_KEYS = [
  "cormorant",
  "instrument-serif",
  "work-sans",
  "archivo-black",
  "playfair",
  "marcellus",
  "montserrat",
  "cinzel",
  "eb-garamond",
  "prata",
];
const FONT_SIZES = ["sm", "base", "lg", "xl", "2xl", "3xl"];
const EMBED_ASPECTS = ["16:9", "9:16", "1:1"];

const blockBase = { id: z.string().trim().min(1).max(80) };

const textBlockSchema = z.object({
  ...blockBase,
  type: z.literal("text"),
  text: z.string().max(4000),
  fontFamily: z.enum(FONT_KEYS).nullish(),
  fontSize: z.enum(FONT_SIZES).nullish(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{3,8}$/)
    .nullish(),
  bold: z.boolean().nullish(),
  italic: z.boolean().nullish(),
  underline: z.boolean().nullish(),
  align: z.enum(["left", "center", "right"]).nullish(),
});
const imageBlockSchema = z.object({
  ...blockBase,
  type: z.literal("image"),
  url: z.string().max(1000),
  alt: z.string().max(300).nullish(),
  caption: z.string().max(500).nullish(),
});
const youtubeBlockSchema = z.object({
  ...blockBase,
  type: z.literal("youtube"),
  url: z.string().max(500),
  aspect: z.enum(EMBED_ASPECTS).default("16:9"),
  caption: z.string().max(500).nullish(),
});
const instagramBlockSchema = z.object({
  ...blockBase,
  type: z.literal("instagram"),
  url: z.string().max(500),
  aspect: z.enum(EMBED_ASPECTS).default("9:16"),
  caption: z.string().max(500).nullish(),
});
const videoBlockSchema = z.object({
  ...blockBase,
  type: z.literal("video"),
  url: z.string().max(1000),
  poster_url: z.string().max(1000).nullish(),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
  caption: z.string().max(500).nullish(),
});
const contentBlockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  imageBlockSchema,
  youtubeBlockSchema,
  instagramBlockSchema,
  videoBlockSchema,
]);

// Content posts (FAQ / care guide / journal / policy). Slug, reading time,
// and blank SEO fields are derived server-side, so the editor only has to send
// what a shop owner actually types. Extra keys from a loaded row are stripped.
const contentPostSchema = z.object({
  post_type: z.enum([
    "faq",
    "guide",
    "journal",
    "policy",
    "blog",
    "lookbook",
    "press",
  ]),
  title: z.string().trim().min(1, "Give it a title").max(200),
  slug: z.string().trim().max(200).nullish(),
  excerpt: z.string().max(600).nullish(),
  body: z.string().max(50000).nullish(),
  hero_image_url: z.string().max(1000).nullish(),
  hero_image_alt: z.string().max(300).nullish(),
  faq_category: z
    .enum(["shipping", "returns", "care", "payment", "sizing", "general"])
    .nullish(),
  faq_question: z.string().max(300).nullish(),
  tags: z.array(z.string().max(60)).max(20).default([]),
  content_blocks: z.array(contentBlockSchema).max(80).default([]),
  meta_title: z.string().max(200).nullish(),
  meta_description: z.string().max(500).nullish(),
  is_featured: z.boolean().default(false),
  display_order: z.number().int().min(0).max(9999).default(0),
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
  validateContentPost: mk(contentPostSchema),
  themeDraftSchema,
  navDraftSchema,
  pageDraftSchema,
  popupDraftSchema,
  contentPostSchema,
  contentBlockSchema,
};
