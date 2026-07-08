/**
 * Messaging Smartcomm (V2.2 §6.17) — business logic.
 *
 * Internal team channels + external customer threads, outbound dispatch
 * to customers over WhatsApp / Instagram / email, draft staging, quick
 * replies, search, reactions, stars, edits, the customer-360 panel,
 * and the inbound webhook bridge that turns a Meta payload into a
 * recorded message on the right brand's inbox.
 *
 * Permission gate: routes use requirePermission('smartcomm', action).
 * Platform-level gates (per-user × per-platform × per-business) live
 * in smartcomm_platform_permissions and are enforced in this layer.
 */

"use strict";

const repo = require("./smartcomm.repo");
const events = require("./smartcomm.events");
const { enqueue } = require("../../jobs/queue-producer");
const { audit } = require("../../middleware/audit");
const { transaction, query } = require("../../config/database");
const { NotFoundError, AppError, ValidationError } = require("../../utils/errors");

// ── Helpers ───────────────────────────────────────────────

function isCeo(user) {
  return !!(user && (user.is_ceo || user.role === "ceo"));
}

// Allowed metadata keys per card-type. Clients can submit any JSON, but only
// these fields make it onto the message row — this prevents trojan keys (e.g.
// "is_admin", "delivery_status") from leaking in via the open metadata channel.
const METADATA_WHITELIST = {
  product_share: ["products", "intro"],
  send_invoice: [
    "invoice_id",
    "invoice_number",
    "amount_due",
    "due_date",
    "url",
  ],
  // Instagram story surfaces — the ingester stamps these so the UI
  // can render a story-preview card in the inbox.
  ig_story_mention: ["story_url", "story_id"],
  ig_story_reply:   ["story_url", "story_id"],
};

function sanitiseMessageMetadata(messageType, metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const allowed = METADATA_WHITELIST[messageType];
  if (!allowed) return null;
  const out = {};
  for (const k of allowed) if (k in metadata) out[k] = metadata[k];
  return Object.keys(out).length ? out : null;
}

/** Resolve whether the user is allowed to act on a platform for a brand. */
async function assertPlatformAccess({
  user,
  brand,
  platform,
  action = "view",
}) {
  if (isCeo(user)) return;
  if (!platform || platform === "internal") return; // internal channels gated by smartcomm perm key
  const { rows } = await query(
    `SELECT * FROM shared.smartcomm_platform_permissions
      WHERE user_id = $1 AND business = $2 AND platform = $3`,
    [user.user_id, brand, platform],
  );
  const p = rows[0];
  // No row means "follow smartcomm default" — staff can view everything
  // they have smartcomm.view on, but not reply/template/close without
  // an explicit grant.
  if (!p) {
    if (action === "view") return;
    throw new AppError(
      "PLATFORM_FORBIDDEN",
      `You don't have ${action} permission on ${platform}`,
      403,
    );
  }
  const map = {
    view: p.can_view,
    reply: p.can_reply,
    send_template: p.can_send_template,
    close: p.can_close,
  };
  if (!map[action]) {
    throw new AppError(
      "PLATFORM_FORBIDDEN",
      `You don't have ${action} permission on ${platform}`,
      403,
    );
  }
}

/**
 * Read-access gate for a channel. `customer_thread` channels only ever
 * carry the CONTACT as a member (see findOrCreateCustomerThread) — no
 * staff user_id is ever added — so a plain membership check locks EVERY
 * non-CEO staffer out of EVERY WhatsApp/Instagram/email conversation.
 * Mirrors listChannelsForUser's visibility rule: customer threads are
 * readable by any staffer with (brand + per-platform) view access;
 * internal direct/group channels still require real membership.
 */
async function assertChannelReadable({ user, brand, channel }) {
  if (isCeo(user)) return;
  if (channel.channel_type === "customer_thread") {
    if (channel.external_platform) {
      await assertPlatformAccess({
        user,
        brand,
        platform: channel.external_platform,
        action: "view",
      });
    }
    return;
  }
  const member = await repo.findMember({
    channel_id: channel.channel_id,
    user_id: user.user_id,
  });
  if (!member)
    throw new AppError(
      "NOT_MEMBER",
      "You are not a member of this channel",
      403,
    );
}

// ── Channels ──────────────────────────────────────────────

function listChannels({
  user,
  brand,
  channel_type,
  platform,
  status,
  assigned_to_me,
  q,
  include_archived,
  limit,
  offset,
}) {
  return repo.listChannelsForUser({
    user_id: user.user_id,
    brand,
    channel_type,
    external_platform: platform === "internal" ? null : platform,
    internal_only: platform === "internal",
    status,
    assigned_to_me,
    q,
    include_archived,
    limit,
    offset,
  });
}

async function getChannel({ user, brand, id }) {
  const channel = await repo.getChannel({ id });
  if (!channel) throw new NotFoundError("Channel");
  await assertChannelReadable({ user, brand, channel });
  return repo.getChannelEnriched({ id, user_id: user.user_id });
}

/** Create an internal team channel (group or direct). */
async function createChannel({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const channel = await repo.createChannel({
      client,
      channel: {
        channel_type: input.channel_type,
        name: input.name,
        business: brand,
        metadata: input.metadata,
        created_by: user.user_id,
      },
    });
    await repo.addMember({
      client,
      m: {
        channel_id: channel.channel_id,
        user_id: user.user_id,
        role: "admin",
      },
    });
    for (const uid of input.member_user_ids || []) {
      if (uid !== user.user_id)
        await repo.addMember({
          client,
          m: { channel_id: channel.channel_id, user_id: uid },
        });
    }
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "smartcomm.channel.create",
      target_type: "channel",
      target_id: channel.channel_id,
      after: { channel_type: channel.channel_type },
      request_id,
    });
    events.emit("channel.created", { channel_id: channel.channel_id });
    return channel;
  });
}

