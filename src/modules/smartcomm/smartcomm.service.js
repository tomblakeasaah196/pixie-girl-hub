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
const { transaction, query, ex } = require("../../config/database");
const { NotFoundError, AppError, ValidationError } = require("../../utils/errors");

// ── Helpers ───────────────────────────────────────────────

function isCeo(user) {
  return !!(user && (user.is_ceo || user.role === "ceo"));
}

// The channels the CEO's access matrix governs. `internal` is in-house DMs +
// staff groups; the rest are the customer-facing platforms.
const EXTERNAL_PLATFORMS = ["whatsapp", "instagram", "facebook", "email"];
const ACCESS_PLATFORMS = [...EXTERNAL_PLATFORMS, "internal"];

/**
 * Load a user's channel-access posture for a brand, from the CEO-managed
 * matrix (shared.smartcomm_platform_permissions). Returns:
 *   { managed, byPlatform: { <platform>: {can_view,can_reply,...} } }
 *
 * `managed` is true once the CEO has configured ANY grant for this user in
 * this brand — that flips external platforms from the legacy "view-all"
 * default to an explicit allowlist (default deny unless granted). Users the
 * CEO never touched stay unmanaged and keep the old default. Internal chat
 * always defaults to allowed and is only cut by an explicit can_view=false.
 */
async function loadPlatformAccess({ user, brand }) {
  if (!user || !brand) return { managed: false, byPlatform: {} };
  const rows = await repo.listPlatformPermissionsForUser({
    user_id: user.user_id,
    business: brand,
  });
  const byPlatform = {};
  for (const r of rows) byPlatform[r.platform] = r;
  return { managed: rows.length > 0, byPlatform };
}

/**
 * Given a loaded access map, may this user perform `action` on `platform`?
 * Pure decision function so both the request-time gate and the inbox list
 * filter share one rule.
 */
function platformAllows({ managed, byPlatform }, platform, action = "view") {
  const p = byPlatform[platform];
  if (platform === "internal") {
    // Baseline for everyone; only an explicit revoke removes it.
    return !(p && p.can_view === false);
  }
  if (p) {
    const map = {
      view: p.can_view,
      reply: p.can_reply,
      send_template: p.can_send_template,
      close: p.can_close,
    };
    return !!map[action];
  }
  // No explicit row for this external platform.
  if (managed) return false; // allowlist: not granted
  return action === "view"; // legacy default: view-all, but no reply/close
}

// Allowed metadata keys per card-type. Clients can submit any JSON, but only
// these fields make it onto the message row — this prevents trojan keys (e.g.
// "is_admin", "delivery_status") from leaking in via the open metadata channel.
const METADATA_WHITELIST = {
  // Approved WhatsApp template send — the composer stamps the Meta
  // addressing (name + language) plus the filled components so the
  // outbound builder can hand the exact payload to the Graph API.
  template: ["template_name", "language", "components", "category", "template_id"],
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
  // WhatsApp voice-call timeline card (calls module, migration 000319).
  // Stamped server-side only — there is no HTTP path that posts a 'call'
  // message (the composer's validator doesn't accept the type).
  call: [
    "call_id",
    "call_status",
    "duration_seconds",
    "answered_by_name",
    "outcome",
    "outcome_notes",
  ],
};

function sanitiseMessageMetadata(messageType, metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const allowed = METADATA_WHITELIST[messageType];
  if (!allowed) return null;
  const out = {};
  for (const k of allowed) if (k in metadata) out[k] = metadata[k];
  return Object.keys(out).length ? out : null;
}

// ── Email envelope helpers ────────────────────────────────
// The three pieces the "make our email replies look like brand mail"
// work needs: a clean Cc list, plain text → branded HTML body, and the
// branded-shell wrapper. Kept here (not in email.service) because the
// house style is resolved per-brand from Settings, the same source the
// campaign / transactional mail uses.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalise an operator-supplied Cc into a clean, de-duplicated list of
 * valid addresses. Accepts an array (the composer sends one) or a raw
 * comma/semicolon string (a subscriber or API caller might). Invalid or
 * duplicate entries are dropped, capped at 25 so one call can't fan a
 * copy out to a whole list.
 */
