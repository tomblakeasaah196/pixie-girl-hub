/**
 * Email sender (V2.2 §6.16 — Nodemailer over transactional SMTP, no Klaviyo).
 * Used by: email campaigns, transactional notifications, retention workflows,
 * and the Smartcomm email channel (two-way customer email).
 *
 * Per-brand sending (PR-3): a brand may send through its own SMTP relay — e.g.
 * Faitlynhair via Hostinger while Pixie Girl uses the shared relay. Per-brand
 * credentials are read from the environment with a brand-key suffix:
 *
 *   SMTP_<BRANDKEY>_HOST / _PORT / _USER / _PASSWORD / _SECURE
 *   e.g. SMTP_FAITLYNHAIR_HOST=smtp.hostinger.com
 *
 * When no per-brand block is set, the global SMTP_* transport is used.
 *
 * Reply-To: every send carries Reply-To = the brand's monitored mailbox
 * (business_config.support_email). The From may stay noreply@ for transactional
 * mail, but a customer reply must land somewhere a human (and our inbound
 * webhook) can see — noreply never receives.
 */

"use strict";

const nodemailer = require("nodemailer");
const { config } = require("../config/env");
const { query } = require("../config/database");
const { logger } = require("../config/logger");

// One cached transporter per resolved config ("global" or a brand key).
const transporters = new Map();

/** Resolve a brand's SMTP block from the environment, or null for the default. */
function brandSmtp(brand) {
  if (!brand) return null;
  const key = String(brand)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const host = process.env[`SMTP_${key}_HOST`];
  if (!host) return null;
  return {
    host,
    port: Number(process.env[`SMTP_${key}_PORT`] || 587),
    secure: process.env[`SMTP_${key}_SECURE`] === "true",
    user: process.env[`SMTP_${key}_USER`],
    pass: process.env[`SMTP_${key}_PASSWORD`],
  };
}

function getTransporter(brand) {
  const bs = brandSmtp(brand);
  const cacheKey = bs ? `brand:${brand}` : "global";
  if (transporters.has(cacheKey)) return transporters.get(cacheKey);

  const t = bs
    ? nodemailer.createTransport({
        host: bs.host,
        port: bs.port,
        secure: bs.secure,
        auth: bs.user ? { user: bs.user, pass: bs.pass } : undefined,
      })
    : nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: false,
        ignoreTLS: true,
        auth: config.SMTP_USER
          ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
          : undefined,
      });
  transporters.set(cacheKey, t);
  return t;
}

async function getSender(brand) {
  if (brand) {
    try {
      const { rows } = await query(
        `SELECT email_from_address, display_name,
                support_email, support_email_display_name
         FROM shared.business_config
         WHERE business_key = $1 AND is_active = true
         LIMIT 1`,
        [brand],
      );
      if (rows.length) {
        const r = rows[0];
        return {
          fromEmail: r.email_from_address || config.SMTP_FROM_EMAIL,
          fromName: r.display_name || config.SMTP_FROM_NAME || brand,
          // Reply-To = the monitored mailbox; falls back to the From address
          // (never to noreply, which can't receive).
          replyTo: r.support_email || r.email_from_address || null,
          replyToName: r.support_email_display_name || r.display_name || null,
        };
      }
    } catch (err) {
      logger.error({ err }, "email sender lookup failed");
    }
  }
  return {
    fromEmail: config.SMTP_FROM_EMAIL || "noreply@pixiegirlglobal.com",
    fromName: config.SMTP_FROM_NAME || "Pixie Girl Hub",
    replyTo: null,
    replyToName: null,
  };
}

async function send({
  to,
  subject,
  html,
  text,
  from_email,
  from_name,
  reply_to,
  headers,
  brand,
}) {
  const t = getTransporter(brand);
  const sender = await getSender(brand);

  const replyAddr = reply_to || sender.replyTo;
  const replyTo = replyAddr
    ? sender.replyToName
      ? `${sender.replyToName} <${replyAddr}>`
      : replyAddr
    : undefined;

  return t.sendMail({
    to,
    from: `${from_name || sender.fromName} <${from_email || sender.fromEmail}>`,
    subject,
    html,
    text,
    replyTo,
    headers,
  });
}

module.exports = { send };
