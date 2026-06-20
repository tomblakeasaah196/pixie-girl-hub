/**
 * Platform Settings — Zod validators.
 *
 * Two safety nets the route layer can't do on its own:
 *
 *   1. The `theme` JSONB is a free-form bag. We restrict the top
 *      level to `dark` / `light`, restrict the inner keys to the
 *      curated token allow-list, and validate each value against the
 *      shape the CSS variable expects ("R G B" triplet for colours,
 *      "0..1" for alphas / opacities). One typo can't smuggle in an
 *      arbitrary CSS variable name.
 *
 *   2. `font_css_url` is loaded as a <link rel="stylesheet"> in the
 *      browser, so it can carry @font-face @imports and `unicode-range`
 *      hijacks. We only accept https URLs on a trusted host allow-list
 *      (Google Fonts, Bunny Fonts, Adobe Typekit, rsms.me).
 */

"use strict";

const { z } = require("zod");

// "R G B" — three 0..255 ints space-separated. Used by every Tailwind
// rgb(var(--token) / alpha) call in apps/admin/src/styles/index.css.
const RGB_TRIPLET =
  /^(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]) (?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]) (?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;

const COLOUR_TOKENS = [
  "bg",
  "panel",
  "panel-2",
  "text",
  "text-muted",
  "text-faint",
  "border-c",
  "accent",
  "accent-deep",
  "accent-glow",
  "sage",
  "rose",
  "info",
  "success",
  "warn",
  "danger",
];
const SCALAR_TOKENS = ["panel-alpha", "border-alpha", "mesh-op"];

const colourValue = z
  .string()
  .regex(
    RGB_TRIPLET,
    'colour tokens must be an "R G B" triplet (e.g. "168 29 29")',
  );
// Alpha / opacity scalars: a decimal in 0..1 as a string (we keep
// strings so the JSONB round-trip matches what the browser reads).
const scalarValue = z
  .string()
  .regex(/^(?:0|1|0?\.\d{1,4}|1\.0{1,4})$/, "must be a decimal 0..1");

function buildModeSchema() {
  const shape = {};
  for (const k of COLOUR_TOKENS) shape[k] = colourValue.optional();
  for (const k of SCALAR_TOKENS) shape[k] = scalarValue.optional();
  return z.object(shape).strict();
}

const themeSchema = z
  .object({
    dark: buildModeSchema().optional(),
    light: buildModeSchema().optional(),
  })
  .strict();

// Allow-list of font CDNs. font CSS is loaded with full CSS power
// (it can @import chains), so we never accept arbitrary hosts.
const FONT_HOST_ALLOWLIST = [
  "fonts.googleapis.com",
  "fonts.bunny.net",
  "use.typekit.net",
  "rsms.me",
];
const fontCssUrl = z
  .string()
  .url()
  .max(500)
  .refine(
    (u) => {
      try {
        const url = new URL(u);
        return (
          url.protocol === "https:" &&
          FONT_HOST_ALLOWLIST.includes(url.hostname.toLowerCase())
        );
      } catch {
        return false;
      }
    },
    `font_css_url must be an https URL on a trusted host (${FONT_HOST_ALLOWLIST.join(", ")})`,
  );

// ── login_config ─────────────────────────────────────────
// The login-page content bag (hero / quotes / standards / region
// messages / toggles / background). Deliberately permissive so the
// Appearance editor isn't brittle — every section is optional and the
// objects .passthrough() unknown keys — but each known field is typed
// so a save can't smuggle in the wrong shape.
const heroSchema = z
  .object({
    eyebrow: z.string().max(80).optional(),
    headline: z.string().max(200).optional(),
    subline: z.string().max(400).optional(),
    cta_label: z.string().max(60).optional(),
  })
  .partial()
  .passthrough();

const quoteSchema = z
  .object({
    text: z.string().min(1).max(400),
    author: z.string().max(120).optional(),
  })
  .passthrough();

const standardSchema = z
  .object({
    icon: z.string().min(1).max(60),
    title: z.string().min(1).max(120),
    body: z.string().min(1).max(400),
  })
  .passthrough();

const regionMessageSchema = z
  .object({
    welcome: z.string().max(120).optional(),
    note: z.string().max(400).optional(),
  })
  .partial()
  .passthrough();

// Image URLs can be absolute (https://cdn.example.com/...) when a CDN is
// configured, or relative (/media/branding/...) when using local storage.
// z.string().url() rejects relative paths, so we allow either form.
const imageUrl = z
  .string()
  .max(2000)
  .refine((v) => {
    if (v.startsWith("/media/")) return true;
    try {
      new URL(v);
      return true;
    } catch {
      return false;
    }
  }, "must be an https URL or a /media/ relative path");

const backgroundSchema = z
  .object({
    style: z.enum(["mesh", "image"]).optional(),
    image_url: imageUrl.nullable().optional(),
  })
  .partial()
  .passthrough();

const loginConfigSchema = z
  .object({
    hero: heroSchema.optional(),
    quotes: z.array(quoteSchema).max(100).optional(),
    standards: z.array(standardSchema).max(24).optional(),
    region_messages: z.record(regionMessageSchema).optional(),
    toggles: z.record(z.boolean()).optional(),
    background: backgroundSchema.optional(),
  })
  .partial()
  .passthrough();

const settingsUpdate = z
  .object({
    product_name: z.string().min(1).max(80).optional(),
    tagline: z.string().max(200).nullable().optional(),
    company_name: z.string().max(200).nullable().optional(),
    logo_dark_url: imageUrl.nullable().optional(),
    logo_light_url: imageUrl.nullable().optional(),
    favicon_url: imageUrl.nullable().optional(),
    font_display: z.string().min(1).max(200).optional(),
    font_body: z.string().min(1).max(200).optional(),
    font_mono: z.string().min(1).max(200).optional(),
    font_css_url: fontCssUrl.nullable().optional(),
    theme: themeSchema.optional(),
    login_config: loginConfigSchema.optional(),
  })
  .strict();

const mw = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body ?? {});
  next();
};

module.exports = {
  validatePlatformUpdate: mw(settingsUpdate),
  // Exported for the unit tests + frontend mirror.
  COLOUR_TOKENS,
  SCALAR_TOKENS,
  FONT_HOST_ALLOWLIST,
};
