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
  });

  events.on("message.edited", (p) => {
    emit(`channel:${p.channel_id}`, "message.edited", {
      channel_id: p.channel_id,
      message_id: p.message_id,
    });
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
    emit(`channel:${p.channel_id}`, "channel.read", {
      channel_id: p.channel_id,
      user_id: p.user_id,
      at: new Date().toISOString(),
    });
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
  });

  events.on("customer.message_sent", (p) => {
    emit(`channel:${p.channel_id}`, "message.posted", {
      channel_id: p.channel_id,
      message_id: p.message_id,
    });
  });

  logger.info("smartcomm realtime subscribers registered");
}

register();

module.exports = { register };
