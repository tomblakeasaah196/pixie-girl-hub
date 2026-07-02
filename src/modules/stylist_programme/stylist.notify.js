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
const emailService = require("../../services/email.service");
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

function emailShell({ title, bodyHtml, ctaLabel, ctaUrl }) {
  const cta =
    ctaLabel && ctaUrl
      ? `<p style="margin:28px 0;"><a href="${ctaUrl}" style="background:#690909;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;">${ctaLabel}</a></p>`
      : "";
  return `
  <div style="font-family:Montserrat,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1c1c1c;">
    <h2 style="font-family:Georgia,'Playfair Display',serif;color:#690909;margin:0 0 16px;">${title}</h2>
    <div style="font-size:15px;line-height:1.6;">${bodyHtml}</div>
    ${cta}
    <p style="font-size:12px;color:#8a8a8a;border-top:1px solid #eee;padding-top:16px;margin-top:32px;">
      Pixie Girl Global — Stylist Partner Programme
    </p>
  </div>`;
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
    await emailService.send({
      to: cred.email,
      subject: email.subject || title,
      html: emailShell({
        title: email.subject || title,
        bodyHtml: email.bodyHtml || `<p>${body || ""}</p>`,
        ctaLabel: email.ctaLabel,
        ctaUrl: email.ctaPath ? `${base}${email.ctaPath}` : undefined,
      }),
      brand: BRAND,
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
    await emailService.send({
      to,
      subject,
      html: emailShell({
        title: subject,
        bodyHtml,
        ctaLabel,
        ctaUrl: ctaPath
          ? ctaPath.startsWith("http")
            ? ctaPath
            : `${base}${ctaPath}`
          : undefined,
      }),
      brand: BRAND,
    });
  } catch (err) {
    logger.error({ err: err.message, to }, "stylist: applicant email failed");
  }
}

module.exports = { notifyStylist, emailAddress, portalBaseUrl, BRAND };
