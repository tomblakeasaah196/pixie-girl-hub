/**
 * Email render pipeline — turns a stored template + a campaign + a recipient
 * into the final { subject, html, text, headers } that hits the wire.
 *
 * Three layers of merge tokens, later wins:
 *   1. Brand     — pulled from shared.business_config (logo, accent colour,
 *                  name, website, support email, address). Nothing hard-coded;
 *                  switch brand → the email reskins itself.
 *   2. Campaign  — campaign.merge_data (e.g. the sale's discount, link and end
 *                  date). Date-derived tokens (days_left, deadline_phrase) are
 *                  computed here so the countdown is correct at the moment of
 *                  send and renders identically in Gmail / Outlook / Apple.
 *   3. Recipient — customer_name, first_name, email, and the per-recipient
 *                  unsubscribe + open-tracking URLs.
 *
 * Also injects the open-tracking pixel and emits a List-Unsubscribe header
 * (one-click) — both real deliverability wins for inbox placement.
 */

"use strict";

const crypto = require("crypto");
const { query } = require("../../config/database");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const theme = require("../../services/email-theme");
const personalise = require("../../services/email-personalise");
const { toPlainText } = theme;

// ── URL helpers ────────────────────────────────────────────────
const isAbsolute = (u) => /^https?:\/\//i.test(String(u || ""));

/** The host that serves /media and /api/public/email (this backend). */
function apiBase() {
  return String(config.APP_URL || "").replace(/\/+$/, "");
}
/** Where uploaded assets resolve from (CDN if configured, else this host). */
function mediaBase() {
  return String(config.CDN_BASE_URL || config.APP_URL || "").replace(/\/+$/, "");
}

