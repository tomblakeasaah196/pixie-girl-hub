/**
 * Messaging Smartcomm (V2.2 §6.17) — HTTP controllers.
 * Thin req/res only — all business logic lives in smartcomm.service.
 */

"use strict";

const service = require("./smartcomm.service");
const praxisDraft = require("./smartcomm.praxis-draft");
const orderCapture = require("./smartcomm.order-capture");

const ctx = (req) => ({
  user: req.user,
  brand: req.brand,
  request_id: req.request_id,
});

// ── Channels ──────────────────────────────────────────────

async function listChannels(req, res) {
  const data = await service.listChannels({
    user: req.user,
    brand: req.brand,
    channel_type: req.query.channel_type,
    platform: req.query.platform,
    status: req.query.status,
    assigned_to_me: req.query.assigned_to_me === "true",
    q: req.query.q || req.query.search,
    include_archived: req.query.include_archived === "true",
    limit: req.query.limit ? Math.min(parseInt(req.query.limit, 10), 100) : 50,
    offset: req.query.offset ? parseInt(req.query.offset, 10) : 0,
  });
  res.json({ data });
}

async function getChannel(req, res) {
  const data = await service.getChannel({ user: req.user, id: req.params.id });
  res.json(data);
}

async function createChannel(req, res) {
  const data = await service.createChannel({ ...ctx(req), input: req.body });
  res.status(201).json(data);
}

async function archiveChannel(req, res) {
  const data = await service.archiveChannel({
    ...ctx(req),
    id: req.params.id,
    archived: req.body.archived !== false,
  });
  res.json(data);
}

async function resolveThread(req, res) {
  const data = await service.resolveThread({ ...ctx(req), id: req.params.id });
  res.json(data);
}

async function assignThread(req, res) {
  const data = await service.assignThread({
    ...ctx(req),
    id: req.params.id,
    assigned_to: req.body.assigned_to,
    handoff_note: req.body.handoff_note,
  });
  res.json(data);
}

async function pinChannel(req, res) {
  const data = await service.pinChannel({
    user: req.user,
    id: req.params.id,
    pinned: !!req.body.pinned,
  });
  res.json(data);
}

async function muteChannel(req, res) {
  const data = await service.muteChannel({
    user: req.user,
    id: req.params.id,
    muted: !!req.body.muted,
    hours: req.body.hours,
  });
  res.json(data);
}

// ── Members ───────────────────────────────────────────────

async function addMember(req, res) {
  const data = await service.addMember({
    ...ctx(req),
    id: req.params.id,
    input: req.body,
  });
  res.status(201).json(data);
}

async function removeMember(req, res) {
  await service.removeMember({
    ...ctx(req),
    id: req.params.id,
    member_id: req.params.member_id,
  });
  res.status(204).end();
}

// ── Messages ──────────────────────────────────────────────

async function listMessages(req, res) {
  const data = await service.listMessages({
    user: req.user,
    id: req.params.id,
    before: req.query.before,
    limit: req.query.limit ? Math.min(parseInt(req.query.limit, 10), 100) : 50,
  });
  res.json({ data });
}

async function postMessage(req, res) {
  const data = await service.postMessage({
    ...ctx(req),
    id: req.params.id,
    input: req.body,
  });
  res.status(201).json(data);
}

async function editMessage(req, res) {
  const data = await service.editMessage({
    ...ctx(req),
    message_id: req.params.message_id,
    content: req.body.content,
  });
  res.json(data);
}

async function deleteMessage(req, res) {
  await service.deleteMessage({
    ...ctx(req),
    message_id: req.params.message_id,
  });
  res.status(204).end();
}

async function forwardMessage(req, res) {
  const data = await service.forwardMessage({
    ...ctx(req),
    message_id: req.params.message_id,
    channel_ids: req.body.channel_ids,
  });
  res.json(data);
}

async function reactToMessage(req, res) {
  const data = await service.reactToMessage({
    user: req.user,
    message_id: req.params.message_id,
    emoji: req.body.emoji,
  });
  res.json(data);
}

