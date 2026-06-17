/**
 * Smartcomm subscribers — durable event-driven side effects.
 *
 * Registers two consumers of the transactional outbox:
 *
 *   1. sales.order.payment_reminder → WhatsApp dispatch (G-4). The
 *      layaway gentle reminder lands in the customer's thread plus
 *      goes out over the customer's preferred channel.
 *
 *   2. webhook.received → ingest meta_whatsapp / meta_instagram /
 *      cloudflare_email payloads into the right brand's inbox. The
 *      webhook_log row is fetched, parsed by source, the contact is
 *      resolved (or created as a lead with priority='new'), and the
 *      message is recorded on a customer_thread. Idempotent on the
 *      provider's external_ref so re-delivery is safe.
 *
 * All consumers are registered exactly once (idempotent guard).
 */

"use strict";

const salesEvents = require("../sales/sales.events");
const service = require("./smartcomm.service");
const repo = require("./smartcomm.repo");
const outbox = require("../../shared/outbox/outbox");
const webhookRepo = require("../business_setup/webhooks.repo");
const { logger } = require("../../config/logger");
const { transaction } = require("../../config/database");
const brandUrls = require("../../utils/brand-urls");

let registered = false;

// ── G-4: layaway reminder over WhatsApp ──────────────────────────

function registerSalesReminder() {
  salesEvents.on(
    "order.payment_reminder",
    async ({
      brand,
      contact_id,
      order_number,
      total_ngn,
      amount_paid_ngn,
      balance_due_ngn,
      public_tracking_token,
    }) => {
      if (!contact_id) return;
      const link = await brandUrls.payLinkUrl(brand, public_tracking_token);
      const body =
        `Hi! You've paid ₦${amount_paid_ngn || 0} of ₦${total_ngn} on order ` +
        `${order_number} (₦${balance_due_ngn} left). Pay any amount${
          link ? `: ${link}` : " anytime"
        }.`;
      try {
        await service.sendToCustomer({
          brand,
          contact_id,
          // Let the outbound channel policy decide. Default seed is
          // 'whatsapp' for layaway_reminder because the recovery rate
          // justifies the ₦11 per send — but the CEO can flip it in
          // Business Setup → Channel Policy without a code change.
          event_key: "layaway_reminder",
          body,
          soft: true,
        });
      } catch (err) {
        logger.error(
          { err: err.message, brand, order_number },
          "smartcomm: layaway reminder dispatch failed",
        );
      }
    },
  );
}

// ── webhook.received → inbox routing ─────────────────────────────

const META_WA_PLATFORM = "whatsapp";
const META_IG_PLATFORM = "instagram";
const EMAIL_PLATFORM = "email";

/**
 * Resolve which brand owns an inbound provider account. Defaults to
 * the first business in shared.business_config if no messaging_accounts
 * row exists yet (single-tenant fallback so dev still works).
 */
async function resolveBrand({ platform, external_account_id }) {
  const account = await repo.findMessagingAccount({
    platform,
    external_account_id,
  });
  return account ? account.business : null;
}

/**
 * Parse a Meta WhatsApp payload into our normalised events. Returns
 * an array of { brand, platform, external_account_id, external_ref,
 * external_thread_ref, sender (phone, name), body, message_type,
 * attachment_url }.
 */
function parseMetaWhatsApp(payload) {
  const events = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const externalAccountId =
        value.metadata && value.metadata.phone_number_id;
      const contacts = value.contacts || [];
      for (const m of value.messages || []) {
        const c = contacts.find((x) => x.wa_id === m.from) || {};
        events.push({
          platform: META_WA_PLATFORM,
          external_account_id: externalAccountId,
          external_ref: m.id,
          external_thread_ref: m.from, // WA threads are per-customer-number
          sender: {
            phone: m.from,
            display_name: (c.profile && c.profile.name) || null,
            external_user_id: c.wa_id || m.from,
          },
          body:
            (m.text && m.text.body) ||
            (m.image && m.image.caption) ||
            (m.document && m.document.caption) ||
            "",
          message_type: m.type === "text" ? "text" : m.type || "text",
        });
      }
    }
  }
  return events;
}

/**
 * Parse a Meta Instagram Messenger payload. Each entry is a page; each
 * `messaging` row is a single DM either from a user or an echo of one
 * we sent. We ignore echoes (is_echo) because we record those at send
 * time.
 */
function parseMetaInstagram(payload) {
  const events = [];
  for (const entry of payload.entry || []) {
    // The Instagram Business Account ID is the entry id for IG.
    const externalAccountId = entry.id;
    for (const m of entry.messaging || []) {
      const msg = m.message || {};
      if (msg.is_echo) continue;
      events.push({
        platform: META_IG_PLATFORM,
        external_account_id: externalAccountId,
        external_ref: msg.mid,
        external_thread_ref: m.sender && m.sender.id, // IGSID = thread
        sender: {
          external_user_id: m.sender && m.sender.id,
          display_name: null,
        },
        body: msg.text || "",
        message_type: msg.text ? "text" : "text",
      });
    }
  }
  return events;
}

/**
 * Parse a Cloudflare Email Worker payload. Expected shape:
 *   { to, from, subject, text, html, message_id, in_reply_to,
 *     thread_id, attachments? }
 */
function parseCloudflareEmail(payload) {
  if (!payload || !payload.to || !payload.from) return [];
  const to = String(payload.to).toLowerCase();
  const fromEmail = (payload.from.email || payload.from || "")
    .toString()
    .toLowerCase();
  return [
    {
      platform: EMAIL_PLATFORM,
      external_account_id: to,
      external_ref: payload.message_id || null,
      external_thread_ref:
        payload.thread_id || payload.in_reply_to || payload.message_id,
      sender: {
        email: fromEmail,
        display_name: payload.from.name || null,
      },
      body: payload.text || (payload.html ? stripHtml(payload.html) : ""),
      message_type: "text",
      subject: payload.subject || null,
      in_reply_to: payload.in_reply_to || null,
    },
  ];
}

