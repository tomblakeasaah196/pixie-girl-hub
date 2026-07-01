/**
 * Receipt delivery — puts the proof-of-payment receipt in front of the customer
 * (V2.2 §6.5), the receipt counterpart to invoice-delivery.service. Renders a
 * branded email (or a WhatsApp note) carrying a secure "View receipt" link and
 * logs every attempt on the comms ledger so a receipt's send history answers
 * "was it sent, did she open it?".
 *
 * Receipts have no `first_viewed_at` column, so the "opened" signal is recorded
 * on the comms log (guarded to once by the caller) rather than on the row.
 *
 * Best-effort by contract: dispatch never throws — a delivery hiccup must not
 * roll back the send the caller already committed.
 */

"use strict";

const T = require("../../services/email-theme");
const emailRender = require("../email_campaigns/email-render");
const commsLog = require("../../services/comms-log.service");
const whatsapp = require("../../services/whatsapp.service");
const { enqueue } = require("../../jobs/queue");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

const EVENT_KEY = "receipt.sent";
const REFERENCE_TYPE = "receipt";

/** Mirror of the invoice kill-switch — disable real dispatch in unsafe envs. */
function dispatchDisabled() {
  return process.env.INVOICE_DISPATCH_DISABLED === "true";
}

function publicViewUrl(brand, receiptId) {
  return `${config.APP_URL}/api/public/receipts/${brand}/${receiptId}/view`;
}

function ngn(value) {
  const n = Number(value || 0);
  return (
    "₦" +
    (Number.isFinite(n) ? n : 0).toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

/** Compose the branded receipt email (premium skin + brand tokens). */
function buildReceiptEmail({ brandTokens, receipt, viewUrl }) {
  const brandName = brandTokens.brand_name || "";
  const who = firstName(receipt.contact_name);
  const greeting = who ? `Hello ${T.esc(who)},` : "Hello,";
  const amount = ngn(receipt.amount_ngn);

  const content = [
    T.eyebrow("PAYMENT RECEIVED"),
    T.heading(`Receipt ${T.esc(receipt.receipt_number || "")}`),
    T.paragraph(greeting),
    T.paragraph(
      `Thank you — we've received your payment of <strong>${amount}</strong>${receipt.invoice_number ? ` for invoice <strong>${T.esc(receipt.invoice_number)}</strong>` : ""}. This receipt is for your records.`,
    ),
    T.spacer(8),
    T.button("View your receipt", viewUrl, { accent: brandTokens.brand_color }),
    T.spacer(8),
    T.paragraph(
      `If the button doesn't work, copy this link into your browser:<br/><a href="${viewUrl}" style="color:${brandTokens.brand_color};">${viewUrl}</a>`,
      { muted: true },
    ),
    T.divider(),
    T.paragraph(`Warm regards,<br/>The ${T.esc(brandName)} team`, {
      muted: true,
    }),
    T.spacer(16),
  ].join("");

  const html = emailRender.renderStr(
    T.wrapEmail({
      preheader: `Receipt ${receipt.receipt_number || ""} — ${amount} received`,
      content,
    }),
    brandTokens,
  );

  return {
    subject: `Receipt ${receipt.receipt_number || ""} from ${brandName}`,
    html,
    text: T.toPlainText(html),
  };
}

/** Plain-text WhatsApp note with the same secure view link. */
function buildReceiptWhatsApp({ brandTokens, receipt, viewUrl }) {
  const brandName = brandTokens.brand_name || "";
  const lines = [
    `*${brandName}*`,
    "",
    `Receipt ${receipt.receipt_number || ""} — payment of ${ngn(receipt.amount_ngn)} received${receipt.invoice_number ? ` for invoice ${receipt.invoice_number}` : ""}.`,
    "",
    `View it here: ${viewUrl}`,
  ];
  return lines.join("\n");
}

/**
 * Deliver the receipt over the chosen channel and record the attempt. Mirrors
 * dispatchInvoice: email goes through the durable email-send queue (which
 * stamps sent/failed on the comms log); WhatsApp is sent and stamped inline.
 * Never throws.
 */
async function dispatchReceipt({ brand, receipt, channel = "email" }) {
  if (channel !== "email" && channel !== "whatsapp") {
    return { dispatched: false, channel, reason: "channel not auto-delivered" };
  }
  const ch = channel;
  const viewUrl = publicViewUrl(brand, receipt.receipt_id);

  try {
    const brandTokens = await emailRender.resolveBrandTokens(brand);

    if (ch === "whatsapp") {
      const to = receipt.contact_phone;
      if (!to) return notDispatched({ brand, receipt, channel: ch, reason: "no phone number on file" });
      if (dispatchDisabled()) {
        await record({ brand, receipt, channel: ch, recipient: to, status: "queued" });
        return { dispatched: false, channel: ch, reason: "dispatch disabled" };
      }
      const body = buildReceiptWhatsApp({ brandTokens, receipt, viewUrl });
      try {
        const res = await whatsapp.sendText({ to, body });
        await record({
          brand,
          receipt,
          channel: ch,
          recipient: to,
          status: "sent",
          provider_ref: res && (res.messages?.[0]?.id || res.message_id),
        });
        return { dispatched: true, channel: ch };
      } catch (err) {
        await record({ brand, receipt, channel: ch, recipient: to, status: "failed", error: err.message });
        logger.warn({ err: err.message, receipt_id: receipt.receipt_id, brand }, "receipt WhatsApp dispatch failed");
        return { dispatched: false, channel: ch, reason: err.message };
      }
    }

    const to = receipt.contact_email;
    if (!to) return notDispatched({ brand, receipt, channel: ch, reason: "no email address on file" });
    const { subject, html, text } = buildReceiptEmail({ brandTokens, receipt, viewUrl });

    if (dispatchDisabled()) {
      await record({ brand, receipt, channel: ch, recipient: to, subject, status: "queued" });
      return { dispatched: false, channel: ch, reason: "dispatch disabled" };
    }

    await record({ brand, receipt, channel: ch, recipient: to, subject, status: "queued" });
    await enqueue("email-send", "receipt-send", {
      brand,
      to,
      subject,
      html,
      text,
      contact_id: receipt.contact_id,
      event_key: EVENT_KEY,
      reference_type: REFERENCE_TYPE,
      reference_id: receipt.receipt_id,
    });
    return { dispatched: true, channel: ch };
  } catch (err) {
    logger.warn({ err: err.message, receipt_id: receipt.receipt_id, brand }, "receipt dispatch failed");
    return { dispatched: false, channel: ch, reason: err.message };
  }
}

function notDispatched({ brand, receipt, channel, reason }) {
  record({ brand, receipt, channel, recipient: null, status: "failed", error: reason }).catch(() => {});
  return { dispatched: false, channel, reason };
}

function record({ brand, receipt, channel, recipient, subject, status, provider_ref, error }) {
  return commsLog.record({
    business: brand,
    contact_id: receipt.contact_id,
    channel,
    event_key: EVENT_KEY,
    recipient,
    subject,
    status,
    provider_ref,
    error,
    reference_type: REFERENCE_TYPE,
    reference_id: receipt.receipt_id,
  });
}

module.exports = {
  dispatchReceipt,
  publicViewUrl,
  buildReceiptEmail,
  EVENT_KEY,
  REFERENCE_TYPE,
};
