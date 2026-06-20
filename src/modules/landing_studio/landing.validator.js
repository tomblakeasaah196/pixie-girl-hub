/**
 * Landing Studio — input validation (Zod).
 *
 * The design config is intentionally permissive (a free-form JSONB blob the
 * studio evolves), but we cap its size and validate the few fields that the
 * renderer and the brand-tinting logic actually depend on. Image URLs are
 * restricted to http(s) so a stored config can't smuggle a javascript: or
 * data: URL into the public page.
 */

"use strict";

const { z } = require("zod");
const { ValidationError } = require("../../utils/errors");

const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = z.string().regex(HEX, "Expected a #rrggbb colour");

const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (v) => v === "" || /^https?:\/\//i.test(v),
    "Only http(s) URLs are allowed",
  );
// Image/media URLs may be an absolute http(s) URL OR a root-relative path
// served by our own /media mount — storage.put() returns "/media/..." when
// CDN_BASE_URL is unset, and rejecting it here would 400 the whole Save the
// moment a hero/logo/background/gallery image is uploaded. Still blocks
// javascript:/data: and protocol-relative "//host" URLs.
const mediaUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (v) => v === "" || /^https?:\/\//i.test(v) || /^\/(?!\/)/.test(v),
    "Only http(s) or /media URLs are allowed",
  );
const nullableMediaUrl = mediaUrl.nullable().optional();

const themeSchema = z
  .object({
    ink: hex,
    paper: hex,
    primary: hex,
    primaryDeep: hex,
    accent: hex,
    muted: hex,
    glow: hex,
  })
  .partial();

const logoSchema = z
  .object({
    url: nullableMediaUrl,
    // Tint may be a hex OR null (null = keep the logo's original colours).
    headerTint: z.string().regex(HEX).nullable().optional(),
    footerTint: z.string().regex(HEX).nullable().optional(),
    headerScale: z.number().min(0.5).max(3).optional(),
    footerScale: z.number().min(0.5).max(3).optional(),
  })
  .partial();

// The full config: validate known structural fields, allow the rest through
// (passthrough) so the studio can add new copy fields without a server change.
const configSchema = z
  .object({
    brandName: z.string().max(120).optional(),
    legalName: z.string().max(160).optional(),
    tagline: z.string().max(200).optional(),
    welcomeLine: z.string().max(200).optional(),
    domain: z.string().max(200).optional(),
    storefront: httpUrl.optional(),
    address: z.string().max(400).optional(),
    theme: themeSchema.optional(),
    three: themeSchema.partial().optional(),
    background: z
      .object({
        type: z.enum(["color", "image"]).optional(),
        imageUrl: nullableMediaUrl,
      })
      .partial()
      .optional(),
    logo: logoSchema.optional(),
    hero: z
      .object({
        imageUrl: nullableMediaUrl,
      })
      .passthrough()
      .optional(),
    invitation: z
      .object({
        seatsTotal: z.number().int().min(1).max(100000).optional(),
        seatsClaimedBase: z.number().int().min(0).max(100000).optional(),
      })
      .passthrough()
      .optional(),
    form: z
      .object({
        collectName: z.boolean().optional(),
        collectEmail: z.boolean().optional(),
        collectWhatsapp: z.boolean().optional(),
        collectReferral: z.boolean().optional(),
        channels: z.array(z.enum(["email", "whatsapp", "both"])).optional(),
      })
      .passthrough()
      .optional(),
    gallery: z
      .array(
        z
          .object({ url: mediaUrl, caption: z.string().max(160).optional() })
          .passthrough(),
      )
      .max(24)
      .optional(),
    pillars: z.array(z.object({}).passthrough()).max(12).optional(),
    socials: z
      .array(
        z.object({
          platform: z.string().max(40),
          href: httpUrl,
          label: z.string().max(60).optional(),
        }),
      )
      .max(16)
      .optional(),
    reveal: z.object({}).passthrough().optional(),
    seo: z
      .object({
        metaTitle: z.string().max(200).optional(),
        metaDescription: z.string().max(400).optional(),
        ogImageUrl: nullableMediaUrl,
        faviconUrl: nullableMediaUrl,
        twitterHandle: z.string().max(40).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const saveSchema = z.object({ config: configSchema });

function parse(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      (fields[key] ||= []).push(issue.message);
    }
    throw new ValidationError(fields, "Invalid input");
  }
  return result.data;
}

function validateSave(req, _res, next) {
  // Guard total payload size (a malicious or runaway config could bloat the
  // row). 256 KB is generous for copy + a few dozen image URLs.
  const raw = JSON.stringify(req.body || {});
  if (raw.length > 256 * 1024) {
    return next(new ValidationError({ config: ["Max 256 KB"] }, "Config too large"));
  }
  try {
    req.body = parse(saveSchema, req.body);
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { validateSave, configSchema };
