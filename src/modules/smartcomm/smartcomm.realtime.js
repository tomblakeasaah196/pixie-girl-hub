/**
 * Smartcomm realtime — bridge domain events to Socket.io rooms.
 *
 * Domain events fire from smartcomm.service via smartcomm.events. This
 * subscriber turns each into a Socket.io emit into the right room:
 *
 *   message.posted       → channel:{id}   (everyone in the thread)
 *                           + user:{member_id}:messages (per-member fanout for badges)
 *                           + brand:{key}:smartcomm   (brand-wide unread tickers)
 *   message.edited       → channel:{id}
 *   message.deleted      → channel:{id}
 *   message.reacted      → channel:{id}
 *   message.forwarded    → channel:{id}    (the destination thread)
 *   channel.created      → brand:{key}:smartcomm
 *   channel.archived     → brand:{key}:smartcomm
 *   channel.unarchived   → brand:{key}:smartcomm
 *   thread.resolved      → channel:{id} + brand:{key}:smartcomm
 *   thread.assigned      → channel:{id} + brand:{key}:smartcomm
 *                           + user:{new_assignee}:messages
 *   channel.read         → channel:{id}     (other devices clear unread)
 *   customer.message_received → channel:{id} + brand:{key}:smartcomm
 *                                + each member's user:{uid}:messages
 *   customer.message_sent     → channel:{id}
 *
 * The fanout intentionally hits each member's user:{uid}:messages room
 * so the badge in the floating launcher updates without a per-channel
 * subscription on every open conversation. Member resolution is one
 * cheap indexed read; we don't ship attachments through the socket
 * payload (clients re-query the message by id).
 */

"use strict";

const events = require("./smartcomm.events");
const { query } = require("../../config/database");
const { getBroadcaster } = require("../../realtime/emitter");
const { logger } = require("../../config/logger");
const notifications = require("../../services/notifications.service");

let registered = false;

function emit(room, event, payload) {
  try {
    getBroadcaster().to(room).emit(event, payload);
  } catch (err) {
    // Redis unavailable (tests/scripts without initRedis) — skip silently.
    logger.debug(
      { err: err.message, room, event },
      "smartcomm realtime emit skipped",
    );
  }
}

async function membersOf(channel_id) {
  try {
    const { rows } = await query(
      `SELECT user_id FROM shared.channel_members
        WHERE channel_id = $1 AND user_id IS NOT NULL`,
      [channel_id],
    );
    return rows.map((r) => r.user_id);
  } catch (err) {
    logger.warn(
      { err: err.message, channel_id },
      "smartcomm realtime: members lookup failed",
    );
    return [];
  }
}

async function channelBrand(channel_id) {
  try {
    const { rows } = await query(
      `SELECT business FROM shared.message_channels WHERE channel_id = $1`,
      [channel_id],
    );
    return rows[0] ? rows[0].business : null;
  } catch {
    return null;
  }
}

/**
 * One round-trip of everything the notification needs: sender identity
 * (staff name / contact name / platform handle), the message body +
 * type for the preview line, and the channel's platform + brand.
 * Called AFTER the posting transaction commits (the service emits its
 * events post-commit), so the row is always visible here.
 */
