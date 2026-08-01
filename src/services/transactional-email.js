/**
 * Branded transactional email — the ONE place every lifecycle/account letter is
 * composed, so an offer, a welcome, a login-credentials note and a stylist
 * update all look like the same house.
 *
 * It reuses the premium email skin (services/email-theme.js) and the per-brand
 * identity resolver (modules/email_campaigns/email-render.js), exactly like the
 * curated customer welcome (services/welcome-email.js) — so one composer
 * reskins itself for Pixie Girl Global vs Faitlynhair straight from Settings:
 * logo, accent colour, name, address and links, nothing hard-coded.
 *
 * Why this exists: recruitment and the stylist programme used to hand
 * `email.send()` a bare `<p>…</p>` (or a one-off inline shell), so account mail
 * arrived looking nothing like the brand's marketing mail. Route those through
 * `sendTransactionalEmail` and they inherit the house style for free.
 *
 * Contract: `buildTransactionalEmail` is pure (no I/O) and easy to unit-test;
 * `sendTransactionalEmail` resolves the brand tokens and hands off to the SMTP
 * sender. Neither throws for a missing optional block — you compose only the
 * pieces a given message needs.
 */

"use strict";

const email = require("./email.service");
const T = require("./email-theme");
const emailRender = require("../modules/email_campaigns/email-render");

/** Coerce a paragraph spec into an email-theme row. A string is body copy; an
 *  object may set `{ html, muted }`. */
function paragraphRow(p) {
  if (p === null || p === undefined || p === "") return "";
  if (typeof p === "string") return T.paragraph(p);
  return T.paragraph(p.html || "", { muted: !!p.muted });
}

/**
 * Compose a branded transactional email from simple parts. Everything is
 * optional except that you'll usually want a heading and some body.
 *
 * @param {object} a
 * @param {object} a.brandTokens          resolved via emailRender.resolveBrandTokens
 * @param {string} [a.preheader]          hidden inbox-preview line
 * @param {string} [a.eyebrow]            small uppercase kicker above the heading
 * @param {string} [a.heading]            serif headline
 * @param {string} [a.intro]              first paragraph (HTML; escape dynamic bits)
 * @param {string} [a.bodyHtml]           a block of ready, trusted rich HTML (its
 *                                        own <p>/<strong>/…) — for callers whose
 *                                        body is already composed as HTML
 * @param {Array<string|{html:string,muted?:boolean}>} [a.body]  further paragraphs
 * @param {Array<{label:string,value:string,mono?:boolean,html?:boolean}>} [a.details]  boxed facts
 * @param {{label:string,url:string}} [a.cta]  bulletproof accent button
 * @param {string} [a.notice]             accent-tinted note (HTML; escape dynamic bits)
 * @param {string} [a.signoff]            closing muted paragraph (HTML)
 * @returns {{html:string, text:string}}
 */
function buildTransactionalEmail({
  brandTokens = {},
  preheader = "",
  eyebrow,
  heading,
  intro,
  bodyHtml,
  body = [],
  details = [],
  cta = null,
  notice,
  signoff,
}) {
  const accent = brandTokens.brand_color || "#690909";
  const content = [
    eyebrow ? T.eyebrow(eyebrow, accent) : "",
    heading ? T.heading(heading) : "",
    intro ? T.paragraph(intro) : "",
    bodyHtml ? T.richText(bodyHtml) : "",
    ...(body || []).map(paragraphRow),
    details && details.length ? T.detailBox(details) : "",
    cta && cta.url ? T.button(cta.label || "Open", cta.url, { accent }) : "",
    notice ? T.noticeBox(notice, { accent }) : "",
    signoff ? T.paragraph(signoff, { muted: true, top: 22 }) : "",
    T.spacer(18),
    T.transactionalFooter(brandTokens),
  ].join("");

  // The skin's own marketing footer is suppressed — we appended the leaner
  // transactional footer above. Brand {{tokens}} in the header/eyebrow/button
  // are resolved here from the same token set.
  const html = emailRender.renderStr(
    T.wrapEmail({ preheader, content, withFooter: false }),
    brandTokens,
  );
  return { html, text: T.toPlainText(html) };
}

/**
 * Resolve the brand identity, compose the letter, and send it. Returns the
 * Nodemailer result. Throws only what the SMTP sender throws (callers that must
 * not fail their business action wrap this in try/catch, as recruitment does).
 *
 * @param {object} a
 * @param {string} a.brand   brand key (pixiegirl | faitlynhair)
 * @param {string} a.to      recipient email
 * @param {string} a.subject
 * @param {object} a.*       any buildTransactionalEmail part (eyebrow, heading, …)
 */
async function sendTransactionalEmail({ brand, to, subject, reply_to, ...parts }) {
  const brandTokens = await emailRender.resolveBrandTokens(brand);
  const { html, text } = buildTransactionalEmail({ brandTokens, ...parts });
  return email.send({ brand, to, subject, html, text, reply_to });
}

module.exports = { buildTransactionalEmail, sendTransactionalEmail };