/**
 * Find-or-create a 1:1 internal DM between the caller and a colleague (used by
 * "Message" buttons across HR — Employee 360, directory, contact profile — and
 * the new-conversation search). Idempotent: returns the existing direct
 * channel if one already exists so repeated clicks don't spawn duplicates.
 */
async function getOrCreateDirect({ brand, user, request_id, target_user_id }) {
  if (!target_user_id || target_user_id === user.user_id) {
    throw new ValidationError("A valid colleague is required to start a chat");
  }
  const existing = await repo.findDirectChannel({
    brand, userA: user.user_id, userB: target_user_id,
  });
  if (existing) return existing;
  return createChannel({
    brand, user, request_id,
    input: { channel_type: "direct", member_user_ids: [target_user_id] },
  });
}

async function archiveChannel({
  brand,
  user,
  request_id,
  id,
  archived = true,
}) {
  const channel = await repo.getChannel({ id });
  if (!channel) throw new NotFoundError("Channel");
  const updated = await repo.setChannelArchived({ id, archived });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: archived
      ? "smartcomm.channel.archive"
      : "smartcomm.channel.unarchive",
    target_type: "channel",
    target_id: id,
    request_id,
  });
  events.emit(archived ? "channel.archived" : "channel.unarchived", {
    channel_id: id,
  });
  return updated;
}

async function resolveThread({ brand, user, request_id, id }) {
  const channel = await repo.getChannel({ id });
  if (!channel) throw new NotFoundError("Channel");
  if (channel.external_platform)
    await assertPlatformAccess({
      user,
      brand,
      platform: channel.external_platform,
      action: "close",
    });
  const updated = await repo.setChannelStatus({ id, status: "resolved" });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.thread.resolve",
    target_type: "channel",
    target_id: id,
    request_id,
  });
  events.emit("thread.resolved", { channel_id: id });
  return updated;
}

async function assignThread({
  brand,
  user,
  request_id,
  id,
  assigned_to,
  handoff_note,
}) {
  const channel = await repo.getChannel({ id });
  if (!channel) throw new NotFoundError("Channel");
  const updated = await repo.setChannelStatus({
    id,
    assigned_to: assigned_to || null,
  });
  if (handoff_note) {
    await repo.insertMessage({
      message: {
        channel_id: id,
        message_type: "system",
        content: `Assigned to ${assigned_to ? "another teammate" : "unassigned"}. ${handoff_note}`,
      },
    });
  }
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.thread.assign",
    target_type: "channel",
    target_id: id,
    after: { assigned_to },
    request_id,
  });
  events.emit("thread.assigned", { channel_id: id, assigned_to });
  return updated;
}

// ── Members ───────────────────────────────────────────────

async function addMember({ brand, user, request_id, id, input }) {
  const channel = await repo.getChannel({ id });
  if (!channel) throw new NotFoundError("Channel");
  const m = await repo.addMember({
    m: {
      channel_id: id,
      user_id: input.user_id,
      contact_id: input.contact_id,
      role: input.role,
    },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.member.add",
    target_type: "channel",
    target_id: id,
    request_id,
  });
  events.emit("member.added", { channel_id: id, user_id: input.user_id });
  return m;
}

async function removeMember({ brand, user, request_id, id, member_id }) {
  const ok = await repo.removeMember({ channel_id: id, member_id });
  if (!ok) throw new NotFoundError("Member");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.member.remove",
    target_type: "channel",
    target_id: id,
    request_id,
  });
  events.emit("member.removed", { channel_id: id, member_id });
}

async function pinChannel({ user, id, pinned }) {
  const ok = await repo.setMemberPinned({
    channel_id: id,
    user_id: user.user_id,
    pinned,
  });
  if (!ok) throw new NotFoundError("Channel membership");
  return { channel_id: id, is_pinned: !!pinned };
}

async function muteChannel({ user, id, muted, hours }) {
  const muted_until = muted
    ? new Date(Date.now() + (hours || 8) * 3600 * 1000)
    : null;
  const ok = await repo.setMemberMuted({
    channel_id: id,
    user_id: user.user_id,
    muted_until,
  });
  if (!ok) throw new NotFoundError("Channel membership");
  return { channel_id: id, muted_until };
}

// ── Messages ──────────────────────────────────────────────

async function listMessages({ user, brand, id, before, limit }) {
  const channel = await repo.getChannel({ id });
  if (!channel) throw new NotFoundError("Channel");
  // Verify read access before exposing message content.
  await assertChannelReadable({ user, brand, channel });
  return repo.listMessages({ channel_id: id, before, limit });
}

