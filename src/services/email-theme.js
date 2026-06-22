/**
 * Premium email skin — the single source of truth for what every marketing /
 * lifecycle email LOOKS like. Pure functions, no DB, no I/O.
 *
 * THE GOLDEN RULE OF EMAIL HTML: it is not web HTML. Outlook renders with
 * Word's engine, Gmail strips <style> and <head>, Apple Mail dark-mode-inverts
 * anything it can. So everything here compiles to nested tables with INLINE CSS
 * only, MSO conditional comments for Outlook, a bulletproof (VML) button, a
 * hidden preheader, and `color-scheme: light only` so a cream-and-maroon
 * luxury layout survives Gmail / Outlook / Apple intact.
 *
 * Brand identity (logo, accent colour, name, links) is injected as {{tokens}}
 * that the send pipeline (email-render.js) substitutes per brand + recipient,
 * so one skin reskins itself for Pixie Girl Global vs Faitlynhair from Settings
 * with nothing hard-coded.
 *
 * Used by:
 *   - scripts/gen-premium-email-templates.js → bakes the seeded templates
 *   - apps/admin email studio mirrors this look on the client preview
 */

"use strict";

// ── Luxury neutrals (layout chrome, NOT brand — literal hex is correct here:
//    this is portable email HTML, not the app's tokenised UI). The brand
//    accent is the only colour that changes per business, via {{brand_color}}.
const NEUTRAL = {
  outerBg: "#F4EFE9", // warm ivory page backdrop
  card: "#FFFFFF", // the letter
  ink: "#1A1212", // near-black warm text
  muted: "#7A7068", // secondary text
  faint: "#A89F96", // footer / legal
  hairline: "#ECE5DC", // 1px rules
  heroTint: "#1A1212",
};

// Font stacks. Web fonts are requested in <head> for clients that honour it;
// every inline style still names a safe fallback so Outlook/Gmail never break.
const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
const SANS = "'Montserrat', 'Helvetica Neue', Arial, sans-serif";
const FONT_IMPORT =
  "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500&display=swap";

function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A row wrapper that keeps the 28px gutters consistent across blocks. */
function pad(inner, { top = 0, bottom = 0, px = 40 } = {}) {
  return `<tr><td style="padding:${top}px ${px}px ${bottom}px ${px}px">${inner}</td></tr>`;
}

// ── Content blocks ─────────────────────────────────────────────
// Each returns one or more <tr> rows for the 600px content table.

function eyebrow(text, accent = "{{brand_color}}") {
  return pad(
    `<div style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:${accent}">${esc(
      text,
    )}</div>`,
    { top: 36, bottom: 0 },
  );
}

function heading(text, { size = 30 } = {}) {
  return pad(
    `<h1 style="margin:0;font-family:${SERIF};font-size:${size}px;line-height:1.22;font-weight:600;color:${NEUTRAL.ink};letter-spacing:-0.2px">${esc(
      text,
    )}</h1>`,
    { top: 12, bottom: 0 },
  );
}

function paragraph(html, { muted = false, top = 16 } = {}) {
  const color = muted ? NEUTRAL.muted : NEUTRAL.ink;
  return pad(
    `<p style="margin:0;font-family:${SANS};font-size:15px;line-height:1.62;color:${color}">${html}</p>`,
    { top, bottom: 0 },
  );
}

/** Bulletproof (VML) accent button — survives Outlook with real rounded fill. */
function button(label, href = "{{cta_url}}", { accent = "{{brand_color}}" } = {}) {
  const safeHref = href || "#";
  return `<tr><td align="center" style="padding:30px 40px 8px 40px">
    <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:50px;v-text-anchor:middle;width:280px;" arcsize="9%" strokecolor="${accent}" fillcolor="${accent}"><w:anchorlock/><center style="color:#ffffff;font-family:${SANS};font-size:14px;font-weight:700;letter-spacing:1.5px;">${esc(
    label,
  )}</center></v:roundrect><![endif]-->
    <!--[if !mso]><!-- -->
    <a href="${safeHref}" target="_blank" style="display:inline-block;background:${accent};color:#ffffff;font-family:${SANS};font-size:14px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;text-decoration:none;padding:16px 40px;border-radius:4px">${esc(
      label,
    )}</a>
    <!--<![endif]-->
  </td></tr>`;
}

/** Before → after price, with the old price struck through. */
function priceCompare(oldLabel, newLabel, caption = "") {
  return `<tr><td align="center" style="padding:22px 40px 0 40px">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr>
      <td style="font-family:${SANS};font-size:18px;color:${NEUTRAL.faint};text-decoration:line-through;padding-right:14px">${esc(
        oldLabel,
      )}</td>
      <td style="font-family:${SERIF};font-size:30px;font-weight:700;color:{{brand_color}}">${esc(
        newLabel,
      )}</td>
    </tr></table>
    ${
      caption
        ? `<div style="font-family:${SANS};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${NEUTRAL.muted};margin-top:8px">${esc(
            caption,
          )}</div>`
        : ""
    }
  </td></tr>`;
}

