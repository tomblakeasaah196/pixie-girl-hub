/**
 * Email personalisation tokens — the ONE vocabulary both mail engines speak.
 *
 * Marketing campaigns (modules/email_campaigns) and retention strategies
 * (modules/retention) render through the same pipeline; this service owns the
 * pieces they share so a token written in either editor means the same thing:
 *
 *   • displayTokensFromFacts() — turns a customer facts snapshot (see
 *     retention/strategy.facts.js) into inbox-ready display strings:
 *     "{{points_balance}}" → "1,250", "{{lifetime_spend}}" → "₦350,000".
 *     Raw numbers never leak into a customer's mail.
 *   • sampleDisplayTokens() — friendly stand-in values for editor previews.
 *   • Custom-token rules — per-brand tokens the owner defines in the editor's
 *     Personalise menu (stored in business_config.brand_theme). Validation
 *     lives here so the API and render agree on what a legal token is.
 *
 * Never a query in this file — callers bring their own data.
 */

"use strict";

// Orders that count toward spend / recency: placed and not voided. Shared by
// the retention facts builder and the campaign loyalty-token loader so both
// engines agree on what an "order" is.
const COUNTED_ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "awaiting_dispatch",
  "in_production",
  "with_stylist",
  "ready_for_dispatch",
  "dispatched",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "completed",
];

/** Contacts carrying this tag (per business) receive no marketing/retention
 *  email. Written by both unsubscribe paths; read by both send paths. */
const UNSUBSCRIBED_TAG = "email_unsubscribed";

// Custom tokens: lowercase snake_case, 2–40 chars, must not shadow a
// pipeline-owned token (brand identity, recipient, sale, loyalty).
const CUSTOM_TOKEN_RE = /^[a-z][a-z0-9_]{1,39}$/;
const RESERVED_TOKENS = new Set([
  // recipient
  "first_name",
  "customer_name",
  "email",
  "unsubscribe_url",
  // loyalty (display layer below)
  "points_balance",
  "lifetime_points",
  "tier_name",
  "order_count",
  "lifetime_spend",
  "days_since_last_order",
  "days_since_signup",
  // brand identity (email-render.resolveBrandTokens)
  "brand_name",
  "brand_legal_name",
  "logo_url",
  "brand_color",
  "brand_color_deep",
  "brand_secondary",
  "website_url",
  "support_email",
  "brand_address",
  "brand_phone",
  "year",
  // sale / campaign
  "discount",
  "sale_url",
  "sale_end_display",
  "deadline_phrase",
  "days_left",
  "cta_url",
  "cta_label",
]);

const MAX_CUSTOM_TOKENS = 50;

/**
 * Validate + normalise a custom-token list from the API.
 * @param {unknown} list
 * @returns {{token:string,label:string,value:string}[]}
 * @throws {Error} message is user-safe
 */
function normaliseCustomTokens(list) {
  if (!Array.isArray(list)) throw new Error("Tokens must be a list");
  if (list.length > MAX_CUSTOM_TOKENS)
    throw new Error(`At most ${MAX_CUSTOM_TOKENS} custom tokens`);
  const seen = new Set();
  return list.map((raw) => {
    const token = String((raw && raw.token) || "")
      .trim()
      .toLowerCase();
    if (!CUSTOM_TOKEN_RE.test(token))
      throw new Error(
        `"${token || "(empty)"}" is not a valid token name — use lowercase letters, numbers and underscores`,
      );
    if (RESERVED_TOKENS.has(token))
      throw new Error(`"${token}" is a built-in token name`);
    if (seen.has(token)) throw new Error(`"${token}" appears twice`);
    seen.add(token);
    return {
      token,
      label: String((raw && raw.label) || token).slice(0, 60),
      value: String((raw && raw.value) || "").slice(0, 500),
    };
  });
}

/** Custom tokens → a flat {token: value} map for the render merge. */
function customTokenMap(list) {
  const out = {};
  for (const t of Array.isArray(list) ? list : []) {
    if (t && t.token && CUSTOM_TOKEN_RE.test(t.token) && !RESERVED_TOKENS.has(t.token)) {
      out[t.token] = t.value === null || t.value === undefined ? "" : String(t.value);
    }
  }
  return out;
}

// ── Display formatting ─────────────────────────────────────────
function int(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v).toLocaleString("en-NG") : "";
}
function ngn(n) {
  const v = Number(n);
  return Number.isFinite(v) ? `₦${Math.round(v).toLocaleString("en-NG")}` : "";
}

/**
 * Customer facts snapshot → inbox-ready display tokens. Missing facts render
 * as "" (renderStr collapses unknowns anyway) so a mail never shows "null".
 * @param {object} facts (retention/strategy.facts.js shape, or the campaign
 *                        loyalty-row equivalent)
 */
function displayTokensFromFacts(facts) {
  const f = facts || {};
  const has = (v) => v !== null && v !== undefined;
  return {
    points_balance: has(f.points_balance) ? int(f.points_balance) : "",
    lifetime_points: has(f.lifetime_points) ? int(f.lifetime_points) : "",
    tier_name: f.tier_name || "",
    order_count: has(f.order_count) ? int(f.order_count) : "",
    lifetime_spend: has(f.lifetime_spend) ? ngn(f.lifetime_spend) : "",
    days_since_last_order: has(f.days_since_last_order)
      ? int(f.days_since_last_order)
      : "",
    days_since_signup: has(f.days_since_signup) ? int(f.days_since_signup) : "",
  };
}

/** Friendly stand-ins so editor previews and the frame shell always fill. */
function sampleDisplayTokens() {
  return {
    points_balance: "1,250",
    lifetime_points: "3,400",
    tier_name: "Gold",
    order_count: "4",
    lifetime_spend: "₦350,000",
    days_since_last_order: "12",
    days_since_signup: "230",
  };
}

module.exports = {
  COUNTED_ORDER_STATUSES,
  UNSUBSCRIBED_TAG,
  CUSTOM_TOKEN_RE,
  RESERVED_TOKENS,
  MAX_CUSTOM_TOKENS,
  normaliseCustomTokens,
  customTokenMap,
  displayTokensFromFacts,
  sampleDisplayTokens,
};