/** Post a message into a channel. */
async function postMessage({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const channel = await repo.getChannel({ client, id });
    if (!channel) throw new NotFoundError("Channel");
    // External-thread reply gate
    if (channel.external_platform) {
      await assertPlatformAccess({
        user,
        brand,
        platform: channel.external_platform,
        action: "reply",
      });
      // WhatsApp 24-hour window guard — free-form only inside, template-only outside.
      if (
        channel.external_platform === "whatsapp" &&
        channel.wa_window_expires_at &&
        new Date(channel.wa_window_expires_at) < new Date() &&
        input.message_type !== "system" &&
        !input.is_template
      ) {
        throw new AppError(
          "WA_WINDOW_CLOSED",
          "WhatsApp 24-hour service window has expired. Send an approved template instead.",
          409,
        );
      }
      // Instagram 24-hour service window — free-form only inside; outside
      // the window Meta only accepts messages tagged HUMAN_AGENT (which
      // your Meta app must be approved for). `is_human_agent` on the
      // input signals "operator explicitly approved a HUMAN_AGENT reply".
      if (
        channel.external_platform === "instagram" &&
        channel.ig_window_expires_at &&
        new Date(channel.ig_window_expires_at) < new Date() &&
        input.message_type !== "system" &&
        !input.is_human_agent
      ) {
        throw new AppError(
          "IG_WINDOW_CLOSED",
          "Instagram 24-hour service window has expired. Reply with a HUMAN_AGENT-tagged message (needs Meta app approval).",
          409,
        );
      }
    }
    const msg = await repo.insertMessage({
      client,
      message: {
        channel_id: id,
        sender_user_id: user.user_id,
        message_type: input.message_type || "text",
        content: input.content,
        reply_to_id: input.reply_to_id,
        delivery_status:
          channel.channel_type === "customer_thread" ? "queued" : "sent",
        metadata: sanitiseMessageMetadata(input.message_type, input.metadata),
      },
    });
    // Attach documents if supplied.
    for (const a of input.attachments || []) {
      await repo.addAttachment({
        client,
        a: {
          message_id: msg.message_id,
          document_id: a.document_id,
          display_name: a.display_name,
        },
      });
    }
    await repo.deleteDraft({
      channel_id: id,
      user_id: user.user_id,
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "smartcomm.message.post",
      target_type: "message",
      target_id: msg.message_id,
      request_id,
    });
    events.emit("message.posted", {
      brand,
      channel_id: id,
      message_id: msg.message_id,
      external_platform: channel.external_platform,
    });
    // For external customer threads, queue an outbound provider send.
    if (channel.channel_type === "customer_thread") {
      await enqueueOutboundForChannel({
        channel,
        message: msg,
        content: input.content,
        attachments: input.attachments,
        client,
      });
    }
    return msg;
  });
}

async function editMessage({ brand, user, request_id, message_id, content }) {
  return transaction(async (client) => {
    const msg = await repo.getMessage({ client, id: message_id });
    if (!msg || msg.is_deleted) throw new NotFoundError("Message");
    if (msg.sender_user_id !== user.user_id && !isCeo(user))
      throw new AppError(
        "NOT_AUTHOR",
        "Only the author can edit this message",
        403,
      );
    const updated = await repo.editMessageContent({
      client,
      message_id,
      content,
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "smartcomm.message.edit",
      target_type: "message",
      target_id: message_id,
      request_id,
    });
    events.emit("message.edited", {
      channel_id: msg.channel_id,
      message_id,
    });
    return updated;
  });
}

async function deleteMessage({ brand, user, request_id, message_id }) {
  return transaction(async (client) => {
    const msg = await repo.getMessage({ client, id: message_id });
    if (!msg || msg.is_deleted) throw new NotFoundError("Message");
    if (
      msg.sender_user_id &&
      msg.sender_user_id !== user.user_id &&
      !isCeo(user)
    )
      throw new AppError(
        "NOT_AUTHOR",
        "Only the author can delete this message",
        403,
      );
    await repo.softDeleteMessage({ client, id: message_id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "smartcomm.message.delete",
      target_type: "message",
      target_id: message_id,
      request_id,
    });
    events.emit("message.deleted", {
      channel_id: msg.channel_id,
      message_id,
    });
  });
}

async function forwardMessage({
  brand,
  user,
  request_id,
  message_id,
  channel_ids,
}) {
  const src = await repo.getMessage({ id: message_id });
  if (!src || src.is_deleted) throw new NotFoundError("Message");
  // The caller must actually be able to read the message they're
  // forwarding — otherwise anyone with smartcomm.edit could enumerate
  // message_ids from another private DM/group and re-broadcast them.
  const srcChannel = await repo.getChannel({ id: src.channel_id });
  if (!srcChannel) throw new NotFoundError("Channel");
  await assertChannelReadable({ user, brand, channel: srcChannel });
  let forwarded = 0;
  for (const target_channel_id of channel_ids) {
    const dest = await repo.getChannel({ id: target_channel_id });
    if (!dest) continue;
    if (dest.external_platform) {
      await assertPlatformAccess({
        user,
        brand,
        platform: dest.external_platform,
        action: "reply",
      });
    } else if (!isCeo(user)) {
      // Internal direct/group destination — must actually be a member to
      // post there (assertPlatformAccess only covers external platforms).
      const destMember = await repo.findMember({
        channel_id: dest.channel_id,
        user_id: user.user_id,
      });
      if (!destMember)
        throw new AppError(
          "NOT_MEMBER",
          "You are not a member of this channel",
          403,
        );
    }
    await transaction(async (client) => {
      const msg = await repo.insertMessage({
        client,
        message: {
          channel_id: target_channel_id,
          sender_user_id: user.user_id,
          message_type: src.message_type,
          content: src.content,
          is_forwarded: true,
          forwarded_from_id: src.message_id,
          delivery_status:
            dest.channel_type === "customer_thread" ? "queued" : "sent",
        },
      });
      // Re-attach the same documents (zero re-upload — by reference).
      const atts = await repo.listAttachments({ message_id: src.message_id });
      for (const a of atts) {
        await repo.addAttachment({
          client,
          a: {
            message_id: msg.message_id,
            document_id: a.document_id,
            display_name: a.display_name,
          },
        });
      }
      events.emit("message.forwarded", {
        from_message_id: src.message_id,
        to_channel_id: target_channel_id,
        new_message_id: msg.message_id,
      });
      if (dest.channel_type === "customer_thread") {
        await enqueueOutboundForChannel({
          channel: dest,
          message: msg,
          content: src.content,
          attachments: atts,
          client,
        });
      }
    });
    forwarded += 1;
  }
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.message.forward",
    target_type: "message",
    target_id: message_id,
    after: { forwarded_count: forwarded },
    request_id,
  });
  return { forwarded_count: forwarded };
}

