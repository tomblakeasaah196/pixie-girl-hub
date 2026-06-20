/**
 * Email sender (V2.2 §6.16 — Nodemailer over transactional SMTP, no Klaviyo).
 * Used by: email campaigns, transactional notifications, retention workflows.
 *
 * Sends via the single configured SMTP relay (SMTP_*). The per-brand identity
 * comes from the FROM address (business_config.email_from_address), not from a
 * separate SMTP host.
 *
 * Reply-To rule (EMAIL_TWO_WAY_SETUP): every outbound message carries a
 * conversational `Reply-To: sales@<brand-domain>` — even transactional mail
 * whose From is `noreply@` — so a customer's reply lands on the monitored
 * mailbox that Cloudflare Email Routing forwards into our inbound webhook and
 * threads back into the conversation. A caller-supplied reply_to always wins.
 */

"use strict";

const nodemailer = require("nodemailer");
const { config } = require("../config/env");
const { query } = require("../config/database");
const { logger } = require("../config/logger");

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: false,
      ignoreTLS: true,
      auth: config.SMTP_USER
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
        : undefined,
    });
  }
  return transporter;
}

async function getSender(brand) {
  if (brand) {
    try {
      const { rows } = await query(
        `SELECT email_from_address, display_name
         FROM shared.business_config
         WHERE business_key = $1 AND is_active = true
         LIMIT 1`,
        [brand],
      );
      if (rows.length && rows[0].email_from_address) {
        return {
          fromEmail: rows[0].email_from_address,
          fromName: rows[0].display_name || brand,
        };
      }
    } catch (err) {
      logger.error({ err }, "email sender lookup failed");
    }
  }
  return {
    fromEmail: config.SMTP_FROM_EMAIL || "noreply@pixiegirlglobal.com",
    fromName: config.SMTP_FROM_NAME || "Pixie Girl Hub",
  };
}

/** Conversational reply address: `sales@<domain-of-from-address>` so customer
 *  replies always reach a monitored, webhook-ingested mailbox. */
function replyToFor(fromEmail) {
  const domain = (fromEmail || "").split("@")[1];
  return domain ? `sales@${domain}` : null;
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
  const t = getTransporter();
  const sender = await getSender(brand);
  const fromEmail = from_email || sender.fromEmail;
  const replyTo = reply_to || replyToFor(fromEmail);

  return t.sendMail({
    to,
    from: `${from_name || sender.fromName} <${fromEmail}>`,
    replyTo: replyTo || undefined,
    subject,
    html,
    text,
    headers,
  });
}

module.exports = { send };
