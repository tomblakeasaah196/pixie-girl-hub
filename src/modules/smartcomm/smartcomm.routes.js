/**
 * Messaging Smartcomm (V2.2 §6.17) — routes. Mounted at /api/v1/smartcomm.
 * Permission key: smartcomm. Internal team channels (group/direct) with
 * members + read receipts + attachments, customer threads, and outbound
 * dispatch (WhatsApp/email). The shared messaging tables are owned here.
 */

"use strict";

const express = require("express");
const c = require("./smartcomm.controller");
const v = require("./smartcomm.validator");
const { requirePermission } = require("../../middleware/rbac");

// Side-effect: register order.payment_reminder → customer dispatch (G-4).
require("./smartcomm.subscribers");

const router = express.Router();
const can = (action) => requirePermission("smartcomm", action);

// ── Reads + dispatch (literal segments before /channels/:id) ─
router.get("/unread-count", can("view"), c.getUnreadCount);
router.post("/send", can("edit"), v.validateSendToCustomer, c.sendToCustomer);

// ── Channels ───────────────────────────────────────────────
router.get("/channels", can("view"), c.listChannels);
router.post(
  "/channels",
  can("create"),
  v.validateChannelCreate,
  c.createChannel,
);
router.get("/channels/:id", can("view"), c.getChannel);
router.post(
  "/channels/:id/archive",
  can("edit"),
  v.validateArchiveChannel,
  c.archiveChannel,
);
router.post("/channels/:id/read", can("view"), c.markRead);

// ── Members ────────────────────────────────────────────────
router.post(
  "/channels/:id/members",
  can("edit"),
  v.validateMemberAdd,
  c.addMember,
);
router.delete("/channels/:id/members/:member_id", can("edit"), c.removeMember);

// ── Messages ───────────────────────────────────────────────
router.get("/channels/:id/messages", can("view"), c.listMessages);
router.post(
  "/channels/:id/messages",
  can("edit"),
  v.validatePostMessage,
  c.postMessage,
);
router.delete("/messages/:message_id", can("edit"), c.deleteMessage);
router.post(
  "/messages/:message_id/attachments",
  can("edit"),
  v.validateAttachmentAdd,
  c.addAttachment,
);

module.exports = router;
