/**
 * Welcome email — the first touch a customer gets after self-registering via
 * the public Walk-in QR or the Online-QR onboarding form.
 *
 * It is deliberately curated and luxurious: it reuses the premium email skin
 * (services/email-theme.js) and the per-brand identity resolver
 * (modules/email_campaigns/email-render.js), so one letter reskins itself for
 * Pixie Girl Global vs Faitlyn Hair straight from Settings — logo, accent
 * colour, name, links and address, nothing hard-coded.
 *
 * Best-effort by contract: send() never throws. Registration must succeed even
 * if SMTP is down or unconfigured, so callers fire-and-forget after the DB
 * transaction commits and a failure is only logged.
 */

"use strict";

const email = require("./email.service");
const T = require("./email-theme");
const emailRender = require("../modules/email_campaigns/email-render");
const { logger } = require("../config/logger");

/**
 * Compose the welcome letter for a brand + recipient.
 * @returns {{subject:string, html:string, text:string}}
 */
function buildWelcomeEmail({ brandTokens, firstName }) {
  const name = (firstName || "").trim();
  const brandName = brandTokens.brand_name || "our atelier";
  const greeting = name ? `Welcome, ${name}` : "Welcome";

  // Footer references {{unsubscribe_url}}; a welcome note has no list to leave,
  // so point it at a courteous mailto (or the site) rather than a dead link.
  const unsubscribe = brandTokens.support_email
    ? `mailto:${brandTokens.support_email}?subject=Unsubscribe`
    : brandTokens.website_url || "";

  const content = [
    T.eyebrow("A WARM WELCOME"),
    T.heading(`${greeting} — you're now part of ${T.esc(brandName)}.`),
    T.paragraph(
      `Thank you for sharing your details with us. Your profile is set up, your delivery address is safely on file, and our team is ready to look after you.`,
    ),
    T.paragraph(
      `From today, you'll be among the first to hear about new arrivals, private offers, and the quiet little touches we reserve for our community.`,
      { muted: true },
    ),
    T.divider(),
    T.perk("✦", "A delivery address mapped for swift, accurate dispatch"),
    T.perk("✦", "Priority care from a team that remembers your preferences"),
    T.perk("✦", "A little something on your birthday, every single year"),
    T.spacer(10),
    brandTokens.website_url
      ? T.button("Explore the collection", brandTokens.website_url, {
          accent: brandTokens.brand_color,
        })
      : "",
    T.spacer(8),
    T.paragraph(`With love,<br/>The ${T.esc(brandName)} team`, {
      muted: true,
    }),
    T.spacer(20),
  ].join("");

  const html = emailRender.renderStr(
    T.wrapEmail({
      preheader: `Welcome to ${brandName} — we're so glad you're here.`,
      content,
    }),
    { ...brandTokens, first_name: name || "there", unsubscribe_url: unsubscribe },
  );

  return {
    subject: `Welcome to ${brandName} 🌹`,
    html,
    text: T.toPlainText(html),
  };
}

/**
 * Render + send the welcome email. Never throws — a delivery problem must not
 * roll back (or appear to fail) a successful registration.
 *
 * @param {object} a
 * @param {string} a.brand      brand key (pixiegirl | faitlynhair)
 * @param {string} a.to         recipient email (no-op when falsy)
 * @param {string} [a.firstName]
 */
async function sendWelcomeEmail({ brand, to, firstName }) {
  if (!to) return; // walk-ins may register with a phone only — nothing to send
  try {
    const brandTokens = await emailRender.resolveBrandTokens(brand);
    const { subject, html, text } = buildWelcomeEmail({ brandTokens, firstName });
    await email.send({ to, subject, html, text, brand });
    logger.info({ brand }, "welcome email sent");
  } catch (err) {
    logger.error(
      { err: err.message, brand },
      "welcome email send failed — registration unaffected",
    );
  }
}

module.exports = { sendWelcomeEmail, buildWelcomeEmail };
