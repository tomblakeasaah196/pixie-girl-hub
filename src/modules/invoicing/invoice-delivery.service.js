/**
 * Invoice delivery — the part that actually puts the invoice in front of the
 * customer (V2.2 §6.5). The invoicing service flips the invoice to `sent`;
 * THIS module is what makes "sent" true: it renders a branded email (or a
 * WhatsApp note), hands it to the durable queue, and records every attempt on
 * the outbound comms log so the invoice's own detail screen can answer
 * "was it sent, did it land, did she open it?".
 *
 * The customer email carries a secure "View your invoice" link (the invoice id
 * is a UUIDv4 — unguessable). Opening that link stamps `first_viewed_at`, which
 * is the honest "she received it" signal on a plain-SMTP setup (no provider
 * delivered/opened webhooks). WhatsApp read receipts can layer on later.
 *
 * Best-effort by contract: dispatch never throws. A delivery hiccup must not
 * roll back (or appear to fail) the status change the caller already committed —
 * the failure is recorded on the comms log and surfaced in the UI instead.
 */

"use strict";

const T = require("../../services/email-theme");
const emailRender = require("../email_campaigns/email-render");
const commsLog = require("../../services/comms-log.service");
const whatsapp = require("../../services/whatsapp.service");
const { enqueue } = require("../../jobs/queue");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

const EVENT_KEY = "invoice.sent";
const REFERENCE_TYPE = "invoice";

/** Kill-switch for environments that must never reach real customers (staging
 *  against a production data snapshot). Set INVOICE_DISPATCH_DISABLED=true to
 *  exercise the whole flow — status, comms-log, UI — without sending anything. */
function dispatchDisabled() {
  return process.env.INVOICE_DISPATCH_DISABLED === "true";
}

/** Secure customer-facing link that renders the invoice and stamps first view. */
function publicViewUrl(brand, invoiceId) {
  return `${config.APP_URL}/api/public/invoices/${brand}/${invoiceId}/view`;
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

function dayLabel(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("en-NG", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return String(value).slice(0, 10);
  }
}

/** Compose the branded invoice email (reuses the premium skin + brand tokens). */
function buildInvoiceEmail({ brandTokens, invoice, viewUrl }) {
  const brandName = brandTokens.brand_name || "";
  const who = firstName(invoice.contact_name);
  const greeting = who ? `Hello ${T.esc(who)},` : "Hello,";
  const balance = Number(invoice.balance_due_ngn ?? invoice.total_ngn ?? 0);
  const settled = balance <= 0;
  const due = dayLabel(invoice.due_date);

  const content = [
    T.eyebrow("YOUR INVOICE"),
    T.heading(`Invoice ${T.esc(invoice.invoice_number || "")}`),
    T.paragraph(greeting),
    T.paragraph(
      settled
        ? `Thank you — here is invoice <strong>${T.esc(invoice.invoice_number || "")}</strong> for your records. Nothing further is owed.`
        : `Please find invoice <strong>${T.esc(invoice.invoice_number || "")}</strong> for <strong>${ngn(balance)}</strong>${due ? `, due by <strong>${T.esc(due)}</strong>` : ""}.`,
    ),
    T.spacer(8),
    T.button("View your invoice", viewUrl, { accent: brandTokens.brand_color }),
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
      preheader: settled
        ? `Invoice ${invoice.invoice_number || ""} from ${brandName}`
        : `Invoice ${invoice.invoice_number || ""} — ${ngn(balance)} due`,
      content,
    }),
    brandTokens,
  );

  return {
    subject: settled
      ? `Invoice ${invoice.invoice_number || ""} from ${brandName}`
      : `Invoice ${invoice.invoice_number || ""} — ${ngn(balance)} due`,
    html,
    text: T.toPlainText(html),
  };
}

/** Plain-text WhatsApp note with the same secure view link. */
function buildInvoiceWhatsApp({ brandTokens, invoice, viewUrl }) {
  const brandName = brandTokens.brand_name || "";
  const balance = Number(invoice.balance_due_ngn ?? invoice.total_ngn ?? 0);
  const due = dayLabel(invoice.due_date);
  const lines = [
    `*${brandName}*`,
    "",
    `Invoice ${invoice.invoice_number || ""}${balance > 0 ? ` — ${ngn(balance)} due${due ? ` by ${due}` : ""}` : ""}.`,
    "",
    `View it here: ${viewUrl}`,
  ];
  return lines.join("\n");
}