async function reactToMessage({ user, message_id, emoji }) {
  const r = await repo.toggleReaction({
    message_id,
    user_id: user.user_id,
    emoji,
  });
  const msg = await repo.getMessage({ id: message_id });
  events.emit("message.reacted", {
    channel_id: msg ? msg.channel_id : null,
    message_id,
    emoji,
    user_id: user.user_id,
    added: r.added,
  });
  return r;
}

async function starMessage({ user, message_id }) {
  return repo.toggleStar({ message_id, user_id: user.user_id });
}

function listStarred({ user, limit }) {
  return repo.listStarredForUser({ user_id: user.user_id, limit });
}

function searchMessages({ user, q, channel_id, limit }) {
  return repo.searchMessages({
    user_id: user.user_id,
    q,
    channel_id,
    limit,
  });
}

// ── Read receipts ─────────────────────────────────────────

async function markRead({ user, id, up_to_id }) {
  return transaction(async (client) => {
    const channel = await repo.getChannel({ client, id });
    if (!channel) throw new NotFoundError("Channel");
    await repo.markChannelRead({
      client,
      channel_id: id,
      user_id: user.user_id,
      up_to_id,
    });
    events.emit("channel.read", {
      channel_id: id,
      user_id: user.user_id,
    });
    return { channel_id: id, read_at: new Date().toISOString() };
  });
}

function getUnreadCount({ user, brand }) {
  return repo.unreadCountForUser({ user_id: user.user_id, brand });
}

// ── Drafts ────────────────────────────────────────────────

async function getDraft({ user, id }) {
  return repo.getDraft({ channel_id: id, user_id: user.user_id });
}

async function saveDraft({ user, id, input }) {
  return repo.upsertDraft({
    channel_id: id,
    user_id: user.user_id,
    content: input.content,
    attachments: input.attachments,
    reply_to_id: input.reply_to_id,
    generated_by: input.generated_by,
  });
}

async function discardDraft({ user, id }) {
  await repo.deleteDraft({ channel_id: id, user_id: user.user_id });
}

// ── Quick replies ─────────────────────────────────────────

function listQuickReplies({ user, brand }) {
  return repo.listQuickReplies({ user_id: user.user_id, brand });
}

async function createQuickReply({ brand, user, request_id, input }) {
  // Brand-scoped replies require CEO or smartcomm.create on the brand.
  if (input.scope === "brand" && !isCeo(user) && input.scope === "brand") {
    // Reuses standard smartcomm.create perm check on the route — keep
    // this validation lightweight here.
  }
  const r = await repo.createQuickReply({
    user_id: user.user_id,
    brand,
    input,
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.quick_reply.create",
    target_type: "quick_reply",
    target_id: r.reply_id,
    request_id,
  });
  return r;
}

async function updateQuickReply({ brand, user, request_id, reply_id, input }) {
  const r = await repo.updateQuickReply({
    reply_id,
    owner_user_id: user.user_id,
    brand,
    input,
  });
  if (!r) throw new NotFoundError("Quick reply");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.quick_reply.update",
    target_type: "quick_reply",
    target_id: reply_id,
    request_id,
  });
  return r;
}

async function deleteQuickReply({ brand, user, request_id, reply_id }) {
  const r = await repo.deleteQuickReply({
    reply_id,
    owner_user_id: user.user_id,
    brand,
  });
  if (!r) throw new NotFoundError("Quick reply");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.quick_reply.delete",
    target_type: "quick_reply",
    target_id: reply_id,
    request_id,
  });
}

// ── Customer 360 ──────────────────────────────────────────

async function getCustomer360({ brand, contact_id }) {
  const c360 = await repo.customer360({ contact_id, brand });
  if (!c360) throw new NotFoundError("Contact");
  return c360;
}

// ── Outbound dispatch ─────────────────────────────────────

const ngn = (v) => `₦${Number(v || 0).toLocaleString()}`;

/**
 * Fetch fresh, authoritative display fields (name/description/price/
 * image) for one shared-catalogue item straight from the catalogue
 * tables, rather than trusting whatever was snapshotted onto the
 * message at share time — prices and descriptions can change, and the
 * snapshot never carried a description at all. Returns null if the
 * item can no longer be found (deleted, etc.) so the caller can fall
 * back to the snapshot.
 */