function absoluteAsset(p) {
  const v = String(p || "").trim();
  if (!v) return "";
  // Already a usable reference (https, embedded data URI, or a CID attachment).
  if (isAbsolute(v) || /^(data|cid):/i.test(v)) return v;
  return `${mediaBase()}${v.startsWith("/") ? "" : "/"}${v}`;
}
function absoluteSite(p) {
  const v = String(p || "").trim();
  if (!v) return "";
  if (isAbsolute(v)) return v.replace(/\/+$/, "");
  return `https://${v.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

/** Darken a #rrggbb hex by `ratio` (0..1). Used to derive an accent-deep when
 *  the brand hasn't set one explicitly. */
function darken(hex, ratio = 0.32) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return hex || "#690909";
  const n = parseInt(m[1], 16);
  const f = Math.max(0, 1 - ratio);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// ── Brand tokens (cached; Settings-driven) ─────────────────────
const brandCache = new Map();
const BRAND_TTL_MS = 60_000;

/**
 * A stored template is either a complete HTML document (the seeded premium
 * templates and old studio designs carry their own chrome) or a bare rich-text
 * body written in the mail editor. Bare bodies get wrapped in the brand frame
 * (header + footer) at render time; full documents are sent as-is.
 */
function isFullDocument(html) {
  return /<!DOCTYPE|<html[\s>]|<body[\s>]/i.test(String(html || ""));
}

// Inline styles for the rich-text tags the mail editor emits. Gmail strips
// <style> blocks, so every tag must carry its look inline. Only tags without
// an existing style attribute are touched — editor-set colours/sizes win.
const RICH_TAG_STYLES = {
  h1: `margin:22px 0 10px 0;font-family:${theme.SERIF};font-size:28px;line-height:1.25;font-weight:600;color:${theme.NEUTRAL.ink}`,
  h2: `margin:20px 0 8px 0;font-family:${theme.SERIF};font-size:22px;line-height:1.3;font-weight:600;color:${theme.NEUTRAL.ink}`,
  h3: `margin:18px 0 6px 0;font-family:${theme.SANS};font-size:16px;line-height:1.35;font-weight:700;color:${theme.NEUTRAL.ink}`,
  ul: `margin:0 0 14px 0;padding-left:22px`,
  ol: `margin:0 0 14px 0;padding-left:22px`,
  li: `margin:0 0 6px 0;font-family:${theme.SANS};font-size:15px;line-height:1.62;color:${theme.NEUTRAL.ink}`,
  a: `color:{{brand_color}};text-decoration:underline`,
  blockquote: `margin:0 0 14px 0;padding:2px 0 2px 16px;border-left:3px solid {{brand_color}};font-family:${theme.SANS};font-size:15px;line-height:1.62;color:${theme.NEUTRAL.muted}`,
  img: `max-width:100%;height:auto;border:0;border-radius:6px`,
  hr: `border:none;border-top:1px solid ${theme.NEUTRAL.hairline};margin:22px 0`,
};

// Per-paragraph vertical rhythm (the editor's Line-spacing control writes a
// `data-space` attribute). Keep these values identical to previewRichStyles in
// apps/admin/src/pages/marketing/EmailExtras.tsx and the editor CSS.
const P_SPACE = {
  tight: "margin:0 0 3px 0;line-height:1.4",
  relaxed: "margin:0 0 24px 0;line-height:1.95",
  normal: "margin:0 0 14px 0;line-height:1.62",
};
const P_FONT = `font-family:${theme.SANS};font-size:15px;color:${theme.NEUTRAL.ink}`;

/** Style every <p> with its spacing + font, preserving an editor-set
 *  text-align. Handled apart from the generic pass so spacing survives. */
function stripParagraphSpacing(html) {
  return String(html).replace(/<p\b([^>]*)>/gi, (_m, attrs) => {
    const spaceMatch = /data-space="(tight|relaxed)"/i.exec(attrs);
    const key = spaceMatch ? spaceMatch[1].toLowerCase() : "normal";
    const styleMatch = /style="([^"]*)"/i.exec(attrs);
    let align = "";
    if (styleMatch) {
      const ta = /text-align:\s*(left|right|center|justify)/i.exec(styleMatch[1]);
      if (ta) align = `;text-align:${ta[1]}`;
    }
    const cleaned = attrs
      .replace(/\s*data-space="[^"]*"/i, "")
      .replace(/\s*style="[^"]*"/i, "");
    return `<p style="${P_SPACE[key]};${P_FONT}${align}"${cleaned}>`;
  });
}

/** Give bare rich-text tags email-safe inline styles. */
function inlineRichStyles(html) {
  let out = stripParagraphSpacing(String(html || ""));
  for (const [tag, style] of Object.entries(RICH_TAG_STYLES)) {
    out = out.replace(
      new RegExp(`<${tag}(?![a-z0-9])(?![^>]*\\bstyle=)([^>]*)>`, "gi"),
      `<${tag} style="${style}"$1>`,
    );
  }
  return out;
}

/**
 * Wrap a rich-text body in the brand frame: premium shell + configurable
 * header/footer. `frame` is the brand's email_frame config (may be empty —
 * the seeded defaults already look finished).
 */
function applyFrame({ body, subjectLine = "", frame }) {
  const content = `<tr><td style="padding:30px 40px 26px 40px">
    <div style="font-family:${theme.SANS};font-size:15px;line-height:1.62;color:${theme.NEUTRAL.ink}">${inlineRichStyles(body)}</div>
  </td></tr>`;
  return theme.wrapEmail({
    preheader: subjectLine,
    content,
    headerHtml: theme.frameHeader(frame),
    footerHtml: theme.frameFooter(frame),
  });
}

async function loadBrandRow(brand) {
  const { rows } = await query(
    `SELECT display_name, legal_name, accent_colour, secondary_colour,
            logo_path, logo_alt_path, brand_theme, website, storefront_domain,
            support_email, support_email_display_name, address, phone, email
       FROM shared.business_config
      WHERE business_key = $1 AND is_active = true
      LIMIT 1`,
    [brand],
  );
  return rows[0] || null;
}

/** Load + cache a brand's identity tokens and email frame config together. */
async function resolveBrand(brand) {
  const now = Date.now();
  const cached = brandCache.get(brand);
  if (cached && cached.exp > now) return cached;

  let row = null;
  try {
    row = await loadBrandRow(brand);
  } catch (err) {
    logger.warn({ err: err.message, brand }, "email-render: brand lookup failed");
  }
  const accent = (row && row.accent_colour) || "#690909";
  const brandTheme = (row && row.brand_theme) || {};
  const website = absoluteSite((row && (row.website || row.storefront_domain)) || "");
  const tokens = {
    // Owner-defined custom tokens first, so a built-in of the same name
    // always wins (save-time validation blocks the collision anyway).
    ...personalise.customTokenMap(brandTheme.email_custom_tokens),
    brand_name: (row && row.display_name) || "Our Atelier",
    brand_legal_name: (row && (row.legal_name || row.display_name)) || "",
    logo_url: absoluteAsset(row && (row.logo_path || row.logo_alt_path)),
    brand_color: accent,
    brand_color_deep: brandTheme.accent_deep || darken(accent),
    brand_secondary: (row && row.secondary_colour) || accent,
    website_url: website,
    support_email: (row && (row.support_email || row.email)) || "",
    brand_address: (row && row.address) || "",
    brand_phone: (row && row.phone) || "",
    year: String(new Date().getFullYear()),
  };
  const entry = {
    tokens,
    frame: theme.resolveFrame(brandTheme.email_frame),
    exp: now + BRAND_TTL_MS,
  };
  brandCache.set(brand, entry);
  return entry;
}

/** Resolve the brand identity merge tokens for a brand key. */
async function resolveBrandTokens(brand) {
  return (await resolveBrand(brand)).tokens;
}

/** Resolve the brand's email frame (header/footer) config, defaults applied. */
async function resolveBrandFrame(brand) {
  return (await resolveBrand(brand)).frame;
}

function invalidateBrand(brand) {
  if (brand) brandCache.delete(brand);
  else brandCache.clear();
}

// ── Campaign / sale tokens ─────────────────────────────────────
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDay(d) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Turn a deadline into a human, static countdown phrase (computed at send). */
function countdown(endIso) {
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return { days_left: "", deadline_phrase: "", sale_end_display: "" };
  const ms = end.getTime() - Date.now();
  const hours = ms / 3_600_000;
  // Round (not ceil) so ~49h reads "2 days", not "3" — the phrase pairs with
  // the always-shown end date, so it should feel honest, not inflated.
  const days = Math.max(1, Math.round(hours / 24));
  let phrase;
  let daysLeft;
  if (ms <= 0) {
    phrase = "Last chance";
    daysLeft = "0";
  } else if (hours <= 24) {
    phrase = "Final hours — ends today";
    daysLeft = "1";
  } else {
    phrase = days <= 1 ? "Only 1 day left" : `Only ${days} days left`;
    daysLeft = String(days);
  }
  return {
    days_left: daysLeft,
    deadline_phrase: phrase,
    sale_end_display: formatDay(end),
  };
}

/** Build the campaign-level merge tokens from a campaign's merge_data blob. */
function resolveCampaignTokens(campaign) {
  const md = (campaign && campaign.merge_data) || {};
  const out = {};
  // Pass through any scalar custom keys the CEO set on the campaign.
  for (const [k, v] of Object.entries(md)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    out[k] = String(v);
  }
  if (md.sale_url) out.sale_url = absoluteSite(md.sale_url);
  // cta_url defaults to the sale link so a template can use either token.
  out.cta_url = out.cta_url || out.sale_url || absoluteSite(md.cta_url || "");
  out.cta_label = out.cta_label || md.cta_label || "Shop the collection";
  if (md.sale_ends_at || md.sale_end) {
    Object.assign(out, countdown(md.sale_ends_at || md.sale_end));
  }
  return out;
}

// ── Recipient tokens + tracking ────────────────────────────────
function trackingPixelUrl(brand, recipientId) {
  return `${apiBase()}/api/public/email/open/${recipientId}?brand=${encodeURIComponent(brand)}`;
}
function unsubscribeUrl(brand, recipientId) {
  return `${apiBase()}/api/public/email/unsubscribe/${recipientId}?brand=${encodeURIComponent(brand)}`;
}

// Contact-level unsubscribe — used by retention strategy mails, which have no
// campaign-recipient row. The link carries `contact_id.hmac` so a public,
// unauthenticated endpoint can trust it without a lookup table.
function signContact(contactId, brand) {
  return crypto
    .createHmac("sha256", config.JWT_SECRET)
    .update(`unsub:${contactId}:${brand}`)
    .digest("hex")
    .slice(0, 24);
}
function contactUnsubscribeToken(contactId, brand) {
  return `${contactId}.${signContact(contactId, brand)}`;
}
/** @returns {string|null} the contact_id when the token is genuine */
function verifyContactUnsubscribeToken(token, brand) {
  const [contactId, sig] = String(token || "").split(".");
  if (!contactId || !sig) return null;
  const expected = signContact(contactId, brand);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return contactId;
}
function contactUnsubscribeUrl(brand, contactId) {
  return `${apiBase()}/api/public/email/unsubscribe-contact/${contactUnsubscribeToken(contactId, brand)}?brand=${encodeURIComponent(brand)}`;
}

function recipientTokens(recipient, brand) {
  const name = (recipient.contact_name_snapshot || "").trim();
  const first = name.split(/\s+/)[0] || "there";
  return {
    customer_name: name || "there",
    first_name: first,
    email: recipient.email || "",
    unsubscribe_url: unsubscribeUrl(brand, recipient.recipient_id),
  };
}

// ── Substitution ───────────────────────────────────────────────
/** Replace {{token}} placeholders; unknown tokens collapse to '' (never leak
 *  a raw {{x}} or the string "undefined" into a customer's inbox). */
function renderStr(str, tokens) {
  return String(str === null || str === undefined ? "" : str).replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (_m, k) => {
      const v = tokens[k];
      return v === null || v === undefined ? "" : String(v);
    },
  );
}

/** Append the open-tracking pixel just before </body> (or at the end). */
function injectPixel(html, pixelUrl) {
  const img = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;max-height:1px;max-width:1px;overflow:hidden" />`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${img}</body>`) : html + img;
}

/**
 * Render one recipient's email.
 * @returns {{subject:string, html:string, text:string, headers:object}}
 */
function buildEmail({
  template,
  brandTokens,
  campaignTokens,
  recipient,
  brand,
  frame,
  tracking = true,
}) {
  const rTokens = recipientTokens(recipient, brand);
  const tokens = { ...brandTokens, ...campaignTokens, ...rTokens };

  const subject = renderStr(template.subject_line, tokens);
  let body = template.html_body;
  // Rich-text bodies from the mail editor get the brand frame; full documents
  // (seeded premium templates, legacy studio designs) already carry their own.
  if (!isFullDocument(body)) {
    body = applyFrame({ body, subjectLine: template.subject_line, frame });
  }
  let html = renderStr(body, tokens);
  if (tracking) {
    html = injectPixel(html, trackingPixelUrl(brand, recipient.recipient_id));
  }

  const text = template.plain_text_body
    ? renderStr(template.plain_text_body, tokens)
    : toPlainText(html);

  // One-click unsubscribe — strong inbox-placement signal for Gmail/Outlook.
  const headers = {
    "List-Unsubscribe": [
      brandTokens.support_email ? `<mailto:${brandTokens.support_email}?subject=unsubscribe>` : null,
      `<${rTokens.unsubscribe_url}>`,
    ]
      .filter(Boolean)
      .join(", "),
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  return { subject, html, text, headers };
}

module.exports = {
  resolveBrandTokens,
  resolveBrandFrame,
  resolveCampaignTokens,
  invalidateBrand,
  isFullDocument,
  inlineRichStyles,
  applyFrame,
  buildEmail,
  renderStr,
  countdown,
  darken,
  absoluteAsset,
  absoluteSite,
  trackingPixelUrl,
  unsubscribeUrl,
  contactUnsubscribeUrl,
  verifyContactUnsubscribeToken,
};
