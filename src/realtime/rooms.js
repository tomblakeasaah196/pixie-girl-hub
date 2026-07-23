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
  // Sales order/quotation lifecycle — the Sales board & KPI tiles re-read when
  // an order is created/paid/cancelled anywhere (POS, storefront, campaign).
  sales: (brand) => `brand:${brand}:sales`,
  // Customer onboarding — a public capture-link (Quick Sale's QR code, the
  // walk-in counter link, an online link) being submitted. Quick Sale
  // matches the submission_id against the link it minted to auto-select the
  // resulting contact the instant the customer finishes the form.
  customer_onboarding: (brand) => `brand:${brand}:customer_onboarding`,
  deliveries: (brand) => `brand:${brand}:deliveries`,
  service_jobs: (brand) => `brand:${brand}:service_jobs`,
  pos_session: (brand, sessionId) => `brand:${brand}:pos_session:${sessionId}`,
  campaign_live: (brand, campaignId) => `brand:${brand}:campaign:${campaignId}`,
  order_timeline_public: (brand, token) =>
    `brand:${brand}:order_timeline:${token}`,
  // Shade Finder guest chat — PUBLIC namespace (/public) only; the socket
  // auto-joins its own session room after guest-token auth (no 'join' verb).
  shade_session: (brand, sessionId) =>
    `brand:${brand}:shade_session:${sessionId}`,
  approvals: (brand) => `brand:${brand}:approvals`,
  insights: (brand) => `brand:${brand}:insights`,
  // Live attendance — a clock-in/out pushes a ready-to-render row here so the
  // Attendance tab updates in real time (no waiting for the nightly reconcile).
  attendance: (brand) => `brand:${brand}:attendance`,
  // HR device-binding feed — enroll/remove/unknown-device flags fan out here
  // so the HR & Staff "Devices" view updates live.
  hr_devices: (brand) => `brand:${brand}:hr_devices`,

  // User-scoped push channels
  user_notifications: (userId) => `user:${userId}:notifications`,
  user_ai_pending: (userId) => `user:${userId}:ai_pending`,
  user_tasks: (userId) => `user:${userId}:tasks`,
  user_messages: (userId) => `user:${userId}:messages`,
  // Chief of Staff — goal health + accountability follow-up updates (PR4).
  user_goals: (userId) => `user:${userId}:goals`,

  // Smartcomm — one room per channel for typing/presence/new-message
  // fanout, plus a per-brand inbox room for unread-count and per-platform
  // badges. Members join the channel room when they open the thread;
  // every brand member joins the inbox room while authenticated.
  channel: (channelId) => `channel:${channelId}`,
  channel_typing: (channelId) => `channel:${channelId}:typing`,
  brand_smartcomm: (brand) => `brand:${brand}:smartcomm`,

  // WhatsApp voice calls — brand-wide ring/stop fanout, plus a per-user
  // channel for the owner-first ring window. Agents with Messaging access
  // join both while authenticated (see the frontend CallLayer).
  brand_calls: (brand) => `brand:${brand}:calls`,
  user_calls: (userId) => `user:${userId}:calls`,

  // System-wide (CEO/admin)
  ai_usage_meter: "system:ai_usage_meter",
  health: "system:health",
};

module.exports = { BRANDS, ROOMS };