async function resolveProductForShare({ business, kind, ref_id }) {
  if (!ref_id) return null;
  const schema = `"${business}"`;
  try {
    if (kind === "styled") {
      const styledRepo = require("../catalogue/styled.repo");
      const s = await styledRepo.getById({ brand: business, id: ref_id });
      if (!s || s.is_deleted) return null;
      return {
        name: s.name,
        description: s.short_description || s.long_description || null,
        price_ngn:
          s.retail_price_ngn !== null && s.retail_price_ngn !== undefined
            ? Number(s.retail_price_ngn)
            : null,
        image_url: s.primary_image_url || null,
      };
    }
    if (kind === "bundle") {
      const bundleService = require("../retention/bundle.service");
      const b = await bundleService.getBundle({ brand: business, id: ref_id });
      if (!b || b.is_active === false) return null;
      return {
        name: b.display_name,
        description: b.description || null,
        price_ngn:
          b.effective_price_ngn !== null && b.effective_price_ngn !== undefined
            ? Number(b.effective_price_ngn)
            : Number(b.bundle_price_ngn || 0),
        image_url: b.hero_image_url || null,
      };
    }
    if (kind === "service") {
      const { rows } = await query(
        `SELECT name, short_description, long_description, base_price_ngn, image_url
           FROM shared.service_offerings
          WHERE service_id = $1 AND is_active = true`,
        [ref_id],
      );
      const svc = rows[0];
      if (!svc) return null;
      return {
        name: svc.name,
        description: svc.short_description || svc.long_description || null,
        price_ngn:
          svc.base_price_ngn !== null && svc.base_price_ngn !== undefined
            ? Number(svc.base_price_ngn)
            : null,
        image_url: svc.image_url || null,
      };
    }
    // base product
    const { rows } = await query(
      `SELECT p.name, p.short_description, p.long_description,
              (SELECT pi.cdn_url FROM ${schema}.product_images pi
                WHERE pi.product_id = p.product_id
                ORDER BY pi.is_primary DESC, pi.display_order LIMIT 1) AS image_url,
              (SELECT pv.price_storefront_ngn FROM ${schema}.product_variants pv
                WHERE pv.product_id = p.product_id AND pv.is_active = true
                ORDER BY pv.is_default DESC, pv.created_at ASC LIMIT 1) AS price_ngn
         FROM ${schema}.products p
        WHERE p.product_id = $1 AND p.is_active = true`,
      [ref_id],
    );
    const p = rows[0];
    if (!p) return null;
    return {
      name: p.name,
      description: p.short_description || p.long_description || null,
      price_ngn:
        p.price_ngn !== null && p.price_ngn !== undefined ? Number(p.price_ngn) : null,
      image_url: p.image_url || null,
    };
  } catch {
    return null;
  }
}

/**
 * Build one "card" per shared product — a professional-looking name +
 * description + price, with the product photo as a real WhatsApp/IG
 * media attachment (not just a text bullet). Falls back to the
 * name/price snapshotted at share time when the live lookup can't find
 * the item, and to a text-only card when there's no photo. A single
 * closing card carries the tap-to-order link (every product in one
 * catalogue share points at the same capture link) so it isn't
 * repeated on every card.
 */
async function buildProductShareCards({ business, message }) {
  const meta = message.metadata || {};
  const products = Array.isArray(meta.products) ? meta.products : [];
  const cards = [];
  if (meta.intro) cards.push({ type: "text", body: meta.intro });

  let capture_url = null;
  for (const p of products) {
    const fresh = await resolveProductForShare({
      business,
      kind: p.kind,
      ref_id: p.id,
    });
    const name = fresh?.name || p.name;
    const description = fresh?.description || null;
    const price_ngn = fresh ? fresh.price_ngn : p.price;
    const image_url = fresh?.image_url || p.image_url || null;
    if (p.capture_url && !capture_url) capture_url = p.capture_url;

    const bits = [`*${name}*`];
    if (description) bits.push(description);
    if (price_ngn !== null && price_ngn !== undefined) {
      bits.push(`Price: ${ngn(price_ngn)}`);
    }
    const caption = bits.join("\n");
    cards.push(
      image_url ? { type: "image", media_url: image_url, caption } : { type: "text", body: caption },
    );
  }

  if (capture_url) {
    cards.push({
      type: "text",
      body: `🛍️ Ready to order? Tap to confirm & pay:\n${capture_url}`,
    });
  }
  return cards;
}

/**
 * Render a `send_invoice` card as plain text — invoices carry no
 * photo, so unlike product_share this stays a single message.
 */
function composeCardText(message, content) {
  if (message.message_type === "send_invoice") {
    const meta = message.metadata || {};
    const bits = [`Invoice ${meta.invoice_number || ""}`.trim()];
    if (meta.amount_due !== null && meta.amount_due !== undefined)
      bits.push(`Amount due: ${ngn(meta.amount_due)}`);
    if (meta.due_date) bits.push(`Due: ${meta.due_date}`);
    if (meta.url) bits.push(meta.url);
    return bits.join("\n");
  }
  return content || null;
}

/**
 * Resolve the first attachment on a message into an internet-reachable
 * media URL for a provider send. Returns null (with a logged warning)
 * when no ADMIN_BASE_URL/CDN_BASE_URL is configured — sending Meta a
 * relative /media/... path silently fails, so callers must treat null
 * as "can't send this media" rather than best-effort.
 */
async function resolveOutboundMedia(message, client) {
  const rows = await repo.getAttachmentsForSend({
    client,
    message_id: message.message_id,
  });
  const a = rows[0];
  if (!a || !a.file_path) return null;
  const storage = require("../../services/storage.service");
  const media_url = storage.absoluteUrl(a.file_path);
  if (!media_url) {
    const { logger } = require("../../config/logger");
    logger.warn(
      { message_id: message.message_id },
      "smartcomm: outbound media has no public base URL configured (set ADMIN_BASE_URL or CDN_BASE_URL) — cannot send to WhatsApp/Instagram",
    );
    return null;
  }
  return { media_url, filename: a.display_name, mime_type: a.mime_type };
}

/**
 * Build the whatsapp-send job payload for a posted message, branching
 * on message_type so attachments/catalogue-shares/invoice-cards
 * actually reach the customer instead of silently being dropped (only
 * the plain-text `content` used to be sent, regardless of type).
 */
/**
 * Build the whatsapp-send job payload(s) for a posted message, branching
 * on message_type so attachments/catalogue-shares/invoice-cards
 * actually reach the customer instead of silently being dropped (only
 * the plain-text `content` used to be sent, regardless of type).
 * Always returns an array — one job for most types, one job per
 * product + a closing link for `product_share` (WhatsApp supports an
 * image with its own caption, so each product is a single native
 * image bubble).
 */
