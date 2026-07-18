/**
 * Retention strategy mail renderer — ONE path from a send_email step to the
 * final { subject, html, text, headers }, shared by the live engine
 * (strategy.actions), the builder preview and the test-send so what the owner
 * sees is exactly what the customer gets.
 *
 * It composes the SAME pipeline campaign mail uses
 * (email_campaigns/email-render): brand identity tokens from Settings, the
 * configurable brand frame (header + footer + unsubscribe), email-safe inline
 * styles, and the shared personalise vocabulary (loyalty display tokens +
 * owner-defined custom tokens). A retention mail is indistinguishable from a
 * campaign mail in the customer's inbox — because it is the same mail.
 *
 * The step's copy comes from either:
 *   • a saved Marketing template (step.email_template_id → email_templates), or
 *   • the step's own action_config.subject / html written in the builder.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");
const render = require("../email_campaigns/email-render");
const personalise = require("../../services/email-personalise");
const theme = require("../../services/email-theme");

async function loadTemplate(brand, templateId) {
  if (!templateId) return null;
  const { rows } = await query(
    `SELECT subject_line, html_body FROM ${t(brand, "email_templates")}
      WHERE template_id = $1`,
    [templateId],
  );
  return rows[0] || null;
}

/** Flatten event.* facts into dotted keys so `{{event.order_number}}`-style
 *  tokens keep working under renderStr's flat lookup. */
function dottedEventTokens(facts) {
  const out = {};
  const event = facts && facts.event;
  if (!event || typeof event !== "object") return out;
  for (const [k, v] of Object.entries(event)) {
    if (v === null || v === undefined || typeof v === "object") continue;
    out[`event.${k}`] = String(v);
  }
  return out;
}

/** Scalar facts (numbers/strings/bools) as raw tokens — the long tail like
 *  {{order_total}}; the display layer below overrides the formatted ones. */
function scalarFactTokens(facts) {
  const out = {};
  for (const [k, v] of Object.entries(facts || {})) {
    if (v === null || v === undefined) continue;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") out[k] = String(v);
  }
  return out;
}

/**
 * Render one send_email step for one customer.
 * @param {{brand:string, step:object, facts:object}} args
 * @returns {Promise<{subject:string, html:string, text:string, headers:object, to:string|null}>}
 */
async function renderStepEmail({ brand, step, facts }) {
  const cfg = step.action_config || {};
  const tpl = await loadTemplate(brand, step.email_template_id);
  const rawSubject = tpl ? tpl.subject_line : cfg.subject || "";
  const rawBody = tpl ? tpl.html_body : cfg.html || cfg.body || "";

  const brandTokens = await render.resolveBrandTokens(brand);
  const frame = await render.resolveBrandFrame(brand);

  const first =
    facts.first_name || (facts.display_name || "").split(/\s+/)[0] || "there";
  const tokens = {
    ...scalarFactTokens(facts),
    ...dottedEventTokens(facts),
    ...brandTokens, // brand identity + owner custom tokens
    ...personalise.displayTokensFromFacts(facts), // formatted loyalty values
    first_name: first,
    customer_name: facts.display_name || first,
    email: facts.email || "",
    unsubscribe_url: facts.contact_id
      ? render.contactUnsubscribeUrl(brand, facts.contact_id)
      : "#",
  };

  const subject = render.renderStr(rawSubject, tokens);
  // Rich-text bodies get the brand frame (header/footer/unsubscribe); full
  // HTML documents (a designed Marketing template) carry their own chrome.
  let html = rawBody;
  if (!render.isFullDocument(html)) {
    html = render.applyFrame({ body: html, subjectLine: rawSubject, frame });
  }
  html = render.renderStr(html, tokens);

  const listUnsub = [
    brandTokens.support_email
      ? `<mailto:${brandTokens.support_email}?subject=unsubscribe>`
      : null,
    facts.contact_id ? `<${tokens.unsubscribe_url}>` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const headers = listUnsub
    ? {
        "List-Unsubscribe": listUnsub,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }
    : {};

  return {
    subject,
    html,
    text: theme.toPlainText(html),
    headers,
    to: facts.email || null,
  };
}

module.exports = { renderStepEmail };
