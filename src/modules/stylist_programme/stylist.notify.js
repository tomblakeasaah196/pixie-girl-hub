/**
 * Stylist Partner Programme (V2.2 §6.26) — partner-facing notifications (Q18).
 *
 * Channel policy v1: in-portal feed (shared.stylist_notifications) + email.
 * Stylists are NOT shared.users, so the staff notification rail cannot carry
 * these. Every send is best-effort: a notification failure never breaks the
 * business action that triggered it.
 */

"use strict";

const programmeRepo = require("./programme.repo");
const { sendTransactionalEmail } = require("../../services/transactional-email");
const { logger } = require("../../config/logger");

const BRAND = "pixiegirl"; // programme surface is PXG-only at launch (Q4)

async function portalBaseUrl() {
  try {
    const cfg = await programmeRepo.getConfig({ business: BRAND });
    if (cfg && cfg.portal_subdomain) return `https://${cfg.portal_subdomain}`;
  } catch {
    /* fall through to default */
  }
  return "https://style.pixiegirlglobal.com";
}

/**
 * Send a partner email in the SAME premium, per-brand skin as every other
 * lifecycle letter (logo header, accent button, luxury footer) instead of the
 * old hand-rolled inline shell with a hard-coded maroon. The programme's
 * authored bodyHtml is trusted in-repo HTML, so it rides through as `bodyHtml`.
 */
async function sendBranded({ to, subject, title, bodyHtml, ctaLabel, ctaUrl }) {
  await sendTransactionalEmail({
    brand: BRAND,
    to,
    subject,
    preheader: title,
    eyebrow: "Stylist Partner Programme",
    heading: title,
    bodyHtml,
    cta: ctaLabel && ctaUrl ? { label: ctaLabel, url: ctaUrl } : null,
  });
}

/**
 * Write the in-portal notification and (best-effort) email the partner.
 * `email` is optional: { subject, bodyHtml, ctaLabel, ctaPath }.
 */
async function notifyStylist({
  client,
  stylist_id,
  type,
  title,
  body,
  data,
  email,
}) {
  try {
    await programmeRepo.insertNotification({
      client,
      n: { stylist_id, type, title, body, data },
    });
  } catch (err) {
    logger.error(
      { err: err.message, stylist_id, type },
      "stylist: notification insert failed",
    );
  }
  if (!email) return;
  try {
    const cred = await programmeRepo.findCredentialByStylist({ stylist_id });
    if (!cred || !cred.email) return;
    const base = await portalBaseUrl();
    await sendBranded({
      to: cred.email,
      subject: email.subject || title,
      title: email.subject || title,
      bodyHtml: email.bodyHtml || `<p>${body || ""}</p>`,
      ctaLabel: email.ctaLabel,
      ctaUrl: email.ctaPath ? `${base}${email.ctaPath}` : undefined,
    });
  } catch (err) {
    logger.error(
      { err: err.message, stylist_id, type },
      "stylist: notification email failed",
    );
  }
}

/** Email an arbitrary address (applicants without credentials yet). */
async function emailAddress({ to, subject, bodyHtml, ctaLabel, ctaPath }) {
  try {
    const base = await portalBaseUrl();
    await sendBranded({
      to,
      subject,
      title: subject,
      bodyHtml,
      ctaLabel,
      ctaUrl: ctaPath
        ? ctaPath.startsWith("http")
          ? ctaPath
          : `${base}${ctaPath}`
        : undefined,
    });
  } catch (err) {
    logger.error({ err: err.message, to }, "stylist: applicant email failed");
  }
}

module.exports = { notifyStylist, emailAddress, portalBaseUrl, BRAND };
