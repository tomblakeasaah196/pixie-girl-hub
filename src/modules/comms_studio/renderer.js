/**
 * Comms Studio renderer — the shared engine that turns a stored automation
 * template (subject_template + preheader_template + email_blocks_json +
 * whatsapp_body_template) plus a set of variables into what actually ships:
 * a subject line, a full brand-skinned HTML email, a WhatsApp text body.
 *
 * Two primitives:
 *
 *   1. renderStr(str, tokens) — Mustache-style {{token}} substitution.
 *      Unknown tokens collapse to '' so a customer inbox never sees a
 *      raw {{x}} or the word "undefined". Same semantics as the existing
 *      email_campaigns/email-render.renderStr so nothing surprises operators
 *      who already learned the token syntax there.
 *
 *   2. compileBlocks(blocks, tokens) — walks the block-editor JSONB array
 *      the Studio persists and emits the wrapped-email HTML rows the
 *      services/email-theme.js primitives build. The output slots straight
 *      into wrapEmail({ content: ... }) so preview and send are byte-
 *      identical to every other branded email the Hub sends.
 *
 * Token substitution happens LAST on the assembled HTML — that's how
 * email-render.js already works, and it matches Studio expectations:
 * operators type "Hi {{first_name}}" into a block's html field, and the
 * substitution runs after the block compiler has emitted the surrounding
 * markup. Token VALUES are not escaped — some ship pre-formatted HTML
 * (e.g. due_date_html carries a <strong> wrapper), and every token
 * dictionary in the pipeline is system-controlled.
 *
 * The block schema (see 000309_shared_comms_studio.sql for examples):
 *
 *   [{ type: 'eyebrow',       text, accent? },
 *    { type: 'heading',       text, size? },
 *    { type: 'paragraph',     html, muted?, top? },
 *    { type: 'button',        label, href, accent? },
 *    { type: 'divider' },
 *    { type: 'spacer',        h? },
 *    { type: 'hero',          src, alt? },
 *    { type: 'perk',          glyph, text },
 *    { type: 'price_compare', old, new, caption? },
 *    { type: 'deadline',      line1?, line2? }]
 *
 * An unknown block type is dropped silently (with a warn) rather than
 * throwing — a bad row in one row shouldn't fail the whole send.
 */

"use strict";

const T = require("../../services/email-theme");
const { logger } = require("../../config/logger");

/** Same tokeniser as email-render.js. Unknown → ''. */
function renderStr(str, tokens) {
  return String(str === null || str === undefined ? "" : str).replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (_m, k) => {
      const v = tokens && tokens[k];
      return v === null || v === undefined ? "" : String(v);
    },
  );
}

/**
 * Compile a block-editor array into the inner `content` string that
 * wrapEmail() expects. Delegates to the exact same email-theme primitives
 * that hand-written templates use, so the visual output is identical.
 */
function compileBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  const rows = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const row = compileOne(block);
    if (row) rows.push(row);
  }
  return rows.join("\n");
}

function compileOne(b) {
  switch (b.type) {
    case "eyebrow":
      return T.eyebrow(b.text || "", b.accent || "{{brand_color}}");
    case "heading":
      return T.heading(b.text || "", { size: Number(b.size) || 30 });
    case "paragraph":
      // paragraph accepts raw HTML by design (esc'd blocks would strip
      // <strong>/<em> the operator wrote). The final token substitution
      // pass still runs on the assembled HTML.
      return T.paragraph(b.html || "", {
        muted: b.muted === true,
        top: Number.isFinite(b.top) ? b.top : 16,
      });
    case "button":
      return T.button(b.label || "Learn more", b.href || "{{cta_url}}", {
        accent: b.accent || "{{brand_color}}",
      });
    case "divider":
      return T.divider();
    case "spacer":
      return T.spacer(Number.isFinite(b.h) ? b.h : 8);
    case "hero":
      return T.hero(b.src || "", b.alt || "{{brand_name}}");
    case "perk":
      return T.perk(b.glyph || "•", b.text || "");
    case "price_compare":
      return T.priceCompare(b.old || "", b.new || "", b.caption || "");
    case "deadline":
      return T.deadlineBanner(
        b.line1 || "{{deadline_phrase}}",
        b.line2 || "Sale ends {{sale_end_display}}",
      );
    default:
      logger.warn({ type: b.type }, "comms_studio: unknown block type");
      return null;
  }
}

/**
 * Build a full branded email for one automation.
 *
 * @param {object} a
 * @param {object} a.automation  the outbound_channel_policy row
 * @param {object} a.brandTokens the {{brand_*}} tokens (from email-render.resolveBrandTokens)
 * @param {object} a.variables   automation-specific tokens (order_number, first_name, …)
 * @returns {{subject:string, html:string, text:string, preheader:string}}
 */
function buildEmail({ automation, brandTokens, variables }) {
  const tokens = { ...brandTokens, ...(variables || {}) };
  const preheader = renderStr(automation.preheader_template || "", tokens);
  const content = compileBlocks(automation.email_blocks_json || []);
  const wrapped = T.wrapEmail({ preheader, content });
  const html = renderStr(wrapped, tokens);
  const subject = renderStr(automation.subject_template || "", tokens);
  return {
    subject,
    html,
    text: T.toPlainText(html),
    preheader,
  };
}

/** Build the WhatsApp body — a single substituted plain-text string. */
function buildWhatsApp({ automation, variables }) {
  return renderStr(automation.whatsapp_body_template || "", variables || {});
}

/** Build the Instagram body — same shape as WhatsApp. */
function buildInstagram({ automation, variables }) {
  return renderStr(automation.instagram_body_template || "", variables || {});
}

/**
 * Introspect a template body and return the set of {{token}} names it
 * references. The Studio's variable palette uses this to warn when a
 * template body references a token not declared in variables_schema.
 */
function extractTokens(str) {
  const out = new Set();
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(String(str || ""))) !== null) out.add(m[1]);
  return [...out];
}

module.exports = {
  renderStr,
  compileBlocks,
  buildEmail,
  buildWhatsApp,
  buildInstagram,
  extractTokens,
};
