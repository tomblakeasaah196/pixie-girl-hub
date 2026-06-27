/**
 * Document copy (V2.2 §6.5) — the editable wording on invoices, receipts and
 * their accompanying mail. Stored per brand in shared.document_settings and
 * surfaced through the Invoicing → Settings tab; this module is the SSOT for
 * the DEFAULTS and the read/write/merge helpers.
 *
 * The defaults are deliberately warm and personal — a curated thank-you that
 * names the customer and the brand, not a generic "thank you for your
 * business". Operators can override any line per brand without code changes.
 *
 * Supported merge tokens in any copy string (unknown tokens collapse to ''):
 *   {first_name} {brand_name} {invoice_number} {receipt_number}
 *   {order_number} {total}
 */

"use strict";

const { query } = require("../config/database");
const { logger } = require("../config/logger");

// ── Curated defaults ───────────────────────────────────────────
// pdf.message → the big serif "thank-you" line on the document (replaces the
//   old "Thank you for your business"). pdf.note_* → the soft note card.
// email.* → wording for the mail that carries the document.
const DEFAULTS = Object.freeze({
  invoice: {
    pdf: {
      note_label: "Payment",
      note:
        "Please settle within the agreed terms and quote your invoice number on any transfer so we can match it the moment it lands.",
      message: "Prepared with care for you, {first_name}.",
    },
    email: {
      subject: "Your {brand_name} invoice {invoice_number}",
      heading: "Here is your invoice, {first_name}",
      body:
        "Your invoice {invoice_number} is attached. Every line has been prepared with care — if anything needs a second look, just reply and a real person will help.",
      signoff: "With gratitude,\nThe {brand_name} team",
    },
  },
  receipt: {
    pdf: {
      note_label: "A note for you",
      note:
        "This is your official receipt — payment received in full, nothing outstanding. Keep it for your records.",
      message:
        "Made with intention for you, {first_name} — thank you for letting {brand_name} be part of your story.",
    },
    email: {
      // The order-confirmation mail (sent on payment) reads these to override
      // its curated opening line + sign-off. Blank → the email's built-in copy.
      intro: "",
      signoff: "",
    },
  },
});

// ── helpers ────────────────────────────────────────────────────
function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/** Deep-merge `override` onto `base` (override wins; objects merged, scalars replaced). */
function deepMerge(base, override) {
  if (!isObject(override)) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) continue;
    out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/** Replace {token} placeholders; unknown/empty tokens collapse to ''. */
function fillTokens(str, tokens = {}) {
  return String(str === null || str === undefined ? "" : str).replace(
    /\{\s*([\w.]+)\s*\}/g,
    (_m, k) => {
      const v = tokens[k];
      return v === null || v === undefined ? "" : String(v);
    },
  );
}

/**
 * Resolve the effective copy for a brand: stored overrides deep-merged over the
 * curated DEFAULTS. Never throws — falls back to DEFAULTS on any DB hiccup so a
 * document render is never blocked by a settings lookup.
 */
async function resolveCopy(brand) {
  try {
    const { rows } = await query(
      `SELECT settings FROM shared.document_settings WHERE business_key = $1 LIMIT 1`,
      [brand],
    );
    const stored = (rows[0] && rows[0].settings) || {};
    return deepMerge(DEFAULTS, stored);
  } catch (err) {
    logger.warn(
      { err: err.message, brand },
      "document-copy: settings lookup failed — using curated defaults",
    );
    return DEFAULTS;
  }
}

/** The stored overrides only (no defaults merged) — for the Settings editor to
 *  show which fields the operator has customised. */
async function getStored(brand) {
  const { rows } = await query(
    `SELECT settings FROM shared.document_settings WHERE business_key = $1 LIMIT 1`,
    [brand],
  );
  return (rows[0] && rows[0].settings) || {};
}

/**
 * Persist a (partial) copy override for a brand. The patch is deep-merged onto
 * any existing overrides, so a single field can be saved without resending the
 * whole blob. Upserts the row. Returns the new stored overrides.
 */
async function saveCopy({ brand, patch, user_id = null, client = null }) {
  const run = client ? client.query.bind(client) : query;
  const { rows: cur } = await run(
    `SELECT settings FROM shared.document_settings WHERE business_key = $1 LIMIT 1`,
    [brand],
  );
  const merged = deepMerge((cur[0] && cur[0].settings) || {}, patch || {});
  const { rows } = await run(
    `INSERT INTO shared.document_settings (business_key, settings, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (business_key) DO UPDATE
       SET settings = $2::jsonb, updated_by = $3, updated_at = now()
     RETURNING settings`,
    [brand, JSON.stringify(merged), user_id],
  );
  return rows[0].settings;
}

module.exports = {
  DEFAULTS,
  deepMerge,
  fillTokens,
  resolveCopy,
  getStored,
  saveCopy,
};