/** Urgency banner — a tinted box with the deadline. Static, computed at send. */
function deadlineBanner(line1 = "{{deadline_phrase}}", line2 = "Sale ends {{sale_end_display}}") {
  return `<tr><td style="padding:26px 40px 6px 40px">
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
      <tr><td align="center" bgcolor="#1A1212" style="border-radius:6px;padding:18px 20px">
        <div style="font-family:${SANS};font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#ffffff">⏳ ${esc(
          line1,
        )}</div>
        <div style="font-family:${SANS};font-size:12px;letter-spacing:1px;color:#D9CFc6;margin-top:6px">${esc(
          line2,
        )}</div>
      </td></tr>
    </table>
  </td></tr>`;
}

function divider() {
  return `<tr><td style="padding:34px 40px"><div style="height:1px;line-height:1px;font-size:0;background:${NEUTRAL.hairline}">&nbsp;</div></td></tr>`;
}

function spacer(h = 8) {
  return `<tr><td style="font-size:0;line-height:0;height:${h}px">&nbsp;</td></tr>`;
}

/** A single perk line for value-stacking (icon glyph + text). */
function perk(glyph, text) {
  return `<tr><td style="padding:6px 40px">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr>
      <td valign="top" style="font-size:16px;padding-right:12px;color:{{brand_color}}">${esc(glyph)}</td>
      <td style="font-family:${SANS};font-size:14px;line-height:1.5;color:${NEUTRAL.ink}">${text}</td>
    </tr></table>
  </td></tr>`;
}

/** Full-bleed hero image (optional). Pass a token or URL. */
function hero(srcToken, alt = "{{brand_name}}") {
  return `<tr><td style="padding:0"><img src="${srcToken}" alt="${esc(
    alt,
  )}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0" /></td></tr>`;
}

// ── Document shell ─────────────────────────────────────────────

function header() {
  // Logo image with a text fallback (Outlook/blocked-image safe). The
  // <img>'s alt carries the brand name; below it a thin accent rule.
  return `<tr><td align="center" style="padding:34px 40px 22px 40px;border-bottom:1px solid ${NEUTRAL.hairline}">
    <img src="{{logo_url}}" alt="{{brand_name}}" height="40" style="display:block;border:0;max-height:44px;width:auto" />
    <!--[if mso]>&nbsp;<![endif]-->
  </td></tr>`;
}

function footer() {
  return `<tr><td style="padding:34px 40px 40px 40px;border-top:1px solid ${NEUTRAL.hairline}" align="center">
    <div style="font-family:${SERIF};font-size:17px;color:${NEUTRAL.ink};letter-spacing:0.5px">{{brand_name}}</div>
    <div style="font-family:${SANS};font-size:12px;line-height:1.7;color:${NEUTRAL.muted};margin-top:8px">{{brand_address}}</div>
    <div style="font-family:${SANS};font-size:12px;line-height:1.7;color:${NEUTRAL.muted}">
      <a href="{{website_url}}" target="_blank" style="color:${NEUTRAL.muted};text-decoration:none">{{website_url}}</a>
      &nbsp;·&nbsp;
      <a href="mailto:{{support_email}}" style="color:${NEUTRAL.muted};text-decoration:none">{{support_email}}</a>
    </div>
    <div style="font-family:${SANS};font-size:11px;line-height:1.7;color:${NEUTRAL.faint};margin-top:16px">
      You're receiving this because you're part of the {{brand_name}} community.<br/>
      <a href="{{unsubscribe_url}}" target="_blank" style="color:${NEUTRAL.faint};text-decoration:underline">Unsubscribe</a>
      &nbsp;·&nbsp; © {{year}} {{brand_legal_name}}
    </div>
  </td></tr>`;
}

/**
 * Wrap content rows into a complete, send-ready premium HTML document.
 * @param {object} a
 * @param {string} a.preheader  hidden inbox-preview line (supports {{tokens}})
 * @param {string} a.content    the inner <tr> rows
 * @param {boolean} [a.withHeader=true]
 * @param {boolean} [a.withFooter=true]
 */
function wrapEmail({ preheader = "", content = "", withHeader = true, withFooter = true }) {
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>{{brand_name}}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<link rel="preconnect" href="https://fonts.googleapis.com">
<style>
  @import url('${FONT_IMPORT}');
  :root { color-scheme: light only; supported-color-schemes: light only; }
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  img { -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  @media only screen and (max-width:620px) {
    .pgh-card { width:100% !important; border-radius:0 !important; }
    .pgh-card td { padding-left:24px !important; padding-right:24px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${NEUTRAL.outerBg}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${NEUTRAL.outerBg}">${preheader}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${NEUTRAL.outerBg}" style="background-color:${NEUTRAL.outerBg}">
    <tr><td align="center" style="padding:32px 12px">
      <!--[if mso]><table role="presentation" width="600" border="0" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
      <table role="presentation" class="pgh-card" width="600" border="0" cellspacing="0" cellpadding="0" bgcolor="${NEUTRAL.card}" style="width:600px;max-width:600px;background-color:${NEUTRAL.card};border-radius:10px;overflow:hidden;border:1px solid ${NEUTRAL.hairline}">
${withHeader ? header() : ""}
${content}
${withFooter ? footer() : ""}
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}

/** Very small HTML→text reducer for the plain-text alternative part. */
function toPlainText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z#0-9]+;/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = {
  NEUTRAL,
  SERIF,
  SANS,
  FONT_IMPORT,
  esc,
  pad,
  eyebrow,
  heading,
  paragraph,
  button,
  priceCompare,
  deadlineBanner,
  divider,
  spacer,
  perk,
  hero,
  header,
  footer,
  wrapEmail,
  toPlainText,
};
