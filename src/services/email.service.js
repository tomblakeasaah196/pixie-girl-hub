/**
 * Email sender (V2.2 §6.16 — Nodemailer over transactional SMTP, no Klaviyo).
 * Used by: email campaigns, transactional notifications, retention workflows.
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

async function send({
  to,
  subject,
  html,
  text,
  from_email,
  from_name,
  headers,
  brand,
}) {
  const t = getTransporter();
  const sender = await getSender(brand);

  return t.sendMail({
    to,
    from: `${from_name || sender.fromName} <${from_email || sender.fromEmail}>`,
    subject,
    html,
    text,
    headers,
  });
}

module.exports = { send };