function stripHtml(html) {
  // Conservative — strip tags only; full sanitisation happens when we
  // render the message back to staff (XSS).
  return String(html).replace(/<[^>]+>/g, "").trim();
}

/**
 * Match the inbound sender to a contact, creating a lead-priority
 * contact if no match. Always returns { contact_id, was_created }.
 */
async function resolveOrCreateContact({ client, brand, platform, sender }) {
  // Try platform-stable id first (most reliable).
  if (sender.external_user_id) {
    const c = await repo.findContactBySocialHandle({
      client,
      platform,
      external_user_id: sender.external_user_id,
    });
    if (c) return { contact: c, was_created: false };
  }
  // Then natural keys (phone for WA, email for inbound mail).
  if (sender.phone) {
    const c = await repo.findContactByPhone({ client, phone: sender.phone });
    if (c) {
      await repo.upsertSocialHandle({
        client,
        h: {
          contact_id: c.contact_id,
          platform,
          handle: sender.phone,
          external_user_id: sender.external_user_id || sender.phone,
          display_name: sender.display_name,
        },
      });
      return { contact: c, was_created: false };
    }
  }
  if (sender.email) {
    const c = await repo.findContactByEmail({ client, email: sender.email });
    if (c) {
      await repo.upsertSocialHandle({
        client,
        h: {
          contact_id: c.contact_id,
          platform,
          handle: sender.email,
          external_user_id: sender.external_user_id || sender.email,
          display_name: sender.display_name,
        },
      });
      return { contact: c, was_created: false };
    }
  }
  // No match — create a lead.
  const sourceTag =
    platform === META_IG_PLATFORM
      ? "instagram_dm"
      : platform === META_WA_PLATFORM
        ? "whatsapp"
        : platform === EMAIL_PLATFORM
          ? "email"
          : "social_media";
  const created = await repo.createLeadContact({
    client,
    c: {
      display_name: sender.display_name || sender.phone || sender.email || "New contact",
      first_name: (sender.display_name || "").split(" ")[0] || null,
      last_name: (sender.display_name || "").split(" ").slice(1).join(" ") || null,
      primary_phone: sender.phone || null,
      whatsapp_number: platform === META_WA_PLATFORM ? sender.phone : null,
      email: sender.email || null,
      source: sourceTag,
      visible_to: brand ? [brand] : [],
    },
  });
  await repo.upsertSocialHandle({
    client,
    h: {
      contact_id: created.contact_id,
      platform,
      handle: sender.phone || sender.email || sender.external_user_id,
      external_user_id: sender.external_user_id || sender.phone || sender.email,
      display_name: sender.display_name,
    },
  });
  return { contact: created, was_created: true };
}

async function ingestInbound(evt) {
  const brand = await resolveBrand({
    platform: evt.platform,
    external_account_id: evt.external_account_id,
  });
  if (!brand) {
    logger.warn(
      {
        platform: evt.platform,
        external_account_id: evt.external_account_id,
      },
      "smartcomm: no messaging_accounts row — message dropped",
    );
    return;
  }
  await transaction(async (client) => {
    const { contact } = await resolveOrCreateContact({
      client,
      brand,
      platform: evt.platform,
      sender: evt.sender,
    });
    await service.recordInboundFromCustomer({
      brand,
      contact_id: contact.contact_id,
      platform: evt.platform,
      body: evt.body,
      message_type: evt.message_type,
      external_ref: evt.external_ref,
      external_thread_ref: evt.external_thread_ref,
      metadata: evt.subject
        ? { subject: evt.subject, in_reply_to: evt.in_reply_to }
        : undefined,
    });
  });
}

async function onWebhookReceived({ webhook_id, source }) {
  // The smartcomm handler only cares about the inbox sources.
  if (
    source !== "meta_whatsapp" &&
    source !== "meta_instagram" &&
    source !== "cloudflare_email"
  )
    return;
  const log = await webhookRepo.findById(webhook_id);
  if (!log) return;
  if (!log.signature_valid) return; // never process unverified
  const payload = log.payload || {};
  let events = [];
  try {
    if (source === "meta_whatsapp") events = parseMetaWhatsApp(payload);
    else if (source === "meta_instagram") events = parseMetaInstagram(payload);
    else if (source === "cloudflare_email") events = parseCloudflareEmail(payload);
  } catch (err) {
    logger.error(
      { err: err.message, source, webhook_id },
      "smartcomm: webhook parse failed",
    );
    return;
  }
  for (const evt of events) {
    try {
      await ingestInbound(evt);
    } catch (err) {
      logger.error(
        {
          err: err.message,
          source,
          webhook_id,
          platform: evt.platform,
          external_ref: evt.external_ref,
        },
        "smartcomm: webhook ingest failed",
      );
      throw err; // let outbox retry the whole batch
    }
  }
}

function register() {
  if (registered) return;
  registered = true;
  registerSalesReminder();
  outbox.register(
    "webhook.received",
    "smartcomm-ingest",
    onWebhookReceived,
  );
  logger.info(
    "smartcomm subscribers registered (sales.payment_reminder, webhook.received)",
  );
}

register();

module.exports = {
  register,
  // exported for tests
  parseMetaWhatsApp,
  parseMetaInstagram,
  parseCloudflareEmail,
  resolveOrCreateContact,
  onWebhookReceived,
};
