/**
 * outboundDispatcher — the single funnel every automated outbound message
 * flows through. Callers give the automation's event_key + a contact +
 * a variables blob; the dispatcher figures out the channel, renders the
 * templates, and enqueues on the right BullMQ queue.
 *
 * This replaces the six ad-hoc send sites that used to hardcode strings
 * and call whatsapp.sendText / email.send directly (invoice-delivery,
 * receipt-delivery, campaigns.notifications, retention/workflow, and the
 * two schedulers: layaway-reminders + invoice-reminders).
 *
 * The flow:
 *
 *   1. Load the automation row from shared.outbound_channel_policy.
 *      Bail with { skipped:true, reason:'not_configured' } if missing so
 *      the caller can either log or fall back.
 *
 *   2. Respect is_active — a disabled automation is a no-op.
 *
 *   3. Resolve the channel via the existing outbound_policy.resolveChannel
 *      helper. That honours contact preferences and the block_whatsapp
 *      guardrail — so this dispatcher can't send WhatsApp on an event the
 *      CEO has blocked from WhatsApp, even if the caller asked for it.
 *
 *   4. Claim a dedup slot on automation_send_log so re-runs of the same
 *      logical send (same order + same reminder tick, same customer +
 *      same birthday year, …) are a silent no-op.
 *
 *   5. Load the contact's channel address and render the template body
 *      via the shared renderer (block editor → wrapEmail → tokens).
 *
 *   6. Enqueue on email-send / whatsapp-send / instagram-send with the
 *      shapes those processors already expect.
 *
 * Callers pass an optional `dedup_key` that identifies "the same send".
 * When omitted, we build one from event_key + contact_id + variables that
 * feel identifying (order_number, invoice_number, receipt_number). That
 * keeps the API tolerant for the retention path where the dedup shape
 * varies per rule.
 */

"use strict";

const repo = require("./comms-studio.repo");
const renderer = require("./renderer");
const policy = require("../outbound_policy/outbound-policy.service");
const emailRender = require("../email_campaigns/email-render");
const { enqueue } = require("../../jobs/queue");
const { query } = require("../../config/database");
const { logger } = require("../../config/logger");

/**
 * @typedef DispatchResult
 * @property {boolean} dispatched
 * @property {string} [channel]
 * @property {string} [reason]
 * @property {string} [send_id]
 * @property {boolean} [duplicate]
 */

/**
 * @param {object} args
 * @param {string} args.brand           — 'pixiegirl' | 'faitlynhair'
 * @param {string} args.event_key       — automation identifier (e.g. 'layaway_reminder')
 * @param {string} [args.contact_id]    — the customer this is for
 * @param {object} [args.variables]     — {{token}} substitutions
 * @param {string} [args.dedup_key]     — idempotency key; auto-derived if omitted
 * @param {string} [args.reference_type] — for comms_log ('invoice' | 'receipt' | …)
 * @param {string} [args.reference_id]
 * @returns {Promise<DispatchResult>}
 */