/**
 * Put the invoice in front of the customer over the chosen channel. Records the
 * attempt on the comms log (a `queued` row up front, then the email-send
 * processor stamps sent/failed; WhatsApp is stamped inline). Never throws.
 *
 * @param {object} a
 * @param {string} a.brand
 * @param {object} a.invoice   invoice row (incl. invoice_number, totals, due,
 *                             contact_id, contact_name/email/phone)
 * @param {string} [a.channel] email | whatsapp (sms/print/none → not dispatched)
 * @returns {Promise<{dispatched: boolean, channel: string, reason?: string}>}
 */
async function dispatchInvoice({ brand, invoice, channel = "email" }) {
  // Only email/WhatsApp are auto-delivered. print/sms/instagram_dm/none record
  // the operator's send action (status + sent_at) but have no electronic
  // dispatch here — emailing a "Print" invoice would be wrong.
  if (channel !== "email" && channel !== "whatsapp") {
    return { dispatched: false, channel, reason: "channel not auto-delivered" };
  }
  const ch = channel;
  const viewUrl = publicViewUrl(brand, invoice.invoice_id);

  try {
    const brandTokens = await emailRender.resolveBrandTokens(brand);

    if (ch === "whatsapp") {
      const to = invoice.contact_phone;
      if (!to) {
        return notDispatched({ brand, invoice, channel: ch, reason: "no phone number on file" });
      }
      if (dispatchDisabled()) {
        await record({ brand, invoice, channel: ch, recipient: to, status: "queued" });
        return { dispatched: false, channel: ch, reason: "dispatch disabled" };
      }
      const body = buildInvoiceWhatsApp({ brandTokens, invoice, viewUrl });
      try {
        const res = await whatsapp.sendText({ to, body });
        await record({
          brand,
          invoice,
          channel: ch,
          recipient: to,
          status: "sent",
          provider_ref: res && (res.messages?.[0]?.id || res.message_id),
        });
        return { dispatched: true, channel: ch };
      } catch (err) {
        await record({ brand, invoice, channel: ch, recipient: to, status: "failed", error: err.message });
        logger.warn({ err: err.message, invoice_id: invoice.invoice_id, brand }, "invoice WhatsApp dispatch failed");
        return { dispatched: false, channel: ch, reason: err.message };
      }
    }

    // Email (default).
    const to = invoice.contact_email;
    if (!to) {
      return notDispatched({ brand, invoice, channel: ch, reason: "no email address on file" });
    }
    const { subject, html, text } = buildInvoiceEmail({ brandTokens, invoice, viewUrl });

    if (dispatchDisabled()) {
      await record({ brand, invoice, channel: ch, recipient: to, subject, status: "queued" });
      return { dispatched: false, channel: ch, reason: "dispatch disabled" };
    }

    // Record the attempt up front so the UI shows it even before the worker
    // runs; the email-send processor appends the terminal sent/failed row.
    await record({ brand, invoice, channel: ch, recipient: to, subject, status: "queued" });
    await enqueue("email-send", "invoice-send", {
      brand,
      to,
      subject,
      html,
      text,
      contact_id: invoice.contact_id,
      event_key: EVENT_KEY,
      reference_type: REFERENCE_TYPE,
      reference_id: invoice.invoice_id,
    });
    return { dispatched: true, channel: ch };
  } catch (err) {
    logger.warn(
      { err: err.message, invoice_id: invoice.invoice_id, brand },
      "invoice dispatch failed",
    );
    return { dispatched: false, channel: ch, reason: err.message };
  }
}

function notDispatched({ brand, invoice, channel, reason }) {
  record({ brand, invoice, channel, recipient: null, status: "failed", error: reason }).catch(() => {});
  return { dispatched: false, channel, reason };
}

function record({ brand, invoice, channel, recipient, subject, status, provider_ref, error }) {
  return commsLog.record({
    business: brand,
    contact_id: invoice.contact_id,
    channel,
    event_key: EVENT_KEY,
    recipient,
    subject,
    status,
    provider_ref,
    error,
    reference_type: REFERENCE_TYPE,
    reference_id: invoice.invoice_id,
  });
}

module.exports = {
  dispatchInvoice,
  publicViewUrl,
  buildInvoiceEmail,
  EVENT_KEY,
  REFERENCE_TYPE,
};
