/**
 * Canonical real-time room names.
 *
 * All Socket.io rooms used by the application MUST come from this file.
 * The frontend has a mirror list — keep them in sync.
 *
 * Naming convention:
 *   brand:<key>:<resource>[:<id>]   — per-brand resources
 *   user:<uuid>:<channel>           — per-user push channels
 *   system:<channel>                — global broadcasts (CEO-only by default)
 */

"use strict";

const { BRANDS } = require("../config/brands");

const ROOMS = {
  // Brand-scoped resource streams
  stock: (brand) => `brand:${brand}:stock`,
  deliveries: (brand) => `brand:${brand}:deliveries`,
  service_jobs: (brand) => `brand:${brand}:service_jobs`,
  pos_session: (brand, sessionId) => `brand:${brand}:pos_session:${sessionId}`,
  campaign_live: (brand, campaignId) => `brand:${brand}:campaign:${campaignId}`,
  order_timeline_public: (brand, token) =>
    `brand:${brand}:order_timeline:${token}`,
  approvals: (brand) => `brand:${brand}:approvals`,

  // User-scoped push channels
  user_notifications: (userId) => `user:${userId}:notifications`,
  user_ai_pending: (userId) => `user:${userId}:ai_pending`,
  user_tasks: (userId) => `user:${userId}:tasks`,
  user_messages: (userId) => `user:${userId}:messages`,

  // Smartcomm — one room per channel for typing/presence/new-message
  // fanout, plus a per-brand inbox room for unread-count and per-platform
  // badges. Members join the channel room when they open the thread;
  // every brand member joins the inbox room while authenticated.
  channel: (channelId) => `channel:${channelId}`,
  channel_typing: (channelId) => `channel:${channelId}:typing`,
  brand_smartcomm: (brand) => `brand:${brand}:smartcomm`,

  // System-wide (CEO/admin)
  ai_usage_meter: "system:ai_usage_meter",
  health: "system:health",
};

module.exports = { BRANDS, ROOMS };
