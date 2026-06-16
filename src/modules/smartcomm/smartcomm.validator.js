/**
 * Messaging Smartcomm (V2.2 §6.17) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const messageType = z.enum([
  "text",
  "image",
  "document",
  "voice_note",
  "video",
  "sticker",
  "system",
]);

const channelCreate = z
  .object({
    channel_type: z.enum(["group", "direct"]),
    name: z.string().max(200).optional(),
    metadata: z.record(z.any()).optional(),
    member_user_ids: z.array(z.string().uuid()).optional(),
  })
  .strict();

const archiveChannel = z.object({ archived: z.boolean().optional() }).strict();

const assignThread = z
  .object({
    assigned_to: z.string().uuid().nullable().optional(),
    handoff_note: z.string().max(2000).optional(),
  })
  .strict();

const memberAdd = z
  .object({
    user_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    role: z.enum(["member", "admin"]).optional(),
  })
  .strict();

const pinChannel = z.object({ pinned: z.boolean() }).strict();

const muteChannel = z
  .object({
    muted: z.boolean(),
    hours: z.number().int().positive().max(24 * 30).optional(),
  })
  .strict();

const postMessage = z
  .object({
    content: z.string().max(8000).optional(),
    message_type: messageType.optional(),
    reply_to_id: z.string().uuid().optional(),
    attachments: z
      .array(
        z
          .object({
            document_id: z.string().uuid(),
            display_name: z.string().max(200).optional(),
          })
          .strict(),
      )
      .optional(),
    is_template: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      (v.content && v.content.length > 0) ||
      (v.attachments && v.attachments.length > 0),
    { message: "content or attachments required" },
  );

const editMessage = z
  .object({ content: z.string().min(1).max(8000) })
  .strict();

const forwardMessage = z
  .object({ channel_ids: z.array(z.string().uuid()).min(1).max(20) })
  .strict();

const reactToMessage = z
  .object({ emoji: z.string().min(1).max(8) })
  .strict();

const markRead = z
  .object({ up_to_message_id: z.string().uuid().optional() })
  .strict();

const sendToCustomer = z
  .object({
    contact_id: z.string().uuid(),
    channel: z.enum(["whatsapp", "email", "instagram"]).optional(),
    subject: z.string().max(200).optional(),
    body: z.string().min(1).max(8000),
  })
  .strict();

const attachmentAdd = z
  .object({
    document_id: z.string().uuid(),
    display_name: z.string().max(200).optional(),
  })
  .strict();

const draftSave = z
  .object({
    content: z.string().max(8000),
    attachments: z
      .array(
        z
          .object({
            document_id: z.string().uuid(),
            display_name: z.string().max(200).optional(),
          })
          .strict(),
      )
      .optional(),
    reply_to_id: z.string().uuid().optional(),
    generated_by: z.enum(["human", "praxis"]).optional(),
  })
  .strict();

const quickReplyCreate = z
  .object({
    scope: z.enum(["personal", "brand"]).default("personal"),
    slug: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9-]+$/i, "slug must be alphanumeric / hyphen"),
    title: z.string().min(1).max(120),
    body: z.string().min(1).max(8000),
    variables: z.array(z.string().max(60)).optional(),
    category: z.string().max(60).optional(),
    sort_order: z.number().int().optional(),
  })
  .strict();

const quickReplyUpdate = z
  .object({
    title: z.string().min(1).max(120).optional(),
    body: z.string().min(1).max(8000).optional(),
    variables: z.array(z.string().max(60)).optional(),
    category: z.string().max(60).nullable().optional(),
    sort_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateChannelCreate: mk(channelCreate),
  validateArchiveChannel: mk(archiveChannel),
  validateAssignThread: mk(assignThread),
  validateMemberAdd: mk(memberAdd),
  validatePinChannel: mk(pinChannel),
  validateMuteChannel: mk(muteChannel),
  validatePostMessage: mk(postMessage),
  validateEditMessage: mk(editMessage),
  validateForwardMessage: mk(forwardMessage),
  validateReactToMessage: mk(reactToMessage),
  validateMarkRead: mk(markRead),
  validateSendToCustomer: mk(sendToCustomer),
  validateAttachmentAdd: mk(attachmentAdd),
  validateDraftSave: mk(draftSave),
  validateQuickReplyCreate: mk(quickReplyCreate),
  validateQuickReplyUpdate: mk(quickReplyUpdate),
};