function normaliseCcList(cc) {
  if (!cc) return [];
  const arr = Array.isArray(cc) ? cc : String(cc).split(/[,;]/);
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const e = String(raw || "").trim().toLowerCase();
    if (e && EMAIL_RE.test(e) && !seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out.slice(0, 25);
}

/**
 * Turn the operator's plain-text message into escaped HTML paragraphs for
 * the branded email body. Blank lines separate paragraphs; single
 * newlines become <br>. Everything is HTML-escaped first — this is
 * operator free text, never trusted markup.
 */
function textToEmailHtml(text) {
  const { esc } = require("../../services/email-theme");
  const blocks = String(text || "")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks
    .map(
      (b) =>
        `<p style="margin:0 0 14px;line-height:1.62">${esc(b).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

/**
 * Wrap a conversational email body in the brand's house shell (logo,
 * accent, footer) so a reply typed in Messaging arrives looking like the
 * brand's marketing/transactional mail — resolved per-brand from Settings,
 * nothing hard-coded. Falls back to a bare escaped paragraph if the brand
 * lookup or render ever fails, so branding can never block a customer
 * reply from going out.
 */
async function buildBrandedConversationalEmail({ brand, text, bodyHtml }) {
  const raw = String(text || "");
  // A Gmail-style composer supplies ready HTML (bold/colours/lists/links/
  // images the operator laid out); a plain reply supplies just text, which we
  // paragraph-wrap. Either way it goes inside the brand shell so the mail
  // looks like the brand's other letters, not a bare paragraph.
  const inner =
    bodyHtml && String(bodyHtml).trim()
      ? String(bodyHtml)
      : textToEmailHtml(raw);
  try {
    const emailRender = require("../email_campaigns/email-render");
    const { buildTransactionalEmail } = require("../../services/transactional-email");
    const brandTokens = await emailRender.resolveBrandTokens(brand);
    const preheader = raw.replace(/\s+/g, " ").trim().slice(0, 140);
    const { html, text: plain } = buildTransactionalEmail({
      brandTokens,
      bodyHtml: inner,
      preheader,
    });
    return { html, text: raw || plain };
  } catch (err) {
    const { logger } = require("../../config/logger");
    logger.warn(
      { err: err.message, brand },
      "smartcomm: branded email render failed — sending plain body",
    );
    // Fallback still honours a rich body (it's already HTML); only the plain
    // path needs escaping so stray angle brackets don't become tags.
    const { esc } = require("../../services/email-theme");
    const fallback =
      bodyHtml && String(bodyHtml).trim()
        ? String(bodyHtml)
        : `<p>${esc(raw).replace(/\n/g, "<br>")}</p>`;
    return { html: fallback, text: raw };
  }
}

/**
 * Resolve whether the user is allowed to act on a platform for a brand.
 * The rule lives in platformAllows() so the inbox list filter agrees with
 * this request-time gate. `access` may be pre-loaded by the caller to avoid
 * a duplicate lookup; otherwise it's fetched here.
 */
async function assertPlatformAccess({
  user,
  brand,
  platform,
  action = "view",
  access,
}) {
  if (isCeo(user)) return;
  if (!platform) return;
  const map = access ?? (await loadPlatformAccess({ user, brand }));
  if (!platformAllows(map, platform, action)) {
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
  // Internal direct/group channel: membership is required, and the CEO may
  // have revoked in-house access entirely for this user (matrix "internal").
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
  await assertPlatformAccess({ user, brand, platform: "internal", action: "view" });
}

// ── Channels ──────────────────────────────────────────────

async function listChannels({
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
  const rows = await repo.listChannelsForUser({
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
  if (isCeo(user)) return rows;
  // Apply the CEO's channel-access matrix to the inbox so a user only ever
  // sees the channels they were granted — matching the read/reply gates.
  // Unmanaged users (the common case) get no extra filtering.
  const access = await loadPlatformAccess({ user, brand });
  if (!access.managed) return rows;
  return rows.filter((c) => {
    if (c.channel_type === "customer_thread") {
      if (!c.external_platform) return true;
      return platformAllows(access, c.external_platform, "view");
    }
    // internal direct/group
    return platformAllows(access, "internal", "view");
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
    userA: user.user_id, userB: target_user_id,
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

async function reopenThread({ brand, user, request_id, id }) {
  const channel = await repo.getChannel({ id });
  if (!channel) throw new NotFoundError("Channel");
  const updated = await repo.setChannelStatus({ id, status: "open" });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.thread.reopen",
    target_type: "channel",
    target_id: id,
    request_id,
  });
  events.emit("thread.reopened", { channel_id: id });
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
  const posted = await transaction(async (client) => {
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
      //
      // A NULL window means the customer has NEVER messaged this thread on
      // Instagram — Meta has no conversation to attach to, so a business-
      // initiated free-form send is rejected server-side with a confusing
      // "Invalid message id" (code 508, subcode 2534122). Treat NULL the
      // same as an expired window and block it here with a clear reason,
      // instead of letting it fail opaquely at Meta.
      if (
        channel.external_platform === "instagram" &&
        input.message_type !== "system" &&
        !input.is_human_agent &&
        (!channel.ig_window_expires_at ||
          new Date(channel.ig_window_expires_at) < new Date())
      ) {
        throw new AppError(
          "IG_WINDOW_CLOSED",
          channel.ig_window_expires_at
            ? "Instagram 24-hour service window has expired. Reply with a HUMAN_AGENT-tagged message (needs Meta app approval)."
            : "You can't message this person on Instagram yet — Instagram only lets you reply within 24 hours of a message they send you. Wait for them to message first.",
          409,
        );
      }
    }
    // Card metadata (product_share/invoice/template) is whitelisted; on an
    // email thread the operator's envelope (subject + Cc) rides alongside it
    // so the outbound builder — and the thread record — can see it.
    let metadata = sanitiseMessageMetadata(input.message_type, input.metadata);
    if (
      channel.external_platform === "email" &&
      (input.subject || input.cc || input.body_html)
    ) {
      const cc = normaliseCcList(input.cc);
      metadata = {
        ...(metadata || {}),
        ...(input.subject ? { subject: String(input.subject).slice(0, 300) } : {}),
        ...(cc.length ? { cc } : {}),
        ...(input.body_html && String(input.body_html).trim()
          ? { body_html: String(input.body_html) }
          : {}),
      };
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
        metadata,
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
      // Persist the channel/platform so the audit + activity feeds can render a
      // friendly line ("You sent a message on Instagram to …") instead of a
      // bare "message.post". external_platform is only set on customer threads.
      metadata: channel.external_platform
        ? { platform: channel.external_platform, channel_name: channel.name || undefined }
        : undefined,
      request_id,
    });
    // For external customer threads, build the outbound provider jobs.
    // They are ENQUEUED after commit (see below) — a BullMQ worker used
    // to grab the job while this transaction was still open, so the
    // processor's "sent" update couldn't see the row, and a rollback
    // could leave a message already delivered to the customer.
    let jobs = [];
    if (channel.channel_type === "customer_thread") {
      jobs = await buildOutboundJobsForChannel({
        channel,
        message: msg,
        content: input.content,
        client,
      });
    }
    return { msg, channel, jobs };
  });
  // Post-commit: real rows are visible to every connection now — safe to
  // fan out sockets/notifications (the realtime layer re-reads the
  // message) and hand jobs to the worker.
  events.emit("message.posted", {
    brand,
    channel_id: id,
    message_id: posted.msg.message_id,
    sender_user_id: user.user_id,
    external_platform: posted.channel.external_platform,
  });
  // Keep the email thread's stored subject in step with the latest one the
  // operator sent, so the thread header + the next reply's default follow it.
  if (posted.channel.external_platform === "email" && input.subject) {
    await query(
      `UPDATE shared.message_channels
          SET metadata = shared.message_channels.metadata || jsonb_build_object('subject', $2::text)
        WHERE channel_id = $1`,
      [id, String(input.subject).slice(0, 300)],
    );
  }
  await flushOutboundJobs(posted.jobs);
  return posted.msg;
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
    const fwd = await transaction(async (client) => {
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
      let jobs = [];
      if (dest.channel_type === "customer_thread") {
        jobs = await buildOutboundJobsForChannel({
          channel: dest,
          message: msg,
          content: src.content,
          client,
        });
      }
      return { msg, jobs };
    });
    events.emit("message.forwarded", {
      from_message_id: src.message_id,
      to_channel_id: target_channel_id,
      new_message_id: fwd.msg.message_id,
    });
    await flushOutboundJobs(fwd.jobs);
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
  const result = await transaction(async (client) => {
    const channel = await repo.getChannel({ client, id });
    if (!channel) throw new NotFoundError("Channel");
    await repo.markChannelRead({
      client,
      channel_id: id,
      user_id: user.user_id,
      up_to_id,
    });
    // Internal DMs / groups: advance the SENDER-visible delivery tick on
    // every message this reader just consumed to 'read', so the sender's
    // one-check bubble flips to two blue checks. Customer threads keep
    // their Meta-driven delivery lifecycle and are excluded inside the
    // helper — nothing to do for them here.
    let advanced = [];
    if (channel.channel_type !== "customer_thread") {
      advanced = await repo.markInternalMessagesRead({
        client,
        channel_id: id,
        reader_user_id: user.user_id,
        up_to_id,
      });
    }
    events.emit("channel.read", {
      channel_id: id,
      user_id: user.user_id,
      // The realtime layer forwards these ids to each SENDER so their
      // open MessageThread can flip the ticks without waiting for the
      // 60-second poll. Empty array on customer threads / no-op reads.
      delivered_message_ids: advanced.map((r) => r.message_id),
      sender_user_ids: [
        ...new Set(advanced.map((r) => r.sender_user_id).filter(Boolean)),
      ],
    });
    return { channel_id: id, read_at: new Date().toISOString() };
  });
  // Reading the thread consumes its "new message" notifications too —
  // otherwise the bell keeps counting conversations you've already read
  // AND the one-unread-per-channel dedupe in the realtime layer stays
  // latched, silencing every future inbound sound for this thread.
  // Best-effort: a notification hiccup must never fail the read receipt.
  try {
    const notifications = require("../../services/notifications.service");
    await notifications.markReadByReference({
      user_id: user.user_id,
      reference_type: "smartcomm_channel",
      reference_id: id,
    });
  } catch {
    /* non-fatal */
  }
  return result;
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

// ── Composer settings ─────────────────────────────────────
// The two "insert stock copy" composer buttons (Online welcome form +
// WhatsApp handoff) read editable per-brand templates. {link}/{number}
// are substituted by the frontend at insert time. These are the
// defaults shown before the CEO saves their own wording — kept here so
// an empty settings row degrades to sensible copy, not a blank insert.
const DEFAULT_ONBOARDING_TEMPLATE =
  "Welcome 🌹 We'd love to make sure your order reaches you exactly the " +
  "way you want. Could you fill in this quick form (60 sec) — it covers " +
  "your delivery address & preferences:\n\n{link}";
const DEFAULT_WHATSAPP_HANDOFF_TEMPLATE =
  "Lovely! You can follow up with us on WhatsApp here:\n{number}";

/**
 * Resolve the brand's composer settings, filling every field with its
 * default so the frontend always has usable copy + a number. The
 * WhatsApp number falls back to the brand's Business-Setup phone.
 */
async function getComposerSettings({ brand }) {
  const [row, phone] = await Promise.all([
    repo.getComposerSettings({ brand }),
    repo.getBrandPhone({ brand }),
  ]);
  return {
    onboarding_template:
      (row && row.onboarding_template) || DEFAULT_ONBOARDING_TEMPLATE,
    whatsapp_handoff_template:
      (row && row.whatsapp_handoff_template) ||
      DEFAULT_WHATSAPP_HANDOFF_TEMPLATE,
    // Explicit override wins; else the Business-Setup phone.
    whatsapp_share_number:
      (row && row.whatsapp_share_number) || phone || null,
    // Surface whether each field is CEO-set vs a code/settings default,
    // so the UI can hint "using your saved wording" etc. if it wants.
    onboarding_is_custom: !!(row && row.onboarding_template),
    whatsapp_is_custom: !!(row && row.whatsapp_handoff_template),
    whatsapp_number_is_custom: !!(row && row.whatsapp_share_number),
  };
}

/**
 * Persist edited composer settings for a brand. Empty strings clear the
 * override (back to the default). Returns the resolved settings.
 */
async function updateComposerSettings({ brand, user, request_id, input }) {
  const patch = {};
  const norm = (v) => {
    if (v === undefined) return undefined;
    const t = String(v).trim();
    return t === "" ? null : t;
  };
  if ("onboarding_template" in input)
    patch.onboarding_template = norm(input.onboarding_template);
  if ("whatsapp_handoff_template" in input)
    patch.whatsapp_handoff_template = norm(input.whatsapp_handoff_template);
  if ("whatsapp_share_number" in input)
    patch.whatsapp_share_number = norm(input.whatsapp_share_number);
  await repo.upsertComposerSettings({
    brand,
    patch,
    user_id: user ? user.user_id : null,
  });
  if (user) {
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "smartcomm.composer_settings.update",
      target_type: "composer_settings",
      target_id: brand,
      request_id,
    });
  }
  return getComposerSettings({ brand });
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
 *
 * `platform` is used to trim what carries in the caption: Instagram DMs
 * cap a message at 1000 characters (code 100, subcode 2534038) and a
 * 3+ item share with descriptions can push a single bubble over the
 * cap. IG therefore ships just *name* + Price, and the description is
 * dropped. WhatsApp has no such cap so the full card stays.
 */
async function buildProductShareCards({ business, message, platform }) {
  const meta = message.metadata || {};
  const products = Array.isArray(meta.products) ? meta.products : [];
  const trimForIg = platform === "instagram";
  // Hard provider limits: IG rejects any bubble over 1000 chars (code 100,
  // subcode 2534038); WhatsApp caps a media CAPTION at 1024. Trim with an
  // ellipsis instead of letting Meta bounce the whole share — a long bundle
  // description or operator intro must never kill the send.
  const maxLen = trimForIg ? 980 : 1000;
  const clamp = (s) =>
    s && s.length > maxLen ? `${s.slice(0, maxLen - 1).trimEnd()}…` : s;
  const cards = [];
  if (meta.intro) cards.push({ type: "text", body: clamp(meta.intro) });

  let capture_url = null;
  for (const p of products) {
    const fresh = await resolveProductForShare({
      business,
      kind: p.kind,
      ref_id: p.id,
    });
    const name = fresh?.name || p.name;
    const description = trimForIg ? null : fresh?.description || null;
    // A staff-picked styled variant (head size × lace × colour) sets its own
    // price, snapshotted onto the card at pick time — prefer it over the live
    // anchor lookup so the customer sees the price for THEIR size/lace. `spec`
    // is the short combo label; show it on every platform (it's the point of
    // the pick) even when the description is trimmed for Instagram.
    const hasPickedVariant = Boolean(p.spec || p.styled_variant_id);
    const price_ngn = hasPickedVariant
      ? p.price
      : fresh
        ? fresh.price_ngn
        : p.price;
    const image_url = fresh?.image_url || p.image_url || null;
    if (p.capture_url && !capture_url) capture_url = p.capture_url;

    const compose = (desc) => {
      const bits = [`*${name}*`];
      if (p.spec) bits.push(p.spec);
      if (desc) bits.push(desc);
      if (price_ngn !== null && price_ngn !== undefined) {
        bits.push(`Price: ${ngn(price_ngn)}`);
      }
      return bits.join("\n");
    };
    let caption = compose(description);
    if (caption.length > maxLen && description) {
      // Trim the DESCRIPTION, never the price line off the bottom.
      const overhead = caption.length - description.length;
      const room = maxLen - overhead - 1;
      caption = compose(
        room > 20 ? `${description.slice(0, room).trimEnd()}…` : null,
      );
    }
    caption = clamp(caption);
    cards.push(
      image_url ? { type: "image", media_url: image_url, caption } : { type: "text", body: caption },
    );
  }

  if (capture_url) {
    cards.push({
      type: "text",
      body: `🛍️ Like anything? Pick your items & order here:\n${capture_url}`,
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
 * Resolve the first attachment on a message for a provider send.
 * Returns the local storage key (`media_key`) so WhatsApp can upload the
 * bytes straight to Meta without the file ever needing to be publicly
 * reachable, plus an absolute `media_url` when one can be built (used by
 * Instagram, which only supports the link method here). Returns null
 * only when there's genuinely no stored file.
 */
async function resolveOutboundMedia(message, client) {
  const rows = await repo.getAttachmentsForSend({
    client,
    message_id: message.message_id,
  });
  const a = rows[0];
  if (!a || !a.file_path) return null;
  const storage = require("../../services/storage.service");
  return {
    media_key: a.file_path,
    media_url: storage.absoluteUrl(a.file_path), // may be null (WhatsApp doesn't need it)
    filename: a.display_name,
    mime_type: a.mime_type,
  };
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
          media_key: media.media_key,
          media_url: media.media_url,
          mime_type: media.mime_type,
          filename: media.filename,
          caption: content || undefined,
        },
      ];
    }
    case "product_share": {
      const cards = await buildProductShareCards({
        business,
        message,
        platform: "whatsapp",
      });
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
    case "template": {
      // Approved-template send (reaches the customer outside the 24h
      // window). The processor branches on `template_name`, so shape the
      // job as { template_name, language_code, components }.
      const meta = message.metadata || {};
      if (!meta.template_name) return [];
      return [
        {
          kind: "template",
          template_name: meta.template_name,
          language_code: meta.language || "en_US",
          components: meta.components || undefined,
        },
      ];
    }
    default:
      return content ? [{ kind: "text", body: content }] : [];
  }
}

/**
 * Translate a posted message on a customer_thread into provider-
 * specific send jobs. Runs INSIDE the posting transaction (all reads
 * and failure markings ride `client`), but returns the jobs instead of
 * enqueueing them — the caller hands them to `flushOutboundJobs` AFTER
 * commit, so a worker can never race the still-open transaction (which
 * used to leave "sent" updates as silent no-ops) and a rollback can
 * never leave a message already delivered to the customer.
 */
async function buildOutboundJobsForChannel({
  channel,
  message,
  content,
  client,
}) {
  const platform = channel.external_platform;
  const meta = channel.metadata || {};
  // Reachability of the customer is captured on the contact, not the
  // channel — channels only know who is in them. Rides `client` so a
  // thread + member created earlier in THIS transaction (first-touch
  // outbound via sendToCustomer) is visible.
  //
  // The IG handle is picked via LATERAL because a contact can carry
  // SEVERAL instagram rows: one IGSID per brand account the person has
  // DMed (they get a different id per account), plus id-less rows typed
  // into the storefront/onboarding forms. The old bare join returned an
  // arbitrary one (LIMIT 1, no ORDER BY) — prefer a row that actually
  // has an external id, newest first, so the fallback is deterministic.
  const member = await ex(client)(
    `SELECT con.contact_id, con.primary_phone, con.whatsapp_number, con.email,
            h.handle AS ig_handle, h.external_user_id AS ig_user_id
       FROM shared.channel_members cm
       LEFT JOIN shared.contacts con ON con.contact_id = cm.contact_id
       LEFT JOIN LATERAL (
         SELECT sh.handle, sh.external_user_id
           FROM shared.contact_social_handles sh
          WHERE sh.contact_id = cm.contact_id AND sh.platform = $2
          ORDER BY (sh.external_user_id IS NOT NULL) DESC,
                   sh.updated_at DESC
          LIMIT 1
       ) h ON true
      WHERE cm.channel_id = $1 AND cm.contact_id IS NOT NULL
      LIMIT 1`,
    [channel.channel_id, "instagram"],
  );
  const c = member.rows[0] || {};

  const fail = async (delivery_error) => {
    await repo.setMessageDelivery({
      client,
      message_id: message.message_id,
      delivery_status: "failed",
      delivery_error,
    });
    return [];
  };

  if (platform === "whatsapp") {
    const to = c.whatsapp_number || c.primary_phone;
    if (!to) return fail("NO_WHATSAPP_NUMBER_ON_FILE");
    const sends = await buildWhatsAppSends(message, content, client, channel.business);
    if (sends.length === 0) return fail("NOTHING_TO_SEND");
    // A product_share fans out into several native bubbles (one photo
    // per product + a closing link) — every job carries the same
    // smartcomm_message_id so any one of them completing marks the
    // message "sent"; only the last to complete's provider ref sticks
    // (fine — the tick reflects the overall share, not one bubble).
    return sends.map((send) => ({
      queue: "whatsapp-send",
      name: "customer-whatsapp",
      data: {
        brand: channel.business,
        to,
        ...send,
        smartcomm_message_id: message.message_id,
        channel_id: channel.channel_id,
      },
    }));
  }

  if (platform === "instagram") {
    // IGSIDs are scoped to ONE Instagram business account: the same
    // customer has a DIFFERENT id for every brand account they message,
    // and Meta rejects an id minted for another account (or a username /
    // form-typed handle) with the opaque "Invalid message id" — code 508,
    // subcode 2534122 — regardless of message content. The thread's own
    // external_thread_ref IS the IGSID that DMed this brand (the inbound
    // webhook stamps it — "IGSID = thread"), so it's the one id
    // guaranteed deliverable on this thread's token. The contact-level
    // handle row is brand-blind (a merged or cross-brand contact carries
    // several) and only serves as a fallback for legacy threads created
    // before the ref was stamped.
    const recipient_id =
      channel.external_thread_ref || c.ig_user_id || meta.ig_user_id;
    if (!recipient_id) return fail("NO_IG_HANDLE_ON_FILE");
    // The 24h-window guard in postMessage marks the message with
    // is_template === true when the operator has opted into a
    // HUMAN_AGENT-tagged reply outside the window — pass that
    // through to the processor so it stamps the Meta MESSAGE_TAG. A NULL
    // window (customer never messaged) counts as outside — an explicit
    // HUMAN_AGENT override still needs the tag.
    const outsideWindow =
      !channel.ig_window_expires_at ||
      new Date(channel.ig_window_expires_at) < new Date();
    let jobPayloads;
    if (
      message.message_type === "image" ||
      message.message_type === "video" ||
      message.message_type === "voice_note" ||
      message.message_type === "document"
    ) {
      const media = await resolveOutboundMedia(message, client);
      // Instagram only supports the link method here, so it still needs a
      // publicly-fetchable URL (unlike WhatsApp's upload-first path).
      if (!media || !media.media_url) return fail("MEDIA_URL_UNAVAILABLE");
      // IG attachments carry no caption field (unlike WhatsApp) — any
      // typed caption goes out as its own text bubble first so it isn't
      // silently dropped.
      jobPayloads = content ? [{ text: content }] : [];
      if (message.message_type === "document") {
        // IG DMs have no document attachment type. Send the file as a
        // downloadable link instead of failing the whole message.
        jobPayloads.push({
          text: `📄 ${media.filename || "File"}: ${media.media_url}`,
        });
      } else {
        // image | video | voice_note → native IG attachment bubble.
        const kind =
          message.message_type === "voice_note"
            ? "audio"
            : message.message_type;
        const jp = { media_kind: kind, media_url: media.media_url };
        // Instagram DM audio only accepts aac/m4a/wav/mp4; browser voice
        // notes are webm/opus, which Meta rejects (code 100, subcode
        // 2534080). Hand the worker the storage key + source mime so it can
        // transcode to m4a before the send (see instagram-processor).
        if (kind === "audio") {
          jp.media_key = media.media_key;
          jp.source_mime = media.mime_type;
        }
        jobPayloads.push(jp);
      }
    } else if (message.message_type === "product_share") {
      // IG image attachments carry no caption field, unlike WhatsApp —
      // each card becomes its own image bubble immediately followed by
      // a name+price text bubble, with the tap-to-order link at the
      // very bottom. Descriptions are dropped because IG DMs cap a
      // single bubble at 1000 chars (code 100 / subcode 2534038) and
      // a fuller card blew that cap on 3+ item shares; buildProduct-
      // ShareCards handles the trim when platform === 'instagram'.
      const cards = await buildProductShareCards({
        business: channel.business,
        message,
        platform: "instagram",
      });
      // Catalogue image URLs are the stored `cdn_url`, which is a RELATIVE
      // `/media/...` path when no CDN is configured. Instagram fetches the
      // URL from Meta's servers, and a relative path is unreachable there —
      // it bounced every catalogue share with "Upload failed" (code 100,
      // subcode 2018007) while the same photo sent as a plain attachment
      // (which already runs through storage.absoluteUrl) went fine, and
      // WhatsApp worked because it uploads the bytes instead of handing
      // Meta a link. Resolve to an absolute URL here so Meta can fetch it.
      const storage = require("../../services/storage.service");
      // Bubble order (top → bottom): [intro?, image1, name1, image2,
      // name2, …, order-link]. The BullMQ worker's concurrency=4 used to
      // race the per-bubble jobs so the customer saw them jumbled — one
      // multi-step job (data.sequence[]) fixes that, the processor sends
      // each step in order and only marks the smartcomm message "sent"
      // after the last step lands.
      const sequence = cards.flatMap((card) =>
        card.type === "image"
          ? [
              { image_url: storage.toAbsoluteMediaUrl(card.media_url) },
              { text: card.caption },
            ]
          : [{ text: card.body }],
      );
      if (sequence.length === 0) return fail("NOTHING_TO_SEND");
      jobPayloads = [{ sequence }];
    } else {
      const body = composeCardText(message, content);
      if (!body) return fail("NOTHING_TO_SEND");
      jobPayloads = [{ text: body }];
    }
    return jobPayloads.map((jobPayload) => ({
      queue: "instagram-send",
      name: "customer-ig",
      data: {
        brand: channel.business,
        recipient_id,
        ...jobPayload,
        tag: outsideWindow ? "HUMAN_AGENT" : undefined,
        smartcomm_message_id: message.message_id,
        channel_id: channel.channel_id,
      },
      // A multi-bubble catalogue sequence is user-visible and NOT
      // idempotent: every retry re-sends every step (customer sees the
      // same product image 3-5 times). Opt out of BullMQ's 5-attempt
      // default; the operator's Retry button on the failed message is
      // the sanctioned re-send path.
      opts: jobPayload.sequence ? { attempts: 1 } : undefined,
    }));
  }

  if (platform === "email") {
    const to = c.email;
    if (!to) return fail("NO_EMAIL_ON_FILE");
    const mmeta = message.metadata || {};
    // Subject: an explicit per-message subject wins, then the thread's
    // stored subject, then a neutral default.
    const subject = mmeta.subject || meta.subject || "A message from us";
    // Cc copy recipients the operator added on this message.
    const cc = normaliseCcList(mmeta.cc);
    // Resolve the message's stored files into mail attachments. Only the
    // storage KEY rides the queue — the email processor loads the bytes at
    // send time (see email.service resolveAttachments), so a large PDF
    // never bloats the Redis job payload.
    const attachmentRows = await repo.getAttachmentsForSend({
      client,
      message_id: message.message_id,
    });
    const attachments = attachmentRows
      .filter((a) => a.file_path)
      .map((a) => ({
        filename: a.display_name || "attachment",
        storage_key: a.file_path,
        content_type: a.mime_type || undefined,
      }));
    // A send with neither a body (plain or rich HTML) nor a file has nothing
    // to deliver.
    const hasHtmlBody = !!(mmeta.body_html && String(mmeta.body_html).trim());
    if (
      !String(content || "").trim() &&
      !hasHtmlBody &&
      attachments.length === 0
    ) {
      return fail("NOTHING_TO_SEND");
    }
    // Brand the body into the house email shell so the reply looks like the
    // brand's other mail. A rich (Gmail-style) send rides HTML in the message
    // metadata; a plain reply just has text.
    const branded = await buildBrandedConversationalEmail({
      brand: channel.business,
      text: content,
      bodyHtml: mmeta.body_html,
    });
    return [
      {
        queue: "email-send",
        name: "customer-email",
        data: {
          to,
          cc: cc.length ? cc : undefined,
          subject,
          html: branded.html,
          text: branded.text,
          attachments: attachments.length ? attachments : undefined,
          in_reply_to: meta.in_reply_to,
          smartcomm_message_id: message.message_id,
          channel_id: channel.channel_id,
          brand: channel.business,
          contact_id: c.contact_id,
          event_key: "smartcomm.email_reply",
        },
      },
    ];
  }
  return [];
}

/** Enqueue the jobs built inside a (now committed) transaction.
 *  `job.opts` (when set) is passed to the BullMQ producer — used, e.g.,
 *  to opt a job out of the default 5-attempt auto-retry when the payload
 *  is user-visible and NOT idempotent (a catalogue-share sequence would
 *  spam the customer with duplicate bubbles on every retry). */
async function flushOutboundJobs(jobs) {
  for (const job of jobs || []) {
    await enqueue(job.queue, job.name, job.data, job.opts);
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
    platform,
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

// Meta CDN hosts an inbound Instagram attachment URL may point at. The
// URL arrives inside a signature-verified webhook so it's trusted in
// principle, but pinning to Meta's CDNs keeps the fetch from ever being
// pointed at internal infrastructure (defence in depth, not the gate).
const META_CDN_HOST_RE =
  /(^|\.)((cdninstagram\.com)|(fbcdn\.net)|(fbsbx\.com)|(instagram\.com)|(facebook\.com))$/i;

/**
 * Fetch an Instagram attachment's bytes from Meta's CDN. IG webhooks
 * carry a short-lived signed URL (unlike WhatsApp's media id), so this
 * is a plain GET — https-only, Meta-CDN-only, size-capped.
 */
async function downloadUrlMedia(url) {
  const axios = require("axios");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`refusing non-https media url (${parsed.protocol})`);
  }
  if (!META_CDN_HOST_RE.test(parsed.hostname)) {
    throw new Error(`refusing non-Meta media host (${parsed.hostname})`);
  }
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    maxContentLength: 50 * 1024 * 1024, // IG caps well below this
    maxRedirects: 3,
  });
  return {
    buffer: Buffer.from(res.data),
    mime_type:
      (res.headers["content-type"] || "").split(";")[0].trim() || null,
  };
}

/**
 * Download an inbound media descriptor and persist it through the
 * documents gateway. WhatsApp descriptors carry a `media_id` (fetched
 * via the Graph media endpoint with the brand token); Instagram
 * descriptors carry a direct CDN `url`. Returns { document_id,
 * display_name } to attach to the recorded message, or null when the
 * media can't be fetched — in which case the message is still recorded
 * (caption/placeholder preserved) so a media hiccup never blocks the
 * inbox.
 */
async function downloadInboundMediaToDocument({ brand, media }) {
  if (!media || (!media.media_id && !media.url)) return null;
  try {
    const documents = require("../../shared/documents/documents.service");
    let dl;
    if (media.media_id) {
      const whatsapp = require("../../services/whatsapp.service");
      dl = await whatsapp.downloadMedia({ brand, media_id: media.media_id });
    } else {
      dl = await downloadUrlMedia(media.url);
    }
    const mime = media.mime_type || dl.mime_type || "application/octet-stream";
    const filename = media.filename || defaultMediaFilename(media.kind, mime);
    const doc = await documents.store({
      brand,
      buffer: dl.buffer,
      mime_type: mime,
      filename,
      document_type:
        media.kind === "image" || media.kind === "sticker" ? "image" : "other",
      title: filename,
      reference_type: "smartcomm_inbound",
    });
    return { document_id: doc.document_id, display_name: filename };
  } catch (err) {
    const { logger } = require("../../config/logger");
    logger.error(
      {
        err: err.message,
        media_id: media.media_id || null,
        has_url: !!media.url,
        kind: media.kind,
        brand,
      },
      "smartcomm: inbound media download failed — recording message without attachment",
    );
    return null;
  }
}

// Fallback filename for inbound media that arrives without one (images,
// video, audio never carry a filename — only documents do). `kind` is
// WhatsApp's raw type (image|video|document|audio|sticker).
function defaultMediaFilename(kind, mime) {
  const ext =
    (mime && mime.includes("/") ? `.${mime.split("/")[1].split(";")[0]}` : "") || "";
  const base = kind === "audio" ? "voice-note" : kind || "media";
  return `${base}${ext}`;
}

/**
 * Record an INBOUND customer message. Bridges Meta webhooks
 * (WhatsApp/Instagram), inbound email, and the social DM ingest route.
 * Idempotent on `external_ref` — re-delivery from the platform is safe.
 *
 * `media` (WhatsApp only) is a { kind, media_id, mime_type, filename }
 * descriptor: the bytes are downloaded from Meta and attached as a
 * document so the inbox shows the real image/video/file instead of a
 * blank "Photo" placeholder.
 */
async function recordInboundFromCustomer({
  brand,
  contact_id,
  platform,
  body,
  message_type = "text",
  external_ref,
  external_thread_ref,
  media,
  metadata,
  // Backfill support (scripts/backfill-instagram-history.js): record the
  // message at its ORIGINAL platform timestamp, and don't wake the whole
  // team with realtime pings + bell notifications for months-old history.
  occurred_at,
  quiet,
}) {
  // Cheap idempotency pre-check BEFORE downloading media: a redelivery of
  // an already-recorded message must not re-fetch (and re-store) the file.
  if (external_ref) {
    const pre = await query(
      `SELECT message_id, channel_id FROM shared.messages
        WHERE external_ref = $1 LIMIT 1`,
      [external_ref],
    );
    if (pre.rows.length) {
      const row = pre.rows[0];
      return { channel_id: row.channel_id, message: row, duplicate: true };
    }
  }
  // Download inbound media (network I/O) outside the transaction so the
  // DB connection isn't held open while we talk to Meta.
  const storedDoc = await downloadInboundMediaToDocument({ brand, media });

  const result = await transaction(async (client) => {
    // Authoritative idempotency: a concurrent delivery may have inserted
    // between the pre-check and here.
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
    // A customer replying to a resolved thread reopens it — otherwise the
    // composer stays hidden (see MessageThread's isResolved gate) and staff
    // have no way to answer a conversation that looked "done".
    if (thread.status === "resolved") {
      await repo.setChannelStatus({
        client,
        id: thread.channel_id,
        status: "open",
      });
      thread.status = "open";
    }
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
        created_at: occurred_at,
      },
    });
    // Link the downloaded media (if any) so the inbox renders the real
    // file instead of a placeholder.
    if (storedDoc) {
      await repo.addAttachment({
        client,
        a: {
          message_id: msg.message_id,
          document_id: storedDoc.document_id,
          display_name: storedDoc.display_name,
        },
      });
    }
    return { channel_id: thread.channel_id, message: msg, duplicate: false };
  });
  // Post-commit: the realtime layer + notification fanout re-read the
  // message row, so the event must never fire while the insert is still
  // invisible to other connections (it used to fire mid-transaction,
  // which made the sender lookup race and misfire notifications).
  if (!result.duplicate && !quiet) {
    events.emit("customer.message_received", {
      brand,
      contact_id,
      channel_id: result.channel_id,
      message_id: result.message.message_id,
      platform,
    });
  }
  return result;
}

/**
 * Record a reply OUR side sent from the platform's own app — today that's
 * a staffer answering an Instagram DM inside the Instagram app instead of
 * the Hub. Meta reports those as message echoes (is_echo) on the same
 * webhook; before this existed they were dropped, so app-side replies
 * were invisible here and three people could answer the same customer.
 *
 * Semantics (deliberate, and the only ones Meta's events allow):
 *   - The reply lands on the customer thread as a business-side bubble
 *     attributed "Instagram app" (no Hub user to credit it to).
 *   - Replying clears the thread's unread badge for the whole team via
 *     the channel's external_read_at watermark — the conversation was
 *     handled, just not here. Merely READING in the Instagram app sends
 *     no webhook at all, so an opened-but-unanswered thread keeps its
 *     badge. That asymmetry is the desired behaviour.
 *
 * Dedup: echoes fire for Hub-sent messages too. findMessageByProviderRef
 * matches the row's external_ref OR a multi-bubble send's sequence_mids,
 * and a still-'queued' Hub send on the same thread defers the ingest
 * (outbox retry) until the provider mid has been stamped back.
 *
 * `occurred_at` + `quiet` serve the history backfill, same as
 * recordInboundFromCustomer.
 */
async function recordAgentReplyFromPlatform({
  brand,
  contact_id,
  platform,
  body,
  message_type = "text",
  external_ref,
  external_thread_ref,
  media,
  metadata,
  occurred_at,
  quiet,
}) {
  // Echo of a message the Hub itself sent — already recorded at send time.
  if (external_ref) {
    const known = await repo.findMessageByProviderRef({ external_ref });
    if (known) {
      return { channel_id: known.channel_id, message: known, duplicate: true };
    }
  }
  // A Hub send still on 'queued' hasn't had its mid stamped back yet, so
  // its echo would look brand-new. Defer — the thrown error rides back to
  // the outbox, which retries with backoff; by then applyDeliveryResult
  // has stamped the mid and the dedup above catches it. Live ingest only:
  // the backfill reads settled history.
  if (!quiet && external_thread_ref) {
    const thread = await repo.findCustomerThreadByExternalRef({
      brand,
      platform,
      external_thread_ref,
    });
    if (
      thread &&
      (await repo.hasRecentQueuedOutbound({ channel_id: thread.channel_id }))
    ) {
      throw new AppError(
        "IG_ECHO_DEFERRED",
        "Echo arrived while a Hub send is in flight — retrying after the mid is stamped",
        503,
      );
    }
  }
  const storedDoc = await downloadInboundMediaToDocument({ brand, media });

  const result = await transaction(async (client) => {
    // Authoritative re-check: a concurrent delivery may have inserted
    // between the pre-check and here.
    if (external_ref) {
      const dup = await client.query(
        `SELECT message_id, channel_id FROM shared.messages
          WHERE external_ref = $1
             OR (metadata ? 'sequence_mids' AND metadata->'sequence_mids' @> to_jsonb($1::text))
          LIMIT 1`,
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
    // The whitelist covers story/share card keys; `via` is stamped
    // unconditionally server-side (no HTTP path reaches here, and the
    // composer's whitelist can't forge it).
    const messageMetadata = sanitiseMessageMetadata(message_type, metadata) || {};
    messageMetadata.via = "instagram_app";
    const msg = await repo.insertMessage({
      client,
      message: {
        channel_id: thread.channel_id,
        message_type,
        content: body,
        external_ref,
        delivery_status: "sent",
        metadata: messageMetadata,
        created_at: occurred_at,
      },
    });
    if (storedDoc) {
      await repo.addAttachment({
        client,
        a: {
          message_id: msg.message_id,
          document_id: storedDoc.document_id,
          display_name: storedDoc.display_name,
        },
      });
    }
    // The team answered — everything up to this reply reads as handled
    // for every staff viewer. Monotonic, so a backfilled old reply can
    // never un-read newer customer messages.
    await repo.markChannelExternallyRead({
      client,
      channel_id: thread.channel_id,
      at: msg.created_at,
    });
    // Only a reply that is (still) the newest thing on the thread consumes
    // its bell notifications — a backfilled reply from before the
    // customer's latest message must leave the bell alone.
    const isLatest =
      !thread.last_message_at ||
      new Date(msg.created_at) >= new Date(thread.last_message_at);
    return { channel_id: thread.channel_id, message: msg, duplicate: false, isLatest };
  });

  if (!result.duplicate && result.isLatest) {
    // Consume the "new message" bell for EVERY user — the thread was
    // answered on the platform. Best-effort, never blocks the ingest.
    try {
      const notifications = require("../../services/notifications.service");
      await notifications.markReadByReferenceAllUsers({
        reference_type: "smartcomm_channel",
        reference_id: result.channel_id,
      });
    } catch {
      /* non-fatal */
    }
  }
  if (!result.duplicate && !quiet) {
    events.emit("customer.replied_externally", {
      brand,
      contact_id,
      channel_id: result.channel_id,
      message_id: result.message.message_id,
      platform,
    });
  }
  return result;
}

/**
 * Record a WhatsApp voice call as a 'call' card on the customer's thread
 * (calls module — migration 000319). Internal only: no HTTP path posts a
 * 'call' message; the calls service stamps the card when a call ends and
 * updates it when the agent records the outcome. The card counts as
 * customer activity so the thread surfaces with an unread badge (a missed
 * call must never be silently buried).
 */
async function recordCallActivity({
  brand,
  contact_id,
  external_thread_ref,
  content,
  metadata,
}) {
  const result = await transaction(async (client) => {
    const thread = await findOrCreateCustomerThread({
      client,
      brand,
      contact_id,
      platform: "whatsapp",
      external_thread_ref,
    });
    const msg = await repo.insertMessage({
      client,
      message: {
        channel_id: thread.channel_id,
        sender_contact_id: contact_id,
        message_type: "call",
        content,
        delivery_status: "delivered",
        metadata: sanitiseMessageMetadata("call", metadata),
      },
    });
    return { channel_id: thread.channel_id, message: msg };
  });
  events.emit("customer.message_received", {
    brand,
    contact_id,
    channel_id: result.channel_id,
    message_id: result.message.message_id,
    platform: "whatsapp",
  });
  return result;
}

/**
 * Refresh a call card after the fact (outcome recorded, duration settled).
 * Merges sanitised metadata and emits message.edited so open threads
 * re-render the card live.
 */
async function updateCallActivity({ message_id, content, metadata }) {
  const clean = sanitiseMessageMetadata("call", metadata);
  const { rows } = await query(
    `UPDATE shared.messages
        SET content = COALESCE($2, content),
            metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($3::jsonb, '{}'::jsonb)
      WHERE message_id = $1 AND message_type = 'call'
      RETURNING channel_id`,
    [message_id, content || null, clean ? JSON.stringify(clean) : null],
  );
  if (rows[0]) {
    events.emit("message.edited", {
      channel_id: rows[0].channel_id,
      message_id,
    });
  }
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
  cc,
  body,
  body_html,
  attachments,
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
  const { thread, msg, jobs } = await transaction(async (client) => {
    const th = await findOrCreateCustomerThread({
      client,
      brand,
      contact_id,
      platform: channel === "email" ? "email" : channel,
    });
    // Stamp the email envelope on the message so buildOutboundJobsForChannel
    // uses THIS send's subject/Cc (a brand-new thread has none on the channel
    // yet — the channel-subject UPDATE below only runs post-commit).
    const ccList = channel === "email" ? normaliseCcList(cc) : [];
    // Attachments and rich HTML are email-only — they ride the one outbound
    // letter. Other channels ignore them.
    const emailFiles = channel === "email" ? attachments || [] : [];
    const richHtml =
      channel === "email" && body_html && String(body_html).trim()
        ? String(body_html)
        : undefined;
    const emailMeta =
      channel === "email" && (subject || ccList.length || richHtml)
        ? {
            ...(subject ? { subject: String(subject).slice(0, 300) } : {}),
            ...(ccList.length ? { cc: ccList } : {}),
            ...(richHtml ? { body_html: richHtml } : {}),
          }
        : undefined;
    const m = await repo.insertMessage({
      client,
      message: {
        channel_id: th.channel_id,
        sender_user_id: user ? user.user_id : null,
        message_type: user ? (emailFiles.length ? "document" : "text") : "system",
        content: body,
        delivery_status: "queued",
        metadata: emailMeta,
      },
    });
    // Stage the files on the message before the outbound job is built —
    // buildOutboundJobsForChannel reads them back (same client) to attach.
    for (const a of emailFiles) {
      await repo.addAttachment({
        client,
        a: {
          message_id: m.message_id,
          document_id: a.document_id,
          display_name: a.display_name,
        },
      });
    }
    const outboundJobs = await buildOutboundJobsForChannel({
      channel: th,
      message: m,
      content: body,
      client,
    });
    return { thread: th, msg: m, jobs: outboundJobs };
  });
  await flushOutboundJobs(jobs);
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
 * Send a rich transactional email (order confirmation, receipt letter, …)
 * AND record it on the contact's email customer thread, so automated
 * brand mail is visible in Messaging → email channel instead of leaving
 * the operator blind to what the customer was sent.
 *
 * Differs from sendToCustomer's email path, which uses one string as BOTH
 * the thread content and the email body: transactional letters are full
 * brand-skinned HTML, so here `html` rides only the email-send job while
 * the thread stores the readable plain-text version (same shape inbound
 * email ingestion stores). Delivery status flips queued → sent/failed via
 * the email processor exactly like a composer send.
 *
 * Never throws — the caller's send must not fail because the mirror did.
 * Returns null when it couldn't queue (caller should fall back to a
 * direct email.send so the customer still gets the mail).
 */
async function sendTransactionalEmail({
  brand,
  contact_id,
  to,
  subject,
  html,
  text,
  event_key,
  reference_type,
  reference_id,
}) {
  if (!brand || !contact_id || !to || !html) return null;
  try {
    const { thread, msg } = await transaction(async (client) => {
      const th = await findOrCreateCustomerThread({
        client,
        brand,
        contact_id,
        platform: "email",
      });
      const m = await repo.insertMessage({
        client,
        message: {
          channel_id: th.channel_id,
          sender_user_id: null,
          message_type: "system",
          content: text || subject || "(email)",
          delivery_status: "queued",
          metadata: {
            subject: subject || null,
            event_key: event_key || null,
            transactional: true,
          },
        },
      });
      return { thread: th, msg: m };
    });
    await enqueue("email-send", event_key || "transactional-email", {
      brand,
      to,
      subject,
      html,
      text,
      smartcomm_message_id: msg.message_id,
      channel_id: thread.channel_id,
      contact_id,
      event_key,
      reference_type,
      reference_id,
    });
    if (subject) {
      await query(
        `UPDATE shared.message_channels
            SET metadata = shared.message_channels.metadata || jsonb_build_object('subject', $2::text)
          WHERE channel_id = $1`,
        [thread.channel_id, subject],
      ).catch(() => null);
    }
    events.emit("customer.message_sent", {
      brand,
      contact_id,
      channel_id: thread.channel_id,
      message_id: msg.message_id,
    });
    return { channel_id: thread.channel_id, message_id: msg.message_id, queued: true };
  } catch (err) {
    const { logger } = require("../../config/logger");
    logger.warn(
      { err: err.message, brand, contact_id, event_key },
      "smartcomm: transactional email mirror failed (caller should send direct)",
    );
    return null;
  }
}

/**
 * Delivery outcome from a queue processor (sent/failed + provider ref).
 * One entry point so every processor both persists the status AND emits
 * message.edited — the open thread used to keep showing the hourglass
 * until the next poll because processors wrote the row silently.
 */
async function applyDeliveryResult({
  message_id,
  delivery_status,
  delivery_error,
  external_ref,
  sequence_mids,
}) {
  const updated = await repo.setMessageDelivery({
    message_id,
    delivery_status,
    delivery_error,
    external_ref,
    sequence_mids,
  });
  if (updated) {
    events.emit("message.edited", {
      channel_id: updated.channel_id,
      message_id,
    });
  }
  return updated;
}

/**
 * Re-queue a failed outbound message (staff hit "Retry" on the bubble).
 * Rebuilds the provider jobs from the stored message + attachments, so
 * a fix in Messaging Settings (fresh token, re-connected account) or on
 * the contact (handle back-filled) is picked up by the retry.
 */
async function retryOutboundMessage({ brand, user, request_id, message_id }) {
  const msg = await repo.getMessage({ id: message_id });
  if (!msg || msg.is_deleted) throw new NotFoundError("Message");
  const channel = await repo.getChannel({ id: msg.channel_id });
  if (!channel) throw new NotFoundError("Channel");
  if (channel.channel_type !== "customer_thread") {
    throw new AppError(
      "NOT_RETRYABLE",
      "Only customer-thread messages can be re-sent",
      400,
    );
  }
  if (msg.delivery_status !== "failed" && msg.delivery_status !== "queued") {
    throw new AppError(
      "NOT_RETRYABLE",
      "This message already reached the provider",
      409,
    );
  }
  if (channel.external_platform) {
    await assertPlatformAccess({
      user,
      brand,
      platform: channel.external_platform,
      action: "reply",
    });
  }
  const jobs = await buildOutboundJobsForChannel({
    channel,
    message: msg,
    content: msg.content,
  });
  if (jobs.length > 0) {
    await repo.setMessageDelivery({
      message_id,
      delivery_status: "queued",
      delivery_error: null,
    });
    await flushOutboundJobs(jobs);
  }
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.message.retry",
    target_type: "message",
    target_id: message_id,
    request_id,
  });
  events.emit("message.edited", {
    channel_id: msg.channel_id,
    message_id,
  });
  // When the job build itself failed (e.g. still no handle on file), the
  // fresh delivery_error is already on the row — surface it to the caller.
  const after = await repo.getMessage({ id: message_id });
  return {
    message_id,
    delivery_status: after.delivery_status,
    delivery_error: after.delivery_error,
    requeued: jobs.length > 0,
  };
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
  const updated = await repo.setMessageDeliveryByExternalRef({
    external_ref,
    delivery_status: status,
    delivery_error: error || null,
  });
  if (updated) {
    events.emit("message.edited", {
      channel_id: updated.channel_id,
      message_id: updated.message_id,
    });
  }
}

/**
 * A customer reacted to (or un-reacted from) one of our messages on
 * WhatsApp / Instagram. These webhook events carry no message body of
 * their own — they used to be ingested as EMPTY inbound bubbles. Stamp
 * the emoji onto the target message's metadata instead, so the thread
 * shows a reaction badge on the bubble the customer actually touched.
 * Keyed by the provider message id (shared.messages.external_ref); a
 * miss (reaction to a message predating the inbox) is a silent no-op.
 */
async function applyCustomerReaction({ external_ref, emoji, action }) {
  if (!external_ref) return;
  const updated = await repo.setCustomerReactionByExternalRef({
    external_ref,
    emoji: action === "unreact" ? null : emoji || "❤️",
  });
  if (updated) {
    events.emit("message.edited", {
      channel_id: updated.channel_id,
      message_id: updated.message_id,
    });
  }
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

// ── Colleague directory ───────────────────────────────────

/** Internal people-picker source (new group / add-to-group). */
function listColleagues({ user, q }) {
  return repo.listColleagues({ q, exclude_user_id: user.user_id });
}

// ── CEO channel-access matrix (SSOT) ──────────────────────
//
// The CEO decides, per employee, which channels they can reach. Backed by
// shared.smartcomm_platform_permissions; enforced by loadPlatformAccess /
// platformAllows above. CEO-only at the route layer.

/**
 * Overview for the settings tab: every colleague plus the grants the CEO has
 * already set (managed users carry a grant map; everyone else shows as
 * "default access" so the picker is a full directory, not just the managed
 * subset).
 */
async function getChannelAccessMatrix({ brand }) {
  const [colleagues, managed] = await Promise.all([
    repo.listColleagues({ limit: 500 }),
    repo.listManagedUsers({ business: brand }),
  ]);
  const managedById = new Map(managed.map((m) => [m.user_id, m.grants]));
  const users = colleagues.map((c) => ({
    user_id: c.user_id,
    display_name: c.display_name,
    avatar_url: c.avatar_url,
    job_title: c.job_title,
    department: c.department,
    managed: managedById.has(c.user_id),
    channels: normaliseGrants(managedById.get(c.user_id)),
  }));
  return { platforms: ACCESS_PLATFORMS, users };
}

/**
 * The requesting user's OWN effective channel visibility — the map the admin
 * UI reads to hide inbox tabs a user can't reach (someone without WhatsApp
 * access never sees the WhatsApp tab). Unlike the CEO matrix endpoints this is
 * self-only, so it rides the plain `smartcomm.view` gate rather than requireCeo.
 *
 * Returns `{ ceo, managed, platforms: { <platform>: <can_view bool> } }`,
 * derived from the same loadPlatformAccess / platformAllows rules the inbox
 * list filter uses, so the visible tabs always match the channels the list
 * would actually return. CEO sees every channel.
 */
async function getMyChannelAccess({ user, brand }) {
  const platforms = {};
  if (isCeo(user)) {
    for (const p of ACCESS_PLATFORMS) platforms[p] = true;
    return { ceo: true, managed: false, platforms };
  }
  const access = await loadPlatformAccess({ user, brand });
  for (const p of ACCESS_PLATFORMS) {
    platforms[p] = platformAllows(access, p, "view");
  }
  return { ceo: false, managed: access.managed, platforms };
}

/** One user's effective per-channel grants (for the editor). */
async function getUserChannelAccess({ brand, user_id }) {
  const rows = await repo.listPlatformPermissionsForUser({
    user_id,
    business: brand,
  });
  return {
    user_id,
    managed: rows.length > 0,
    channels: normaliseGrants(
      rows.map((r) => ({
        platform: r.platform,
        can_view: r.can_view,
        can_reply: r.can_reply,
        can_send_template: r.can_send_template,
        can_close: r.can_close,
      })),
    ),
  };
}

/**
 * Turn a sparse grant list into the full { platform: {…} } shape the UI
 * renders, filling defaults for platforms the CEO hasn't set yet. Internal
 * defaults to granted; external platforms default to granted ONLY when the
 * user is unmanaged (mirrors platformAllows so the UI shows the truth).
 */
function normaliseGrants(grants) {
  const managed = Array.isArray(grants) && grants.length > 0;
  const byPlatform = {};
  for (const g of grants || []) byPlatform[g.platform] = g;
  const out = {};
  for (const platform of ACCESS_PLATFORMS) {
    const g = byPlatform[platform];
    if (g) {
      out[platform] = {
        can_view: !!g.can_view,
        can_reply: !!g.can_reply,
        can_send_template: !!g.can_send_template,
        can_close: !!g.can_close,
      };
    } else {
      const on = platform === "internal" ? true : !managed;
      out[platform] = {
        can_view: on,
        can_reply: on,
        can_send_template: false,
        can_close: on,
      };
    }
  }
  return out;
}

/**
 * Persist a user's full channel-access state (all platforms at once). Writing
 * explicit rows makes the user "managed", flipping external channels to the
 * allowlist. Passing reset=true clears every grant, returning them to the
 * default (view-all) posture.
 */
async function setUserChannelAccess({
  brand,
  actor,
  request_id,
  user_id,
  channels,
  reset,
}) {
  if (reset) {
    await repo.deletePlatformPermissionsForUser({ user_id, business: brand });
  } else {
    for (const platform of ACCESS_PLATFORMS) {
      const g = (channels && channels[platform]) || {};
      const can_view = !!g.can_view;
      await repo.upsertPlatformPermission({
        user_id,
        business: brand,
        platform,
        can_view,
        // Sub-permissions only make sense when the channel is visible.
        can_reply: can_view && !!g.can_reply,
        can_send_template: can_view && !!g.can_send_template,
        can_close: can_view && !!g.can_close,
        updated_by: actor.user_id,
      });
    }
  }
  await audit({
    business: brand,
    user_id: actor.user_id,
    action_key: "smartcomm.channel_access.set",
    target_type: "user",
    target_id: user_id,
    after: reset ? { reset: true } : channels,
    request_id,
    is_sensitive: true,
  });
  events.emit("channel_access.changed", { brand, user_id });
  return getUserChannelAccess({ brand, user_id });
}

/**
 * Upload an inline image for the Gmail-style email composer (drag/drop or
 * pick) and return a public URL to embed in the mail HTML. Mirrors the
 * marketing mail editor's upload, but keyed under the messaging namespace so
 * a rep who can reply — not necessarily a marketing officer — can use it.
 */
async function uploadImage({ brand, file }) {
  if (!file || !file.buffer || !file.buffer.length) {
    throw new AppError("NO_FILE", "No image was uploaded", 400);
  }
  const { compressUpload } = require("../../services/media-compression.service");
  const storage = require("../../services/storage.service");
  const crypto = require("crypto");
  const shrunk = await compressUpload(file);
  if (!/^image\//.test(shrunk.mime_type || "")) {
    throw new AppError("BAD_FILE_TYPE", "Only image files are allowed", 400);
  }
  const ext =
    String(shrunk.filename || "")
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 5) || "jpg";
  const key = `messaging/${brand}/${crypto.randomBytes(12).toString("hex")}.${ext}`;
  const stored = await storage.put(shrunk.buffer, {
    key,
    contentType: shrunk.mime_type,
  });
  return { url: stored.public_url };
}

module.exports = {
  listChannels,
  getChannel,
  createChannel,
  getOrCreateDirect,
  archiveChannel,
  resolveThread,
  reopenThread,
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
  getComposerSettings,
  updateComposerSettings,
  sendToCustomer,
  sendTransactionalEmail,
  sendInvoiceIntoThread,
  recordInboundFromCustomer,
  recordAgentReplyFromPlatform,
  findOrCreateCustomerThread,
  addAttachment,
  // exposed for the calls module (voice-call timeline cards):
  recordCallActivity,
  updateCallActivity,
  // exposed for webhook subscriber + queue processors:
  buildOutboundJobsForChannel,
  flushOutboundJobs,
  applyProviderStatus,
  applyCustomerReaction,
  applyDeliveryResult,
  retryOutboundMessage,
  assertPlatformAccess,
  // colleague directory + CEO channel-access matrix
  listColleagues,
  getChannelAccessMatrix,
  getMyChannelAccess,
  getUserChannelAccess,
  setUserChannelAccess,
};
