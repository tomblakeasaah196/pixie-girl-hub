/**
 * Smartcomm subscribers — durable event-driven side effects.
 *
 * Registers one consumer of the transactional outbox:
 *
 *   webhook.received → ingest meta_whatsapp / meta_instagram /
 *   cloudflare_email payloads into the right brand's inbox. The
 *   webhook_log row is fetched, parsed by source, the contact is
 *   resolved (or created as a lead with priority='new'), and the
 *   message is recorded on a customer_thread. Idempotent on the
 *   provider's external_ref so re-delivery is safe.
 *
 * The layaway reminder listener that used to live here (sales.order.
 * payment_reminder → WhatsApp send with a hardcoded body) has moved:
 * layaway-reminders.js now calls the Communications Studio dispatcher
 * directly, which reads the layaway_reminder automation row for the
 * channel, subject, body, and the "skip untouched orders" gate. The
 * CEO edits it from the Comms Studio UI — no more hardcoded strings.
 *
 * The consumer is registered exactly once (idempotent guard).
 */

"use strict";

const service = require("./smartcomm.service");
const repo = require("./smartcomm.repo");
const outbox = require("../../shared/outbox/outbox");
const webhookRepo = require("../business_setup/webhooks.repo");
const { logger } = require("../../config/logger");
const { transaction } = require("../../config/database");

let registered = false;

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
 * Parse the delivery-status callbacks Meta sends alongside (or instead
 * of) inbound messages on the WhatsApp webhook: `value.statuses[]`,
 * each `{ id, status: sent|delivered|read|failed, recipient_id,
 * errors? }`. `id` is the provider message id we stamped onto
 * `shared.messages.external_ref` at send time.
 */
function parseMetaWhatsAppStatuses(payload) {
  const statuses = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const s of value.statuses || []) {
        statuses.push({
          external_ref: s.id,
          status: s.status,
          error:
            (Array.isArray(s.errors) && s.errors[0] && s.errors[0].title) ||
            null,
        });
      }
    }
  }
  return statuses;
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
      const senderId = m.sender && m.sender.id;

      // Meta signals story mentions + story replies through the
      // `attachments[]` array on a normal messaging event:
      //   attachments[0].type === 'story_mention' | 'share'
      //   attachments[0].payload.url  — the story media URL
      //   msg.reply_to.story          — the story we're being replied
      //                                 to (present on reply-to-story)
      // Route them into the inbox as first-class events so the
      // operator sees them alongside DMs.
      const att = Array.isArray(msg.attachments) ? msg.attachments[0] : null;
      const isStoryMention = att && att.type === "story_mention";
      const isStoryReply = !!(msg.reply_to && msg.reply_to.story);

      const messageType = isStoryMention
        ? "ig_story_mention"
        : isStoryReply
          ? "ig_story_reply"
          : "text";

      // Metadata carries the story URL + id so the UI can render a
      // preview card. The service whitelists card metadata by
      // message_type so this stays safe.
      const metadata = {};
      if (isStoryMention) {
        metadata.story_url = att.payload && att.payload.url;
      }
      if (isStoryReply) {
        metadata.story_id = msg.reply_to.story.id;
        metadata.story_url = msg.reply_to.story.url;
      }

      events.push({
        platform: META_IG_PLATFORM,
        external_account_id: externalAccountId,
        external_ref: msg.mid,
        external_thread_ref: senderId, // IGSID = thread
        sender: {
          external_user_id: senderId,
          display_name: null,
        },
        body:
          msg.text ||
          (isStoryMention ? "(mentioned you in a story)" : "") ||
          (isStoryReply ? "(replied to your story)" : ""),
        message_type: messageType,
        metadata: Object.keys(metadata).length ? metadata : undefined,
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
  return String(html)
    .replace(/<[^>]+>/g, "")
    .trim();
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
      display_name:
        sender.display_name || sender.phone || sender.email || "New contact",
      first_name: (sender.display_name || "").split(" ")[0] || null,
      last_name:
        (sender.display_name || "").split(" ").slice(1).join(" ") || null,
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
  // The contact must be COMMITTED before recordInboundFromCustomer runs:
  // that call opens its own transaction on a different pool connection, so
  // a contact created inside a still-open wrapper transaction is invisible
  // to its channel_members FK check — every inbound from a brand-new sender
  // failed with channel_members_contact_id_fkey and the rollback erased the
  // contact, so outbox retries repeated the identical failure. Both steps
  // are idempotent (find-first contact match, external_ref message dedup),
  // so at-least-once redelivery between them is safe.
  const { contact } = await transaction(async (client) =>
    resolveOrCreateContact({
      client,
      brand,
      platform: evt.platform,
      sender: evt.sender,
    }),
  );
  // Merge parser-supplied metadata (story mentions/replies carry
  // story_url/story_id) with email's subject/in_reply_to bits.
  let metadata;
  if (evt.metadata) metadata = { ...evt.metadata };
  if (evt.subject) {
    metadata = metadata || {};
    metadata.subject = evt.subject;
    metadata.in_reply_to = evt.in_reply_to;
  }
  await service.recordInboundFromCustomer({
    brand,
    contact_id: contact.contact_id,
    platform: evt.platform,
    body: evt.body,
    message_type: evt.message_type,
    external_ref: evt.external_ref,
    external_thread_ref: evt.external_thread_ref,
    metadata,
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
  let statuses = [];
  try {
    if (source === "meta_whatsapp") {
      events = parseMetaWhatsApp(payload);
      statuses = parseMetaWhatsAppStatuses(payload);
    } else if (source === "meta_instagram") events = parseMetaInstagram(payload);
    else if (source === "cloudflare_email")
      events = parseCloudflareEmail(payload);
  } catch (err) {
    logger.error(
      { err: err.message, source, webhook_id },
      "smartcomm: webhook parse failed",
    );
    return;
  }
  for (const st of statuses) {
    try {
      await service.applyProviderStatus(st);
    } catch (err) {
      logger.error(
        { err: err.message, source, webhook_id, external_ref: st.external_ref },
        "smartcomm: delivery-status webhook apply failed",
      );
      throw err; // let outbox retry the whole batch
    }
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
  outbox.register("webhook.received", "smartcomm-ingest", onWebhookReceived);
  logger.info("smartcomm subscribers registered (webhook.received)");
}

register();

module.exports = {
  register,
  // exported for tests
  parseMetaWhatsApp,
  parseMetaWhatsAppStatuses,
  parseMetaInstagram,
  parseCloudflareEmail,
  resolveOrCreateContact,
  onWebhookReceived,
};
