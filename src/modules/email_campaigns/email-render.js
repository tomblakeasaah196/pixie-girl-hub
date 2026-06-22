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

const { query } = require("../../config/database");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { toPlainText } = require("../../services/email-theme");

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

/** Resolve the brand identity merge tokens for a brand key. */
async function resolveBrandTokens(brand) {
  const now = Date.now();
  const cached = brandCache.get(brand);
  if (cached && cached.exp > now) return cached.tokens;

  let row = null;
  try {
    row = await loadBrandRow(brand);
  } catch (err) {
    logger.warn({ err: err.message, brand }, "email-render: brand lookup failed");
  }
  const accent = (row && row.accent_colour) || "#690909";
  const theme = (row && row.brand_theme) || {};
  const website = absoluteSite((row && (row.website || row.storefront_domain)) || "");
  const tokens = {
    brand_name: (row && row.display_name) || "Our Atelier",
    brand_legal_name: (row && (row.legal_name || row.display_name)) || "",
    logo_url: absoluteAsset(row && (row.logo_path || row.logo_alt_path)),
    brand_color: accent,
    brand_color_deep: theme.accent_deep || darken(accent),
    brand_secondary: (row && row.secondary_colour) || accent,
    website_url: website,
    support_email: (row && (row.support_email || row.email)) || "",
    brand_address: (row && row.address) || "",
    brand_phone: (row && row.phone) || "",
    year: String(new Date().getFullYear()),
  };
  brandCache.set(brand, { tokens, exp: now + BRAND_TTL_MS });
  return tokens;
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
function buildEmail({ template, brandTokens, campaignTokens, recipient, brand }) {
  const rTokens = recipientTokens(recipient, brand);
  const tokens = { ...brandTokens, ...campaignTokens, ...rTokens };

  const subject = renderStr(template.subject_line, tokens);
  let html = renderStr(template.html_body, tokens);
  html = injectPixel(html, trackingPixelUrl(brand, recipient.recipient_id));

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
  resolveCampaignTokens,
  invalidateBrand,
  buildEmail,
  renderStr,
  countdown,
  darken,
  absoluteAsset,
  absoluteSite,
  trackingPixelUrl,
  unsubscribeUrl,
};