async function messageContext(message_id) {
  try {
    const { rows } = await query(
      `SELECT m.sender_user_id, m.sender_contact_id, m.content, m.message_type,
              m.channel_id,
              COALESCE(u.display_name,
                       NULLIF(con.display_name, 'New contact'),
                       h.display_name, h.handle,
                       con.display_name) AS sender_name,
              c.channel_type, c.external_platform, c.business, c.name AS channel_name,
              c.assigned_to
         FROM shared.messages m
         JOIN shared.message_channels c ON c.channel_id = m.channel_id
         LEFT JOIN shared.users u ON u.user_id = m.sender_user_id
         LEFT JOIN shared.contacts con ON con.contact_id = m.sender_contact_id
         LEFT JOIN LATERAL (
           SELECT sh.display_name, sh.handle
             FROM shared.contact_social_handles sh
            WHERE sh.contact_id = m.sender_contact_id
              AND (c.external_platform IS NULL OR sh.platform = c.external_platform)
            ORDER BY sh.updated_at DESC
            LIMIT 1
         ) h ON m.sender_contact_id IS NOT NULL
        WHERE m.message_id = $1`,
      [message_id],
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

const PLATFORM_LABEL = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "Email",
};

// A one-line "heads-up of what's in the message" per message type. Text
// bodies are trimmed to keep the toast/panel row readable.
function previewOf(ctx) {
  const text = (ctx.content || "").replace(/\s+/g, " ").trim();
  const clip = (s) => (s.length > 140 ? `${s.slice(0, 139)}…` : s);
  switch (ctx.message_type) {
    case "image":
      return text ? `📷 ${clip(text)}` : "📷 Photo";
    case "video":
      return text ? `🎥 ${clip(text)}` : "🎥 Video";
    case "voice_note":
      return "🎤 Voice note";
    case "document":
      return text ? `📄 ${clip(text)}` : "📄 File";
    case "product_share":
      return "🛍️ Shared products from the catalogue";
    case "send_invoice":
      return "🧾 Invoice";
    case "template":
      return text ? clip(text) : "Template message";
    case "ig_story_mention":
      return "📖 Mentioned you in a story";
    case "ig_story_reply":
      return text ? `📖 Story reply: ${clip(text)}` : "📖 Replied to your story";
    case "call":
      return `📞 ${clip(text) || "Call"}`;
    default:
      return clip(text) || "New message";
  }
}

async function hasUnreadNotification({ user_id, channel_id }) {
  try {
    const { rows } = await query(
      `SELECT 1 FROM shared.notifications
        WHERE user_id = $1 AND reference_type = 'smartcomm_channel'
          AND reference_id = $2 AND is_read = false
        LIMIT 1`,
      [user_id, channel_id],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Who should hear about a new CUSTOMER message on this thread? Customer
 * threads carry no staff membership rows until someone opens them, so
 * "notify the members" notified nobody on a brand-new conversation.
 * The audience is: staff who've engaged the thread (member rows),
 * the assigned agent, every CEO, and every user the CEO explicitly
 * granted can_view on this platform × brand — minus anyone who muted
 * the thread. Inactive accounts never receive anything.
 */
async function customerThreadAudience({ channel_id, brand, platform }) {
  try {
    const { rows } = await query(
      `SELECT u.user_id
         FROM shared.users u
        WHERE u.is_active = true
          AND (
            u.is_ceo = true
            OR EXISTS (SELECT 1 FROM shared.channel_members cm
                        WHERE cm.channel_id = $1 AND cm.user_id = u.user_id)
            OR EXISTS (SELECT 1 FROM shared.message_channels mc
                        WHERE mc.channel_id = $1 AND mc.assigned_to = u.user_id)
            OR ($3::text IS NOT NULL AND EXISTS (
                  SELECT 1 FROM shared.smartcomm_platform_permissions p
                   WHERE p.user_id = u.user_id AND p.business = $2
                     AND p.platform = $3 AND p.can_view = true))
          )
          AND NOT EXISTS (SELECT 1 FROM shared.channel_members mm
                           WHERE mm.channel_id = $1 AND mm.user_id = u.user_id
                             AND mm.muted_until IS NOT NULL
                             AND mm.muted_until > now())`,
      [channel_id, brand, platform || null],
    );
    return rows.map((r) => r.user_id);
  } catch (err) {
    logger.warn(
      { err: err.message, channel_id },
      "smartcomm: audience lookup failed",
    );
    return [];
  }
}

/**
 * Fan a "new message" notification out through the shared notifications
 * pipeline (toast/sound/push/tab-badge). The title carries the SENDER +
 * CHANNEL ("Ada Obi · Instagram"), the body a preview of the message —
 * no more anonymous "New message from Someone". The sender themself is
 * never notified (self-toasts on send were the old inverted behaviour).
 * Deduped to one unread notification per channel per user so a burst of
 * messages doesn't fire a sound/push per message; opening the thread
 * marks it read (smartcomm.markRead), re-arming the next one.
 */
async function notifyNewMessage({ channel_id, brand, members, message_id }) {
  const ctx = await messageContext(message_id);
  if (!ctx) return;
  const senderName =
    ctx.sender_name ||
    (ctx.sender_contact_id ? "Customer" : ctx.sender_user_id ? "A teammate" : "System");
  const channelLabel =
    ctx.channel_type === "customer_thread"
      ? PLATFORM_LABEL[ctx.external_platform] || "Customer chat"
      : ctx.channel_name || (ctx.channel_type === "group" ? "Group chat" : "Direct message");

  let recipients;
  if (ctx.channel_type === "customer_thread" && ctx.sender_contact_id) {
    // Inbound from the customer — widen beyond the (often empty) member
    // list so the team actually hears about it.
    recipients = await customerThreadAudience({
      channel_id,
      brand: brand || ctx.business,
      platform: ctx.external_platform,
    });
  } else {
    recipients = members;
  }

  for (const uid of recipients) {
    if (!uid || uid === ctx.sender_user_id) continue;
    try {
      if (await hasUnreadNotification({ user_id: uid, channel_id })) continue;
      await notifications.notify({
        user_id: uid,
        business: brand || ctx.business,
        type: "message",
        title: `${senderName} · ${channelLabel}`,
        body: previewOf(ctx),
        priority: "normal",
        reference_type: "smartcomm_channel",
        reference_id: channel_id,
        action_url: `/smartcomm?channel=${channel_id}`,
      });
    } catch (err) {
      logger.debug(
        { err: err.message, channel_id, uid },
        "smartcomm: message notification skipped",
      );
    }
  }
}

function register() {
  if (registered) return;
  registered = true;

  events.on("message.posted", async (p) => {
    const [members, brand] = await Promise.all([
      membersOf(p.channel_id),
      p.brand ? Promise.resolve(p.brand) : channelBrand(p.channel_id),
    ]);
    emit(`channel:${p.channel_id}`, "message.posted", {
      channel_id: p.channel_id,
      message_id: p.message_id,
    });
    if (brand) {
      emit(`brand:${brand}:smartcomm`, "message.posted", {
        channel_id: p.channel_id,
        message_id: p.message_id,
        external_platform: p.external_platform || null,
      });
    }
    for (const uid of members) {
      emit(`user:${uid}:messages`, "message.posted", {
        channel_id: p.channel_id,
        message_id: p.message_id,
      });
    }
    notifyNewMessage({
      channel_id: p.channel_id,
      brand,
      members,
      message_id: p.message_id,
    }).catch(() => {});
  });

  events.on("message.edited", (p) => {
    emit(`channel:${p.channel_id}`, "message.edited", {
      channel_id: p.channel_id,
      message_id: p.message_id,
    });
  });

  // Customer touched an order link (opened / cart change / ordered) —
  // the sidebar's activity panel refetches on this ping.
  events.on("order_link.activity", (p) => {
    if (!p.channel_id) return;
    emit(`channel:${p.channel_id}`, "order_link.activity", {
      channel_id: p.channel_id,
      link_id: p.link_id,
      status: p.status,
    });
    if (p.brand) {
      emit(`brand:${p.brand}:smartcomm`, "order_link.activity", {
        channel_id: p.channel_id,
        link_id: p.link_id,
        status: p.status,
      });
    }
  });

  events.on("message.deleted", (p) => {
    emit(`channel:${p.channel_id}`, "message.deleted", {
      channel_id: p.channel_id,
      message_id: p.message_id,
    });
  });

  events.on("message.reacted", (p) => {
    if (!p.channel_id) return;
    emit(`channel:${p.channel_id}`, "message.reacted", {
      channel_id: p.channel_id,
      message_id: p.message_id,
      emoji: p.emoji,
      user_id: p.user_id,
      added: p.added,
    });
  });

  events.on("message.forwarded", (p) => {
    emit(`channel:${p.to_channel_id}`, "message.posted", {
      channel_id: p.to_channel_id,
      message_id: p.new_message_id,
    });
  });

  events.on("channel.created", async (p) => {
    const brand = await channelBrand(p.channel_id);
    if (brand)
      emit(`brand:${brand}:smartcomm`, "channel.created", {
        channel_id: p.channel_id,
      });
  });

  events.on("channel.archived", async (p) => {
    const brand = await channelBrand(p.channel_id);
    if (brand)
      emit(`brand:${brand}:smartcomm`, "channel.archived", {
        channel_id: p.channel_id,
      });
  });

  events.on("channel.unarchived", async (p) => {
    const brand = await channelBrand(p.channel_id);
    if (brand)
      emit(`brand:${brand}:smartcomm`, "channel.unarchived", {
        channel_id: p.channel_id,
      });
  });

  events.on("thread.resolved", async (p) => {
    const brand = await channelBrand(p.channel_id);
    emit(`channel:${p.channel_id}`, "thread.resolved", {
      channel_id: p.channel_id,
    });
    if (brand)
      emit(`brand:${brand}:smartcomm`, "thread.resolved", {
        channel_id: p.channel_id,
      });
  });

  events.on("thread.reopened", async (p) => {
    const brand = await channelBrand(p.channel_id);
    emit(`channel:${p.channel_id}`, "thread.reopened", {
      channel_id: p.channel_id,
    });
    if (brand)
      emit(`brand:${brand}:smartcomm`, "thread.reopened", {
        channel_id: p.channel_id,
      });
  });

  events.on("thread.assigned", async (p) => {
    const brand = await channelBrand(p.channel_id);
    emit(`channel:${p.channel_id}`, "thread.assigned", {
      channel_id: p.channel_id,
      assigned_to: p.assigned_to,
    });
    if (brand)
      emit(`brand:${brand}:smartcomm`, "thread.assigned", {
        channel_id: p.channel_id,
        assigned_to: p.assigned_to,
      });
    if (p.assigned_to) {
      emit(`user:${p.assigned_to}:messages`, "thread.assigned", {
        channel_id: p.channel_id,
      });
    }
  });

  events.on("channel.read", (p) => {
    // The channel room broadcasts include the message ids whose
    // delivery_status just advanced to 'read'. The reader themself
    // doesn't care (nothing of theirs transitions from their own read),
    // but every SENDER whose bubble is in that list flips their tick
    // from one grey check to two blue checks on the next messages
    // refetch — see the frontend useChannelRealtime handler.
    emit(`channel:${p.channel_id}`, "channel.read", {
      channel_id: p.channel_id,
      user_id: p.user_id,
      delivered_message_ids: p.delivered_message_ids || [],
      at: new Date().toISOString(),
    });
    // Notify SENDERs directly in case they're on the messaging shell
    // but don't currently have the channel room open (composer closed
    // but launcher badge visible) so their inbox row can drop its
    // unread state cleanly.
    for (const uid of p.sender_user_ids || []) {
      if (!uid || uid === p.user_id) continue;
      emit(`user:${uid}:messages`, "channel.read", {
        channel_id: p.channel_id,
      });
    }
    emit(`user:${p.user_id}:messages`, "channel.read", {
      channel_id: p.channel_id,
    });
  });

  events.on("customer.message_received", async (p) => {
    const members = await membersOf(p.channel_id);
    emit(`channel:${p.channel_id}`, "message.posted", {
      channel_id: p.channel_id,
      message_id: p.message_id,
    });
    if (p.brand)
      emit(`brand:${p.brand}:smartcomm`, "customer.message_received", {
        channel_id: p.channel_id,
        platform: p.platform,
      });
    for (const uid of members) {
      emit(`user:${uid}:messages`, "message.posted", {
        channel_id: p.channel_id,
        message_id: p.message_id,
      });
    }
    notifyNewMessage({
      channel_id: p.channel_id,
      brand: p.brand,
      members,
      message_id: p.message_id,
    }).catch(() => {});
  });

  events.on("customer.message_sent", (p) => {
    emit(`channel:${p.channel_id}`, "message.posted", {
      channel_id: p.channel_id,
      message_id: p.message_id,
    });
  });

  // A staffer answered this thread from the platform's own app (Instagram)
  // — the echo ingest recorded the bubble and cleared the unread state.
  // Same fanout as an inbound customer message (open threads render the
  // reply, inbox rows re-sort, badges recount) but with NO notification:
  // the team must not be pinged about a conversation that was just
  // handled. The bell entries it consumed were cleared via
  // notifications.markReadByReferenceAllUsers, which emits its own
  // notification:read.
  events.on("customer.replied_externally", async (p) => {
    const members = await membersOf(p.channel_id);
    emit(`channel:${p.channel_id}`, "message.posted", {
      channel_id: p.channel_id,
      message_id: p.message_id,
    });
    if (p.brand)
      emit(`brand:${p.brand}:smartcomm`, "customer.replied_externally", {
        channel_id: p.channel_id,
        platform: p.platform,
      });
    for (const uid of members) {
      emit(`user:${uid}:messages`, "message.posted", {
        channel_id: p.channel_id,
        message_id: p.message_id,
      });
      // Their unread for this thread just dropped — nudge the badge query.
      emit(`user:${uid}:messages`, "channel.read", {
        channel_id: p.channel_id,
      });
    }
  });

  logger.info("smartcomm realtime subscribers registered");
}

register();

module.exports = { register };
