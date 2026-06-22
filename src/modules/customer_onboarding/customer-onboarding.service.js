/**
 * Customer Onboarding — business logic.
 *
 * Two surfaces:
 *
 *   1. Staff "Send Online QR" — generate a token (32-byte URL-safe),
 *      bound to a brand and (optionally) a channel_id. The link goes
 *      out as a chat message: "Hi {name}, here's a quick form so we
 *      can deliver to you: {STOREFRONT}/welcome/{biz}/{token}".
 *
 *   2. Customer submit — receives the validated payload, finds or
 *      creates the matching contact, upserts the IG/WA handles, sets
 *      the default delivery address, and (if the link was bound to a
 *      channel) attaches the contact back to that thread so the
 *      staffer sees a "form completed" chip.
 */

"use strict";

const crypto = require("crypto");
const repo = require("./customer-onboarding.repo");
const smartcommRepo = require("../smartcomm/smartcomm.repo");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { AppError, NotFoundError } = require("../../utils/errors");
const { logger } = require("../../config/logger");
const brandUrls = require("../../utils/brand-urls");

// ── Helpers ───────────────────────────────────────────────

function newToken() {
  // 32 bytes → 43 base64url chars. Probability of collision is
  // astronomically low; we still enforce a UNIQUE index in DB.
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * A birthday's month + day → a DATE anchored to a leap year (1904) so 29 Feb
 * stays valid; only the month/day matter for reminders. The form collects the
 * day they celebrate, not the year. Returns null unless BOTH parts are given.
 */
function dobFromParts(month, day) {
  if (!month || !day) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `1904-${mm}-${dd}`;
}

// Per-brand domain via business_config.storefront_domain — see
// src/utils/brand-urls.js. Falls back to STOREFRONT_BASE_URL env var
// when a brand hasn't configured its public domain yet.
function publicLink({ business, token }) {
  return brandUrls.welcomeUrl(business, token);
}

// ── Staff: generate a link ────────────────────────────────

async function createLink({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const link = await repo.createLink({
      client,
      link: {
        token: newToken(),
        business: input.business || brand,
        channel_id: input.channel_id,
        seed_payload: input.seed_payload,
        source: input.source,
        created_by: user.user_id,
      },
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "customer_onboarding.link.create",
      target_type: "onboarding_link",
      target_id: link.submission_id,
      after: { channel_id: input.channel_id || null },
      request_id,
    });
    const url = await publicLink({
      business: link.business,
      token: link.token,
    });
    return {
      submission_id: link.submission_id,
      token: link.token,
      url,
      expires_at: link.expires_at,
    };
  });
}

// ── Customer: render the form (public) ────────────────────

async function getPublic({ token }) {
  const link = await repo.findByToken({ token });
  if (!link) throw new NotFoundError("Form");
  if (link.completed_at)
    throw new AppError(
      "ONBOARDING_ALREADY_SUBMITTED",
      "This form has already been filled in. Thanks!",
      410,
    );
  if (link.expires_at && new Date(link.expires_at) < new Date())
    throw new AppError(
      "ONBOARDING_EXPIRED",
      "This form link has expired. Please ask us for a fresh one.",
      410,
    );
  // Pre-fill what we already know — staff can pass a seed_payload
  // when generating the link. Never leak adjacent contact data.
  return {
    business: link.business,
    seed: link.seed_payload || {},
  };
}

// ── Customer: submit (public) ─────────────────────────────