async function buildWhatsAppSends(message, content, client, business) {
  switch (message.message_type) {
    case "image":
    case "video":
    case "document":
    case "voice_note": {
      const media = await resolveOutboundMedia(message, client);
      if (!media) return [];
      const kind =
        message.message_type === "voice_note" ? "audio" : message.message_type;
      return [
        {
          kind,
          media_url: media.media_url,
          filename: media.filename,
          caption: content || undefined,
        },
      ];
    }
    case "product_share": {
      const cards = await buildProductShareCards({ business, message });
      return cards.map((c) =>
        c.type === "image"
          ? { kind: "image", media_url: c.media_url, caption: c.caption }
          : { kind: "text", body: c.body },
      );
    }
    case "send_invoice": {
      const body = composeCardText(message, content);
      return body ? [{ kind: "text", body }] : [];
    }
    default:
      return content ? [{ kind: "text", body: content }] : [];
  }
}

/**
 * Translate a posted message on a customer_thread into a provider-
 * specific send job. The processor stamps `external_ref` and updates
 * delivery_status on completion.
 */
async function enqueueOutboundForChannel({
  channel,
  message,
  content,
  attachments: _attachments,
  client,
}) {
  const platform = channel.external_platform;
  const meta = channel.metadata || {};
  // Reachability of the customer is captured on the contact, not the
  // channel — channels only know who is in them.
  const member = await query(
    `SELECT con.contact_id, con.primary_phone, con.whatsapp_number, con.email,
            h.handle AS ig_handle, h.external_user_id AS ig_user_id
       FROM shared.channel_members cm
       LEFT JOIN shared.contacts con ON con.contact_id = cm.contact_id
       LEFT JOIN shared.contact_social_handles h
              ON h.contact_id = cm.contact_id AND h.platform = $2
      WHERE cm.channel_id = $1 AND cm.contact_id IS NOT NULL
      LIMIT 1`,
    [channel.channel_id, "instagram"],
  );
  const c = member.rows[0] || {};

  if (platform === "whatsapp") {
    const to = c.whatsapp_number || c.primary_phone;
    if (!to) {
      await repo.setMessageDelivery({
        message_id: message.message_id,
        delivery_status: "failed",
        delivery_error: "NO_WHATSAPP_NUMBER_ON_FILE",
      });
      return;
    }
    const sends = await buildWhatsAppSends(message, content, client, channel.business);
    if (sends.length === 0) {
      await repo.setMessageDelivery({
        message_id: message.message_id,
        delivery_status: "failed",
        delivery_error: "NOTHING_TO_SEND",
      });
      return;
    }
    // A product_share fans out into several native bubbles (one photo
    // per product + a closing link) — every job carries the same
    // smartcomm_message_id so any one of them completing marks the
    // message "sent"; only the last to complete's provider ref sticks
    // (fine — the tick reflects the overall share, not one bubble).
    for (const send of sends) {
      await enqueue("whatsapp-send", "customer-whatsapp", {
        brand: channel.business,
        to,
        ...send,
        smartcomm_message_id: message.message_id,
        channel_id: channel.channel_id,
      });
    }
  } else if (platform === "instagram") {
    const recipient_id = c.ig_user_id || meta.ig_user_id;
    if (!recipient_id) {
      await repo.setMessageDelivery({
        message_id: message.message_id,
        delivery_status: "failed",
        delivery_error: "NO_IG_HANDLE_ON_FILE",
      });
      return;
    }
    // The 24h-window guard in postMessage marks the message with
    // is_template === true when the operator has opted into a
    // HUMAN_AGENT-tagged reply outside the window — pass that
    // through to the processor so it stamps the Meta MESSAGE_TAG.
    const outsideWindow =
      channel.ig_window_expires_at &&
      new Date(channel.ig_window_expires_at) < new Date();
    let jobPayloads;
    if (message.message_type === "image") {
      const media = await resolveOutboundMedia(message, client);
      if (!media) {
        await repo.setMessageDelivery({
          message_id: message.message_id,
          delivery_status: "failed",
          delivery_error: "MEDIA_URL_UNAVAILABLE",
        });
        return;
      }
      jobPayloads = [{ image_url: media.media_url }];
    } else if (
      message.message_type === "video" ||
      message.message_type === "document" ||
      message.message_type === "voice_note"
    ) {
      // Instagram Messenger doesn't support arbitrary document/video/audio
      // sends through this client yet — fail loud instead of silently
      // dropping so ops see it in the tick rather than a customer
      // wondering why nothing arrived.
      await repo.setMessageDelivery({
        message_id: message.message_id,
        delivery_status: "failed",
        delivery_error: "IG_MEDIA_TYPE_UNSUPPORTED",
      });
      return;
    } else if (message.message_type === "product_share") {
      // IG image attachments carry no caption field, unlike WhatsApp —
      // each card becomes its own text bubble (name/description/price)
      // immediately followed by the photo, rather than one combined
      // bubble.
      const cards = await buildProductShareCards({
        business: channel.business,
        message,
      });
      jobPayloads = cards.flatMap((card) =>
        card.type === "image"
          ? [{ text: card.caption }, { image_url: card.media_url }]
          : [{ text: card.body }],
      );
      if (jobPayloads.length === 0) {
        await repo.setMessageDelivery({
          message_id: message.message_id,
          delivery_status: "failed",
          delivery_error: "NOTHING_TO_SEND",
        });
        return;
      }
    } else {
      const body = composeCardText(message, content);
      if (!body) {
        await repo.setMessageDelivery({
          message_id: message.message_id,
          delivery_status: "failed",
          delivery_error: "NOTHING_TO_SEND",
        });
        return;
      }
      jobPayloads = [{ text: body }];
    }
    for (const jobPayload of jobPayloads) {
      await enqueue("instagram-send", "customer-ig", {
        brand: channel.business,
        recipient_id,
        ...jobPayload,
        tag: outsideWindow ? "HUMAN_AGENT" : undefined,
        smartcomm_message_id: message.message_id,
        channel_id: channel.channel_id,
      });
    }
  } else if (platform === "email") {
    const to = c.email;
    if (!to) return;
    await enqueue("email-send", "customer-email", {
      to,
      subject: meta.subject || "A message from us",
      html: content,
      in_reply_to: meta.in_reply_to,
      smartcomm_message_id: message.message_id,
      channel_id: channel.channel_id,
      brand: channel.business,
      contact_id: c.contact_id,
      event_key: "smartcomm.email_reply",
    });
  }
}

