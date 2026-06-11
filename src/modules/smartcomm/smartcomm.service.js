/**
 * Messaging Smartcomm (V2.2 §6.17) — business logic.
 *
 * Internal team channels + external customer threads, and outbound dispatch
 * to customers over WhatsApp / email (the existing provider services). This
 * is the dispatch layer that closes G-4: reminders, install-hub CTAs and
 * notifications that target a customer are sent here and recorded as messages.
 */

"use strict";

const repo = require("./smartcomm.repo");
const events = require("./smartcomm.events");
const whatsapp = require("../../services/whatsapp.service");
const email = require("../../services/email.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { logger } = require("../../config/logger");
const { NotFoundError, AppError } = require("../../utils/errors");

function listChannels(args) {
  return repo.listChannels(args);
}

async function getChannel({ id }) {
  const channel = await repo.getChannel({ id });
  if (!channel) throw new NotFoundError("Channel");
  const [messages, members] = await Promise.all([
    repo.listMessages({ channel_id: id }),
    repo.listMembers({ channel_id: id }),
  ]);
  return { ...channel, messages, members };
}

function listMessages({ id, page, page_size }) {
  return repo.listMessages({ channel_id: id, page, page_size });
}

/** Create a team channel (group/direct) and seed its members. */
async function createChannel({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const channel = await repo.createChannel({
      client,
      channel: {
        channel_type: input.channel_type,
        name: input.name,
        business: brand,
        metadata: input.metadata,
      },
    });
    // Creator is an admin member; plus any invited members.
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
  return updated;
}

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
}

async function deleteMessage({ brand, user, request_id, message_id }) {
  return transaction(async (client) => {
    const msg = await repo.getMessage({ client, id: message_id });
    if (!msg || msg.is_deleted) throw new NotFoundError("Message");
    // Only the author (or staff with edit perm at the route) may delete.
    if (msg.sender_user_id && msg.sender_user_id !== user.user_id)
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
    events.emit("message.deleted", { channel_id: msg.channel_id, message_id });
  });
}

async function markRead({ user, id }) {
  return transaction(async (client) => {
    const channel = await repo.getChannel({ client, id });
    if (!channel) throw new NotFoundError("Channel");
    await repo.markChannelRead({
      client,
      channel_id: id,
      user_id: user.user_id,
    });
    return { channel_id: id, read_at: new Date().toISOString() };
  });
}
function getUnreadCount({ user }) {
  return repo.unreadCountForUser({ user_id: user.user_id });
}

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

/** Post a message into a channel as the acting staff user. */
async function postMessage({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const channel = await repo.getChannel({ client, id });
    if (!channel) throw new NotFoundError("Channel");
    const msg = await repo.insertMessage({
      client,
      message: {
        channel_id: id,
        sender_user_id: user.user_id,
        message_type: input.message_type || "text",
        content: input.content,
        reply_to_id: input.reply_to_id,
      },
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
      channel_id: id,
      message_id: msg.message_id,
    });
    return msg;
  });
}

async function findOrCreateCustomerThread({
  client,
  brand,
  contact_id,
  platform,
}) {
  const existing = await repo.findCustomerThread({ client, brand, contact_id });
  if (existing) return existing;
  return repo.createChannel({
    client,
    channel: {
      channel_type: "customer_thread",
      business: brand,
      external_platform: platform,
      metadata: { contact_id },
    },
  });
}

/**
 * Send an outbound message to a customer over WhatsApp or email and record it
 * on their thread. `automated` messages are stored as 'system'. Best-effort
 * for callers that pass { soft: true } (subscribers) — returns null instead
 * of throwing when the contact isn't reachable.
 */
async function sendToCustomer({
  brand,
  contact_id,
  channel = "whatsapp",
  subject,
  body,
  // user,
  soft,
}) {
  const contact = await repo.getContactChannelInfo({ contact_id });
  if (!contact) {
    if (soft) return null;
    throw new NotFoundError("Contact");
  }

  let external_ref = null;
  try {
    if (channel === "email") {
      if (!contact.email) {
        if (soft) return null;
        throw new AppError("NO_EMAIL", "Contact has no email", 422);
      }
      const r = await email.send({
        to: contact.email,
        subject: subject || "A message from us",
        html: body,
      });
      external_ref = (r && (r.messageId || r.id)) || null;
    } else {
      const to = contact.whatsapp_number || contact.primary_phone;
      if (!to) {
        if (soft) return null;
        throw new AppError("NO_PHONE", "Contact has no phone/WhatsApp", 422);
      }
      const r = await whatsapp.sendText({ to, body });
      external_ref =
        (r && (r.id || (r.messages && r.messages[0] && r.messages[0].id))) ||
        null;
    }
  } catch (err) {
    logger.error(
      { err: err.message, brand, contact_id, channel },
      "smartcomm: outbound dispatch failed",
    );
    if (soft) return null;
    throw err;
  }

  const thread = await findOrCreateCustomerThread({
    brand,
    contact_id,
    platform: channel === "email" ? "email" : "whatsapp",
  });
  const msg = await repo.insertMessage({
    message: {
      channel_id: thread.channel_id,
      message_type: "system",
      content: body,
      external_ref,
    },
  });
  events.emit("customer.message_sent", {
    brand,
    contact_id,
    channel_id: thread.channel_id,
    message_id: msg.message_id,
  });
  return { channel_id: thread.channel_id, message: msg, external_ref };
}

/**
 * Record an INBOUND customer message (e.g. an Instagram DM bridged from Social
 * Media §6.14) onto the customer's thread, linked to their contact profile.
 */
async function recordInboundFromCustomer({
  brand,
  contact_id,
  platform,
  body,
  external_ref,
}) {
  const thread = await findOrCreateCustomerThread({
    brand,
    contact_id,
    platform: platform || "instagram",
  });
  const msg = await repo.insertMessage({
    message: {
      channel_id: thread.channel_id,
      sender_contact_id: contact_id,
      message_type: "text",
      content: body,
      external_ref,
    },
  });
  events.emit("customer.message_received", {
    brand,
    contact_id,
    channel_id: thread.channel_id,
    message_id: msg.message_id,
  });
  return { channel_id: thread.channel_id, message: msg };
}

module.exports = {
  listChannels,
  getChannel,
  listMessages,
  createChannel,
  archiveChannel,
  addMember,
  removeMember,
  postMessage,
  deleteMessage,
  markRead,
  getUnreadCount,
  addAttachment,
  sendToCustomer,
  recordInboundFromCustomer,
  findOrCreateCustomerThread,
};