async function submitPublic({ token, ip, payload }) {
  const link = await repo.findByToken({ token });
  if (!link) throw new NotFoundError("Form");
  if (link.completed_at)
    throw new AppError(
      "ONBOARDING_ALREADY_SUBMITTED",
      "This form has already been filled in.",
      410,
    );
  if (link.expires_at && new Date(link.expires_at) < new Date())
    throw new AppError("ONBOARDING_EXPIRED", "This form has expired.", 410);

  return transaction(async (client) => {
    // Birthday: the form sends month + day (no year); fall back to an explicit
    // date_of_birth if one was supplied. Either way it reaches the contact now
    // (previously dob_day/dob_month were validated then silently dropped).
    const date_of_birth =
      payload.date_of_birth || dobFromParts(payload.dob_month, payload.dob_day);

    // Resolve contact by phone → wa → email → IG. Fall through to
    // creating a fresh lead-priority contact if no match.
    let contact = null;
    if (payload.primary_phone) {
      contact = await smartcommRepo.findContactByPhone({
        client,
        phone: payload.primary_phone,
      });
    }
    if (!contact && payload.whatsapp_number) {
      contact = await smartcommRepo.findContactByPhone({
        client,
        phone: payload.whatsapp_number,
      });
    }
    if (!contact && payload.email) {
      contact = await smartcommRepo.findContactByEmail({
        client,
        email: payload.email,
      });
    }
    if (!contact && payload.instagram_user_id) {
      contact = await smartcommRepo.findContactBySocialHandle({
        client,
        platform: "instagram",
        external_user_id: payload.instagram_user_id,
      });
    }
    if (!contact) {
      contact = await smartcommRepo.createLeadContact({
        client,
        c: {
          display_name:
            payload.display_name ||
            `${payload.first_name} ${payload.last_name || ""}`.trim(),
          first_name: payload.first_name,
          last_name: payload.last_name,
          primary_phone: payload.primary_phone,
          whatsapp_number: payload.whatsapp_number,
          email: payload.email,
          date_of_birth,
          source: "online_form",
          visible_to: [link.business],
        },
      });
    } else {
      await repo.updateContactFromPayload({
        client,
        contact_id: contact.contact_id,
        p: {
          first_name: payload.first_name,
          last_name: payload.last_name,
          display_name: payload.display_name,
          email: payload.email,
          primary_phone: payload.primary_phone,
          whatsapp_number: payload.whatsapp_number,
          date_of_birth: date_of_birth || null,
        },
      });
    }

    // Multi-platform handles.
    if (payload.instagram_handle || payload.instagram_user_id) {
      await smartcommRepo.upsertSocialHandle({
        client,
        h: {
          contact_id: contact.contact_id,
          platform: "instagram",
          handle: payload.instagram_handle,
          external_user_id:
            payload.instagram_user_id || payload.instagram_handle,
          display_name: payload.display_name,
        },
      });
    }
    if (payload.whatsapp_number) {
      await smartcommRepo.upsertSocialHandle({
        client,
        h: {
          contact_id: contact.contact_id,
          platform: "whatsapp",
          handle: payload.whatsapp_number,
          external_user_id: payload.whatsapp_number,
          display_name: payload.display_name,
        },
      });
    }
    if (payload.email) {
      await smartcommRepo.upsertSocialHandle({
        client,
        h: {
          contact_id: contact.contact_id,
          platform: "email",
          handle: payload.email,
          external_user_id: payload.email.toLowerCase(),
          display_name: payload.display_name,
        },
      });
    }

    // Default delivery address.
    if (payload.delivery_address) {
      await repo.upsertContactAddress({
        client,
        addr: {
          contact_id: contact.contact_id,
          address_type: "delivery",
          ...payload.delivery_address,
          recipient_name:
            payload.display_name ||
            `${payload.first_name} ${payload.last_name || ""}`.trim(),
          recipient_phone: payload.primary_phone || payload.whatsapp_number,
          is_default: true,
        },
      });
    }
    // Billing address (only if different).
    if (!payload.billing_same_as_delivery && payload.billing_address) {
      await repo.upsertContactAddress({
        client,
        addr: {
          contact_id: contact.contact_id,
          address_type: "billing",
          ...payload.billing_address,
          recipient_name:
            payload.display_name ||
            `${payload.first_name} ${payload.last_name || ""}`.trim(),
          recipient_phone: payload.primary_phone || payload.whatsapp_number,
          is_default: true,
        },
      });
    }

    // Bind back to the originating chat thread.
    if (link.channel_id) {
      // Attach as a contact member if not already on the channel.
      await smartcommRepo.addMember({
        client,
        m: {
          channel_id: link.channel_id,
          contact_id: contact.contact_id,
          role: "member",
        },
      });
      // Drop a system line in the thread so the staffer sees it.
      await smartcommRepo.insertMessage({
        client,
        message: {
          channel_id: link.channel_id,
          message_type: "system",
          content: `✅ ${payload.first_name || "Customer"} completed the welcome form (delivery address on file).`,
        },
      });
    }

    const finalised = await repo.markCompleted({
      client,
      submission_id: link.submission_id,
      payload,
      contact_id: contact.contact_id,
      ip,
    });
    logger.info(
      {
        submission_id: finalised.submission_id,
        contact_id: contact.contact_id,
        business: link.business,
      },
      "customer onboarding form submitted",
    );
    return {
      ok: true,
      submission_id: finalised.submission_id,
      contact_id: contact.contact_id,
    };
  });
}

// ── Admin: list ───────────────────────────────────────────

function listAdmin({ brand, limit, offset }) {
  return repo.listAdmin({ brand, limit, offset });
}

module.exports = { createLink, getPublic, submitPublic, listAdmin };