async function dispatch({
  brand,
  event_key,
  contact_id = null,
  variables = {},
  dedup_key,
  reference_type,
  reference_id,
}) {
  if (!brand || !event_key) {
    throw new Error("dispatch: brand and event_key are required");
  }

  const automation = await repo.getAutomation({ brand, event_key });
  if (!automation) {
    return { dispatched: false, reason: "not_configured" };
  }
  if (automation.is_active === false) {
    return { dispatched: false, reason: "disabled" };
  }

  const resolved = await policy.resolveChannel({
    brand,
    event_key,
    contact_id,
  });
  const channel = normaliseChannel(resolved.channel);
  if (channel === "disabled") {
    return { dispatched: false, channel: "disabled", reason: resolved.reason };
  }
  if (channel === "in_app_only") {
    return { dispatched: false, channel: "in_app_only", reason: "in_app_only" };
  }

  const contact = contact_id ? await loadContact(contact_id, brand) : null;

  // Layaway-specific cost gate — configured on the automation, not
  // hardcoded in the cron. Reads min_amount_paid_ngn out of cadence_config
  // so the CEO can turn "skip untouched orders" on/off from the Studio.
  const gate = automation.cadence_config || {};
  if (typeof gate.min_amount_paid_ngn === "number") {
    const paid = Number(variables.amount_paid_ngn_raw ?? variables.amount_paid_ngn ?? 0);
    if (paid < gate.min_amount_paid_ngn) {
      return { dispatched: false, reason: "min_amount_paid_ngn_gate" };
    }
  }

  const finalDedup =
    dedup_key ||
    defaultDedupKey({ event_key, contact_id, variables });

  const claim = await repo.claimSend({
    brand,
    event_key,
    contact_id,
    dedup_key: finalDedup,
    channel,
    variables,
  });
  if (!claim) {
    return { dispatched: false, duplicate: true, reason: "already_sent" };
  }

  // Merge in the {{first_name}} / {{brand_name}} niceties the operator
  // most often refers to, unless the caller supplied them explicitly.
  const enriched = await enrichVariables({ brand, contact, variables });

  // Address for each channel, override-first (send-test uses overrides).
  const addressFor = (ch) => {
    if (ch === "email")
      return variables.override_to_email || (contact && contact.email) || null;
    if (ch === "whatsapp")
      return (
        variables.override_to_phone ||
        (contact && (contact.whatsapp_number || contact.primary_phone)) ||
        null
      );
    if (ch === "instagram")
      return (
        variables.override_ig_user_id || (contact && contact.ig_user_id) || null
      );
    return null;
  };
  const NO_ADDRESS = {
    email: "no_email",
    whatsapp: "no_phone",
    instagram: "no_ig_user_id",
  };

  // Address-aware fallback: when the policy-resolved channel has no address
  // on the contact (the classic case: 'order_confirmation' prefers email but
  // a WhatsApp customer never gave one), fall through to the policy's OWN
  // fallback_channel rather than silently skipping — the CEO configured it
  // for exactly this. block_whatsapp stays a hard guardrail.
  // Only an EXPLICITLY configured fallback_channel qualifies — never an
  // invented default (cost discipline: nothing rides WhatsApp unless the
  // CEO picked it for this event).
  const candidates = [channel];
  const fb = automation.fallback_channel || null;
  if (
    fb &&
    fb !== channel &&
    ["email", "whatsapp", "instagram"].includes(fb) &&
    !(fb === "whatsapp" && automation.block_whatsapp)
  ) {
    candidates.push(fb);
  }
  const sendChannel = candidates.find((ch) => addressFor(ch));
  const fellBack = sendChannel ? sendChannel !== channel : false;

  try {
    if (!sendChannel) {
      const reason = NO_ADDRESS[channel] || `no_address:${channel}`;
      await repo.markSendStatus({
        send_id: claim.send_id,
        status: "skipped",
        failure_reason: reason,
      });
      return { dispatched: false, channel, reason };
    }

    if (sendChannel === "email") {
      const to = addressFor("email");
      const brandTokens = await emailRender.resolveBrandTokens(brand);
      const built = renderer.buildEmail({
        automation,
        brandTokens,
        variables: enriched,
      });
      await enqueue("email-send", `automation:${event_key}`, {
        brand,
        to,
        subject: built.subject,
        html: built.html,
        text: built.text,
        contact_id,
        event_key,
        reference_type,
        reference_id,
        // Email-only: a caller (e.g. the order-placement automation) can pass
        // a stored file — {filename, storage_key, content_type} — to attach,
        // most commonly the order's proforma invoice PDF. WhatsApp/Instagram
        // ignore this; those channels carry a link in the body instead.
        attachments: variables.attachments || undefined,
      });
      await repo.markSendStatus({ send_id: claim.send_id, status: "sent" });
      return {
        dispatched: true,
        channel: "email",
        send_id: claim.send_id,
        ...(fellBack ? { fallback: true } : {}),
      };
    }

    if (sendChannel === "whatsapp" || sendChannel === "instagram") {
      // IG falls back to the WhatsApp wording when no IG-specific template
      // was written — most automations are seeded with a WhatsApp body only.
      const body =
        sendChannel === "whatsapp"
          ? renderer.buildWhatsApp({ automation, variables: enriched })
          : renderer.buildInstagram({ automation, variables: enriched }) ||
            renderer.buildWhatsApp({ automation, variables: enriched });
      if (!body || !body.trim()) {
        await repo.markSendStatus({
          send_id: claim.send_id,
          status: "skipped",
          failure_reason: "no_template_body",
        });
        return { dispatched: false, channel: sendChannel, reason: "no_template_body" };
      }

      // Prefer the smartcomm funnel: it records the message on the
      // customer's thread (so the operator SEES the automated send in
      // Messaging, with real delivery status) and enqueues the identical
      // provider job. Overrides (send-test to an arbitrary number) and any
      // funnel failure fall back to the raw enqueue this dispatcher always
      // did, so an automation never dies because the mirror did.
      const hasOverride =
        sendChannel === "whatsapp"
          ? !!variables.override_to_phone
          : !!variables.override_ig_user_id;
      let mirrored = null;
      if (contact_id && !hasOverride) {
        try {
          const smartcomm = require("../smartcomm/smartcomm.service");
          mirrored = await smartcomm.sendToCustomer({
            brand,
            contact_id,
            channel: sendChannel,
            body,
            soft: true,
          });
          if (mirrored && mirrored.skipped) mirrored = null;
        } catch {
          mirrored = null;
        }
      }
      if (!mirrored) {
        if (sendChannel === "whatsapp") {
          await enqueue("whatsapp-send", `automation:${event_key}`, {
            brand,
            to: addressFor("whatsapp"),
            body,
          });
        } else {
          await enqueue("instagram-send", `automation:${event_key}`, {
            brand,
            recipient_id: addressFor("instagram"),
            text: body,
          });
        }
      }
      await repo.markSendStatus({ send_id: claim.send_id, status: "sent" });
      return {
        dispatched: true,
        channel: sendChannel,
        send_id: claim.send_id,
        ...(fellBack ? { fallback: true } : {}),
      };
    }

    await repo.markSendStatus({
      send_id: claim.send_id,
      status: "skipped",
      failure_reason: `unknown_channel:${sendChannel}`,
    });
    return { dispatched: false, channel: sendChannel, reason: "unknown_channel" };
  } catch (err) {
    await repo.markSendStatus({
      send_id: claim.send_id,
      status: "failed",
      failure_reason: (err && err.message) || String(err),
    });
    logger.error(
      { err: err.message, brand, event_key, contact_id },
      "comms_studio: dispatch failed",
    );
    return { dispatched: false, reason: err.message };
  }
}