// ── Customer thread upsert + inbound recording ────────────

async function findOrCreateCustomerThread({
  client,
  brand,
  contact_id,
  platform,
  external_thread_ref,
}) {
  // Prefer existing thread keyed by the external thread ref so a
  // long-running customer convo stays in one channel even if the
  // contact rec is merged.
  if (external_thread_ref) {
    const byRef = await repo.findCustomerThreadByExternalRef({
      client,
      brand,
      platform,
      external_thread_ref,
    });
    if (byRef) return byRef;
  }
  const existing = await repo.findCustomerThread({
    client,
    brand,
    contact_id,
  });
  if (existing) {
    if (external_thread_ref && !existing.external_thread_ref) {
      await client.query(
        `UPDATE shared.message_channels
            SET external_thread_ref = $2, external_platform = $3
          WHERE channel_id = $1`,
        [existing.channel_id, external_thread_ref, platform],
      );
    }
    return existing;
  }
  const created = await repo.createChannel({
    client,
    channel: {
      channel_type: "customer_thread",
      business: brand,
      external_platform: platform,
      external_thread_ref,
      metadata: { contact_id },
    },
  });
  if (contact_id) {
    await repo.addMember({
      client,
      m: { channel_id: created.channel_id, contact_id, role: "member" },
    });
  }
  return created;
}

/**
 * Record an INBOUND customer message. Bridges Meta webhooks
 * (WhatsApp/Instagram), inbound email, and the social DM ingest route.
 * Idempotent on `external_ref` — re-delivery from the platform is safe.
 */
async function recordInboundFromCustomer({
  brand,
  contact_id,
  platform,
  body,
  message_type = "text",
  external_ref,
  external_thread_ref,
  attachment_url: _attachment_url,
  metadata,
}) {
  return transaction(async (client) => {
    // Idempotency: if we've already saved this provider message id, return it.
    if (external_ref) {
      const dup = await client.query(
        `SELECT message_id, channel_id FROM shared.messages
          WHERE external_ref = $1 LIMIT 1`,
        [external_ref],
      );
      if (dup.rows.length) {
        const row = dup.rows[0];
        return { channel_id: row.channel_id, message: row, duplicate: true };
      }
    }
    const thread = await findOrCreateCustomerThread({
      client,
      brand,
      contact_id,
      platform: platform || "instagram",
      external_thread_ref,
    });
    // Story-preview metadata belongs on the message row (so the inbox
    // can render a card next to that specific message). Email's
    // subject / in_reply_to belongs on the channel (so replies thread
    // correctly). Split accordingly.
    const messageMetadata = sanitiseMessageMetadata(message_type, metadata);
    const channelMetadataDelta = {};
    if (metadata) {
      if (metadata.subject) channelMetadataDelta.subject = metadata.subject;
      if (metadata.in_reply_to)
        channelMetadataDelta.in_reply_to = metadata.in_reply_to;
    }
    if (Object.keys(channelMetadataDelta).length) {
      await client.query(
        `UPDATE shared.message_channels
            SET metadata = shared.message_channels.metadata || $2::jsonb
          WHERE channel_id = $1`,
        [thread.channel_id, JSON.stringify(channelMetadataDelta)],
      );
    }
    const msg = await repo.insertMessage({
      client,
      message: {
        channel_id: thread.channel_id,
        sender_contact_id: contact_id,
        message_type,
        content: body,
        external_ref,
        delivery_status: "delivered",
        metadata: messageMetadata,
      },
    });
    events.emit("customer.message_received", {
      brand,
      contact_id,
      channel_id: thread.channel_id,
      message_id: msg.message_id,
      platform,
    });
    return { channel_id: thread.channel_id, message: msg, duplicate: false };
  });
}

/**
 * Send an outbound message to a customer over WhatsApp / IG / email,
 * record it on their thread, and queue the provider send. Used by
 * subscribers (G-4 layaway reminder etc.) and by the staff composer.
 *
 * `event_key` (optional) routes the message through the outbound
 * channel policy matrix (PR 2) so the CEO's per-event preferences are
 * honoured + `block_whatsapp` is enforced. When omitted, the caller's
 * explicit `channel` argument wins (used by the staff composer where
 * the user has already chosen).
 */