async function starMessage(req, res) {
  const data = await service.starMessage({
    user: req.user,
    message_id: req.params.message_id,
  });
  res.json(data);
}

async function listStarred(req, res) {
  const data = await service.listStarred({
    user: req.user,
    limit: req.query.limit ? parseInt(req.query.limit, 10) : 100,
  });
  res.json({ data });
}

async function searchMessages(req, res) {
  const data = await service.searchMessages({
    user: req.user,
    q: req.query.q || "",
    channel_id: req.query.channel_id,
    limit: req.query.limit ? Math.min(parseInt(req.query.limit, 10), 100) : 30,
  });
  res.json({ data });
}

async function markRead(req, res) {
  const data = await service.markRead({
    user: req.user,
    id: req.params.id,
    up_to_id: req.body.up_to_message_id,
  });
  res.json(data);
}

async function getUnreadCount(req, res) {
  const data = await service.getUnreadCount({
    user: req.user,
    brand: req.brand,
  });
  res.json({ unread_count: data.total, by_channel: data.by_channel });
}

async function addAttachment(req, res) {
  const data = await service.addAttachment({
    ...ctx(req),
    message_id: req.params.message_id,
    input: req.body,
  });
  res.status(201).json(data);
}

async function sendToCustomer(req, res) {
  const data = await service.sendToCustomer({
    brand: req.brand,
    contact_id: req.body.contact_id,
    channel: req.body.channel,
    subject: req.body.subject,
    body: req.body.body,
    user: req.user,
  });
  res.status(201).json(data);
}

// ── Drafts ────────────────────────────────────────────────

async function getDraft(req, res) {
  const data = await service.getDraft({ user: req.user, id: req.params.id });
  res.json(data || null);
}

async function saveDraft(req, res) {
  const data = await service.saveDraft({
    user: req.user,
    id: req.params.id,
    input: req.body,
  });
  res.json(data);
}

async function discardDraft(req, res) {
  await service.discardDraft({ user: req.user, id: req.params.id });
  res.status(204).end();
}

async function draftWithPraxis(req, res) {
  const data = await praxisDraft.draftReply({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    channel_id: req.params.id,
  });
  res.json(data);
}

async function createOrderCapture(req, res) {
  const data = await orderCapture.createCaptureLink({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    input: req.body,
  });
  res.status(201).json(data);
}

async function sendInvoiceIntoThread(req, res) {
  const data = await service.sendInvoiceIntoThread({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    channel_id: req.params.id,
    invoice_id: req.body.invoice_id,
  });
  res.status(201).json(data);
}

// ── Quick replies ─────────────────────────────────────────

async function listQuickReplies(req, res) {
  const data = await service.listQuickReplies({
    user: req.user,
    brand: req.brand,
  });
  res.json({ data });
}

async function createQuickReply(req, res) {
  const data = await service.createQuickReply({
    ...ctx(req),
    input: req.body,
  });
  res.status(201).json(data);
}

async function updateQuickReply(req, res) {
  const data = await service.updateQuickReply({
    ...ctx(req),
    reply_id: req.params.reply_id,
    input: req.body,
  });
  res.json(data);
}

async function deleteQuickReply(req, res) {
  await service.deleteQuickReply({
    ...ctx(req),
    reply_id: req.params.reply_id,
  });
  res.status(204).end();
}

// ── Customer 360 ──────────────────────────────────────────

async function getCustomer360(req, res) {
  const data = await service.getCustomer360({
    brand: req.brand,
    contact_id: req.params.contact_id,
  });
  res.json(data);
}

module.exports = {
  listChannels,
  getChannel,
  createChannel,
  archiveChannel,
  resolveThread,
  assignThread,
  pinChannel,
  muteChannel,
  addMember,
  removeMember,
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
  addAttachment,
  sendToCustomer,
  getDraft,
  saveDraft,
  discardDraft,
  draftWithPraxis,
  createOrderCapture,
  sendInvoiceIntoThread,
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  getCustomer360,
};