function normaliseChannel(ch) {
  if (!ch) return "email";
  if (ch === "respect_contact_pref") return "email";
  return ch;
}

/**
 * Build a stable dedup key from what's identifying about the send. Order/
 * invoice/receipt numbers are the natural buckets; birthday_wish uses the
 * year so we get once-per-contact-per-year. When nothing distinguishing is
 * available we fall back to now-in-ms so at least we don't double-charge
 * (though this shape is best paired with a caller-supplied dedup_key).
 */
function defaultDedupKey({ event_key, contact_id, variables }) {
  if (event_key === "birthday_wish") {
    const y = new Date().getUTCFullYear();
    return `birthday-${y}-${contact_id || "anon"}`;
  }
  const salt =
    variables.order_number ||
    variables.invoice_number ||
    variables.receipt_number ||
    variables.job_number ||
    variables.campaign_id ||
    "";
  const bucket = variables.dedup_bucket || variables.reminder_id || Date.now();
  return [event_key, contact_id || "anon", salt, bucket].join(":");
}

async function loadContact(contactId, brand) {
  // IG recipient resolution mirrors smartcomm's outbound rule: IGSIDs are
  // scoped per business account, so the id that opened THIS brand's
  // customer thread (external_thread_ref, stamped by the inbound webhook)
  // is the only one guaranteed deliverable on this brand's token — any
  // other is bounced by Meta as "Invalid message id" (508 / 2534122).
  // Contact-level handle rows are brand-blind (a merged contact carries
  // one per brand plus id-less form-typed rows), so they're a fallback
  // only, preferring rows that actually hold an external id.
  const { rows } = await query(
    `SELECT c.contact_id, c.display_name, c.first_name, c.last_name,
            c.email, c.primary_phone, c.whatsapp_number, c.preferred_channel,
            c.date_of_birth,
            COALESCE(t.external_thread_ref, h.external_user_id) AS ig_user_id
       FROM shared.contacts c
       LEFT JOIN LATERAL (
         SELECT mc.external_thread_ref
           FROM shared.message_channels mc
          WHERE mc.channel_type = 'customer_thread'
            AND mc.external_platform = 'instagram'
            AND mc.business = $2
            AND mc.metadata->>'contact_id' = c.contact_id::text
            AND mc.external_thread_ref IS NOT NULL
          ORDER BY mc.last_message_at DESC NULLS LAST
          LIMIT 1
       ) t ON true
       LEFT JOIN LATERAL (
         SELECT sh.external_user_id
           FROM shared.contact_social_handles sh
          WHERE sh.contact_id = c.contact_id AND sh.platform = 'instagram'
            AND sh.external_user_id IS NOT NULL
          ORDER BY sh.updated_at DESC
          LIMIT 1
       ) h ON true
      WHERE c.contact_id = $1
      LIMIT 1`,
    [contactId, brand || null],
  );
  return rows[0] || null;
}

async function enrichVariables({ brand, contact, variables }) {
  const enriched = { ...(variables || {}) };
  if (contact) {
    if (enriched.first_name === undefined || enriched.first_name === null) {
      enriched.first_name =
        contact.first_name ||
        (contact.display_name ? String(contact.display_name).split(/\s+/)[0] : "") ||
        "there";
    }
    if (enriched.customer_name === undefined || enriched.customer_name === null) {
      enriched.customer_name = contact.display_name || enriched.first_name;
    }
  }
  if (enriched.brand_name === undefined || enriched.brand_name === null) {
    try {
      const tokens = await emailRender.resolveBrandTokens(brand);
      enriched.brand_name = tokens.brand_name;
    } catch {
      // brand token lookup failed; leave brand_name unset — renderStr will
      // collapse the {{token}} to '' rather than surface the failure.
    }
  }
  return enriched;
}

module.exports = { dispatch, defaultDedupKey };
