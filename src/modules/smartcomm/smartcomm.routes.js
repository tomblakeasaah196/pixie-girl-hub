/**
 * Messaging Smartcomm (V2.2 §6.17) — routes. Mounted at /api/v1/smartcomm.
 * Permission key: smartcomm. Internal team channels (group/direct) with
 * members + read receipts + attachments, customer threads (WhatsApp /
 * Instagram / email bridged in via webhooks), drafts, quick replies,
 * reactions, stars, search, and the customer-360 panel.
 *
 * Platform-level gating (per-user × per-platform × per-business) lives
 * in shared.smartcomm_platform_permissions and is enforced in the
 * service layer once routes already passed the module-level perm.
 */

"use strict";

const express = require("express");
const c = require("./smartcomm.controller");
const v = require("./smartcomm.validator");
const { requirePermission, requireCeo } = require("../../middleware/rbac");

// Side-effects:
//   - sales.order.payment_reminder → customer dispatch (G-4)
//   - webhook.received (meta_whatsapp/meta_instagram/cloudflare_email)
//     → recordInboundFromCustomer (PR1)
require("./smartcomm.subscribers");
require("./smartcomm.realtime");

const router = express.Router();
const can = (action) => requirePermission("smartcomm", action);
const canPraxis = (action) => requirePermission("praxis_ai", action);

// ── Reads + dispatch (literal segments before /channels/:id) ─
router.get("/unread-count", can("view"), c.getUnreadCount);
router.get("/starred", can("view"), c.listStarred);
router.get("/search", can("view"), c.searchMessages);
router.post("/send", can("edit"), v.validateSendToCustomer, c.sendToCustomer);

// ── Colleague directory (internal people-picker) ───────────
// smartcomm.view so any messaging user can start a group / add teammates,
// rather than needing iam.view (the old /iam/users source most staff lacked).
router.get("/colleagues", can("view"), c.listColleagues);

// ── CEO channel-access matrix (SSOT) ───────────────────────
// Owner-only: who may reach which channels (in-house/groups, WhatsApp,
// Instagram, Facebook, email) per business. CEO decides; the service layer
// enforces it on every read/reply/list.
router.get("/channel-access", requireCeo, c.getChannelAccessMatrix);
router.get("/channel-access/:user_id", requireCeo, c.getUserChannelAccess);
router.put(
  "/channel-access/:user_id",
  requireCeo,
  v.validateChannelAccessSet,
  c.setUserChannelAccess,
);

// ── Customer 360 ───────────────────────────────────────────
router.get("/customer-360/:contact_id", can("view"), c.getCustomer360);

// ── Composer settings (editable per-brand templates + WA number) ──
// Reading needs only view; editing the stock copy rides smartcomm.edit
// (same gate as sending — any rep who can reply can tweak the wording).
router.get("/composer-settings", can("view"), c.getComposerSettings);
router.put(
  "/composer-settings",
  can("edit"),
  v.validateComposerSettingsUpdate,
  c.updateComposerSettings,
);

// ── Order link (short shared-catalogue checkout link into a chat) ──
router.post(
  "/order-link",
  can("edit"),
  v.validateOrderLinkCreate,
  c.createOrderLink,
);
// A channel's order links + live customer activity (sidebar panel).
router.get("/channels/:id/order-links", can("view"), c.listOrderLinks);

// Send an existing invoice as a card into the chat thread (Customer-360
// quick-action). Requires both smartcomm.edit and invoicing.view.
router.post(
  "/channels/:id/send-invoice",
  can("edit"),
  requirePermission("invoicing", "view"),
  v.validateSendInvoiceCard,
  c.sendInvoiceIntoThread,
);

// ── Quick replies ──────────────────────────────────────────
router.get("/quick-replies", can("view"), c.listQuickReplies);
router.post(
  "/quick-replies",
  can("create"),
  v.validateQuickReplyCreate,
  c.createQuickReply,
);
router.patch(
  "/quick-replies/:reply_id",
  can("edit"),
  v.validateQuickReplyUpdate,
  c.updateQuickReply,
);
router.delete("/quick-replies/:reply_id", can("delete"), c.deleteQuickReply);

// ── Channels ───────────────────────────────────────────────
router.get("/channels", can("view"), c.listChannels);
router.post(
  "/channels",
  can("create"),
  v.validateChannelCreate,
  c.createChannel,
);
// Find-or-create a 1:1 DM with a colleague (HR "Message" buttons + search).
router.post("/channels/direct", can("create"), v.validateStartDirect, c.startDirect);
router.get("/channels/:id", can("view"), c.getChannel);
router.post(
  "/channels/:id/archive",
  can("edit"),
  v.validateArchiveChannel,
  c.archiveChannel,
);
router.post("/channels/:id/resolve", can("edit"), c.resolveThread);
router.post("/channels/:id/reopen", can("edit"), c.reopenThread);
router.post(
  "/channels/:id/assign",
  can("edit"),
  v.validateAssignThread,
  c.assignThread,
);
router.post(
  "/channels/:id/pin",
  can("view"),
  v.validatePinChannel,
  c.pinChannel,
);
router.post(
  "/channels/:id/mute",
  can("view"),
  v.validateMuteChannel,
  c.muteChannel,
);
router.post(
  "/channels/:id/mark-read",
  can("view"),
  v.validateMarkRead,
  c.markRead,
);

// ── Members ────────────────────────────────────────────────
router.post(
  "/channels/:id/members",
  can("edit"),
  v.validateMemberAdd,
  c.addMember,
);
router.delete("/channels/:id/members/:member_id", can("edit"), c.removeMember);

// ── Drafts (per channel, per user) ─────────────────────────
router.get("/channels/:id/draft", can("view"), c.getDraft);
router.put(
  "/channels/:id/draft",
  can("view"),
  v.validateDraftSave,
  c.saveDraft,
);
router.delete("/channels/:id/draft", can("view"), c.discardDraft);

// Praxis-drafted reply (on-demand only, never auto). The composer
// hides the button when this permission gate fails.
router.post(
  "/channels/:id/draft-with-praxis",
  can("edit"),
  canPraxis("view"),
  c.draftWithPraxis,
);

// ── Messages ───────────────────────────────────────────────
router.get("/channels/:id/messages", can("view"), c.listMessages);
router.post(
  "/channels/:id/messages",
  can("edit"),
  v.validatePostMessage,
  c.postMessage,
);
router.patch(
  "/messages/:message_id",
  can("edit"),
  v.validateEditMessage,
  c.editMessage,
);
router.delete("/messages/:message_id", can("edit"), c.deleteMessage);
router.post(
  "/messages/:message_id/forward",
  can("edit"),
  v.validateForwardMessage,
  c.forwardMessage,
);
router.post(
  "/messages/:message_id/react",
  can("view"),
  v.validateReactToMessage,
  c.reactToMessage,
);
// Re-queue a failed outbound send (the "Retry" affordance on a failed
// bubble). Same gate as posting: smartcomm.edit + per-platform reply.
router.post("/messages/:message_id/retry", can("edit"), c.retryMessage);
router.post("/messages/:message_id/star", can("view"), c.starMessage);
router.post(
  "/messages/:message_id/attachments",
  can("edit"),
  v.validateAttachmentAdd,
  c.addAttachment,
);

module.exports = router;
