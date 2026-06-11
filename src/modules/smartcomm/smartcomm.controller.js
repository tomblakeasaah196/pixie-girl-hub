/**
 * Messaging Smartcomm (V2.2 §6.17) — HTTP controller.
 */

"use strict";

const service = require("./smartcomm.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// ── Channels ───────────────────────────────────────────────
async function listChannels(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listChannels({
      brand: req.brand,
      channel_type: req.query.channel_type,
      page,
      page_size,
    }),
  );
}
async function getChannel(req, res) {
  res.json({ data: await service.getChannel({ id: req.params.id }) });
}
async function createChannel(req, res) {
  res.status(201).json({
    data: await service.createChannel({ ...base(req), input: req.body }),
  });
}
async function archiveChannel(req, res) {
  res.json({
    data: await service.archiveChannel({
      ...base(req),
      id: req.params.id,
      archived: req.body.archived !== false,
    }),
  });
}

// ── Members ────────────────────────────────────────────────
async function addMember(req, res) {
  res.status(201).json({
    data: await service.addMember({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function removeMember(req, res) {
  await service.removeMember({
    ...base(req),
    id: req.params.id,
    member_id: req.params.member_id,
  });
  res.status(204).end();
}

// ── Messages ───────────────────────────────────────────────
async function listMessages(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(await service.listMessages({ id: req.params.id, page, page_size }));
}
async function postMessage(req, res) {
  res.status(201).json({
    data: await service.postMessage({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function deleteMessage(req, res) {
  await service.deleteMessage({
    ...base(req),
    message_id: req.params.message_id,
  });
  res.status(204).end();
}
async function addAttachment(req, res) {
  res.status(201).json({
    data: await service.addAttachment({
      ...base(req),
      message_id: req.params.message_id,
      input: req.body,
    }),
  });
}

// ── Reads ──────────────────────────────────────────────────
async function markRead(req, res) {
  res.json({
    data: await service.markRead({ user: req.user, id: req.params.id }),
  });
}
async function getUnreadCount(req, res) {
  res.json({ data: await service.getUnreadCount({ user: req.user }) });
}

// ── Customer dispatch ──────────────────────────────────────
async function sendToCustomer(req, res) {
  res.status(201).json({
    data: await service.sendToCustomer({
      brand: req.brand,
      user: req.user,
      contact_id: req.body.contact_id,
      channel: req.body.channel,
      subject: req.body.subject,
      body: req.body.body,
    }),
  });
}

module.exports = {
  listChannels,
  getChannel,
  createChannel,
  archiveChannel,
  addMember,
  removeMember,
  listMessages,
  postMessage,
  deleteMessage,
  addAttachment,
  markRead,
  getUnreadCount,
  sendToCustomer,
};