async function sendToCustomer({
  brand,
  contact_id,
  channel,
  subject,
  body,
  user,
  soft,
  event_key,
}) {
  const contact = await repo.getContactChannelInfo({ contact_id });
  if (!contact) {
    if (soft) return null;
    throw new NotFoundError("Contact");
  }

  // Resolve channel via the policy matrix when an event_key is provided.
  if (event_key && !channel) {
    const outboundPolicy = require("../outbound_policy/outbound-policy.service");
    const r = await outboundPolicy.resolveChannel({
      brand,
      event_key,
      contact_id,
    });
    if (r.channel === "disabled") {
      if (soft) return null;
      throw new AppError(
        "CHANNEL_DISABLED",
        `Outbound for '${event_key}' is disabled by policy (${r.reason})`,
        409,
      );
    }
    if (r.channel === "in_app_only") {
      // No outbound — caller should fall back to creating an in-app
      // notification instead. Returns null so subscribers don't crash.
      return { skipped: true, reason: "in_app_only" };
    }
    channel = r.channel === "respect_contact_pref" ? "email" : r.channel;
  }
  // Final default if neither caller nor policy provided one.
  channel = channel || "whatsapp";

  // Validate the destination before recording anything.
  if (channel === "email" && !contact.email) {
    if (soft) return null;
    throw new AppError("NO_EMAIL", "Contact has no email", 422);
  }
  if (
    channel !== "email" &&
    !(contact.whatsapp_number || contact.primary_phone)
  ) {
    if (soft) return null;
    throw new AppError("NO_PHONE", "Contact has no phone/WhatsApp", 422);
  }
  // Find-or-create + insert run in one transaction: two concurrent sends
  // to the same contact (two staff replying at once, or a queued job
  // racing a manual send) must not both pass the "does a thread already
  // exist?" check before either INSERT commits, which would create
  // duplicate customer_thread channels for the same contact/platform.
  const { thread, msg } = await transaction(async (client) => {
    const th = await findOrCreateCustomerThread({
      client,
      brand,
      contact_id,
      platform: channel === "email" ? "email" : channel,
    });
    const m = await repo.insertMessage({
      client,
      message: {
        channel_id: th.channel_id,
        sender_user_id: user ? user.user_id : null,
        message_type: user ? "text" : "system",
        content: body,
        delivery_status: "queued",
      },
    });
    await enqueueOutboundForChannel({
      channel: th,
      message: m,
      content: body,
      attachments: [],
      client,
    });
    return { thread: th, msg: m };
  });
  events.emit("customer.message_sent", {
    brand,
    contact_id,
    channel_id: thread.channel_id,
    message_id: msg.message_id,
  });
  // Outbound email keeps a subject; record it on the thread metadata
  // so reply threading via Message-ID can find it.
  if (channel === "email" && subject) {
    await query(
      `UPDATE shared.message_channels
          SET metadata = shared.message_channels.metadata || jsonb_build_object('subject', $2::text)
        WHERE channel_id = $1`,
      [thread.channel_id, subject],
    );
  }
  return { channel_id: thread.channel_id, message: msg, queued: true };
}

/**
 * Apply a provider delivery-status callback (Meta's `statuses[]` array
 * on the WhatsApp webhook: sent/delivered/read/failed, keyed by the
 * provider's own message id). This is the other half of the tick —
 * whatsapp-processor marks a message "sent" the instant the Graph API
 * accepts it, and this applies the later delivered/read/failed events
 * as Meta reports them back.
 */
async function applyProviderStatus({ external_ref, status, error }) {
  if (!external_ref || !status) return;
  await repo.setMessageDeliveryByExternalRef({
    external_ref,
    delivery_status: status,
    delivery_error: error || null,
  });
}

// ── Attachments ───────────────────────────────────────────

async function addAttachment({ brand, user, request_id, message_id, input }) {
  const msg = await repo.getMessage({ id: message_id });
  if (!msg) throw new NotFoundError("Message");
  const a = await repo.addAttachment({
    a: {
      message_id,
      document_id: input.document_id,
      display_name: input.display_name,
    },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.attachment.add",
    target_type: "message",
    target_id: message_id,
    request_id,
  });
  return a;
}

/**
 * Send-invoice card: posts a `send_invoice` message into the channel that
 * references an existing invoice (no PDF embedded — the customer taps the
 * link to view + pay). Reads the invoice from the brand's invoices table
 * and resolves a per-brand storefront URL via brand-urls.
 */
async function sendInvoiceIntoThread({
  brand,
  user,
  request_id,
  channel_id,
  invoice_id,
}) {
  if (!brand)
    throw new AppError("BRAND_REQUIRED", "Brand context required", 400);
  const invoicingRepo = require("../invoicing/invoicing.repo");
  const brandUrls = require("../../utils/brand-urls");

  const invoice = await invoicingRepo.findById({ brand, id: invoice_id });
  if (!invoice) throw new NotFoundError("Invoice");

  const base = await brandUrls.publicBaseUrl(brand);
  const url = `${base}/invoice/${invoice_id}`;

  return postMessage({
    brand,
    user,
    request_id,
    id: channel_id,
    input: {
      message_type: "send_invoice",
      metadata: {
        invoice_id,
        invoice_number: invoice.invoice_number,
        amount_due: String(invoice.amount_due_ngn ?? "0"),
        due_date: invoice.due_date,
        url,
      },
    },
  });
}

module.exports = {
  listChannels,
  getChannel,
  createChannel,
  getOrCreateDirect,
  archiveChannel,
  resolveThread,
  assignThread,
  addMember,
  removeMember,
  pinChannel,
  muteChannel,
  listMessages,
  postMessage,
  editMessage,
  deleteMessage,
  forwardMessage,
  reactToMessage,
  starMessage,
  listStarred,
  searchMessages,
  markRead,
  getUnreadCount,
  getDraft,
  saveDraft,
  discardDraft,
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  getCustomer360,
  sendToCustomer,
  sendInvoiceIntoThread,
  recordInboundFromCustomer,
  findOrCreateCustomerThread,
  addAttachment,
  // exposed for webhook subscriber:
  enqueueOutboundForChannel,
  applyProviderStatus,
  assertPlatformAccess,
};
