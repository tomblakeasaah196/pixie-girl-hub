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
const RGB_TRIPLET = /^(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]) (?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]) (?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;

const COLOUR_TOKENS = [
  "bg", "panel", "panel-2",
  "text", "text-muted", "text-faint",
  "border-c",
  "accent", "accent-deep", "accent-glow",
  "sage", "rose", "info",
  "success", "warn", "danger",
];
const SCALAR_TOKENS = ["panel-alpha", "border-alpha", "mesh-op"];

const colourValue = z.string().regex(
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
  .refine((u) => {
    try {
      const url = new URL(u);
      return (
        url.protocol === "https:" &&
        FONT_HOST_ALLOWLIST.includes(url.hostname.toLowerCase())
      );
    } catch {
      return false;
    }
  }, `font_css_url must be an https URL on a trusted host (${FONT_HOST_ALLOWLIST.join(", ")})`);

const settingsUpdate = z
  .object({
    product_name: z.string().min(1).max(80).optional(),
    tagline: z.string().max(200).nullable().optional(),
    company_name: z.string().max(200).nullable().optional(),
    logo_dark_url: z.string().max(500).nullable().optional(),
    logo_light_url: z.string().max(500).nullable().optional(),
    favicon_url: z.string().max(500).nullable().optional(),
    font_display: z.string().min(1).max(200).optional(),
    font_body: z.string().min(1).max(200).optional(),
    font_mono: z.string().min(1).max(200).optional(),
    font_css_url: fontCssUrl.nullable().optional(),
    theme: themeSchema.optional(),
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
