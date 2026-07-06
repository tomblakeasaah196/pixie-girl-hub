/**
 * Help Center — Zod validators for the in-app editor (create/edit).
 */

"use strict";

const { z } = require("zod");

const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case");

const audience = z.enum(["all", "ceo", "staff", "stylist"]);

const articleCreate = z
  .object({
    slug,
    title: z.string().min(1).max(200),
    summary: z.string().max(500).nullish(),
    body_markdown: z.string().min(1),
    audience: audience.default("all"),
    category_slug: z.string().min(1).max(120),
    related_module: z.string().max(64).nullish(),
    tags: z.array(z.string().max(40)).max(20).optional().default([]),
    sort_order: z.coerce.number().int().min(0).optional().default(0),
    praxis_indexed: z.boolean().optional().default(true),
    is_active: z.boolean().optional().default(true),
  })
  .strict();

// Update: everything optional, and slug is immutable (identity + chunk key).
const articleUpdate = z
  .object({
    title: z.string().min(1).max(200),
    summary: z.string().max(500).nullish(),
    body_markdown: z.string().min(1),
    audience,
    category_slug: z.string().min(1).max(120),
    related_module: z.string().max(64).nullish(),
    tags: z.array(z.string().max(40)).max(20),
    sort_order: z.coerce.number().int().min(0),
    praxis_indexed: z.boolean(),
    is_active: z.boolean(),
  })
  .partial()
  .strict();

const categoryCreate = z
  .object({
    slug,
    name: z.string().min(1).max(120),
    description: z.string().max(500).nullish(),
    icon: z.string().max(60).nullish(),
    sort_order: z.coerce.number().int().min(0).optional().default(0),
    is_active: z.boolean().optional().default(true),
  })
  .strict();

const categoryUpdate = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(500).nullish(),
    icon: z.string().max(60).nullish(),
    sort_order: z.coerce.number().int().min(0),
    is_active: z.boolean(),
  })
  .partial()
  .strict();

const mw = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

module.exports = {
  validateArticleCreate: mw(articleCreate),
  validateArticleUpdate: mw(articleUpdate),
  validateCategoryCreate: mw(categoryCreate),
  validateCategoryUpdate: mw(categoryUpdate),
};
