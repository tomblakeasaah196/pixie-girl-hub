/**
 * Notifications (V2.2) — HTTP controller. Personal to the authenticated user
 * (no permission gate beyond auth — you only ever see your own).
 */

"use strict";

const service = require("../../services/notifications.service");
const { parsePagination } = require("../../utils/pagination");

async function list(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.list({
      user_id: req.user.user_id,
      only_unread: req.query.unread === "true",
      page,
      page_size,
    }),
  );
}

async function unreadCount(req, res) {
  res.json({
    data: { unread: await service.unreadCount({ user_id: req.user.user_id }) },
  });
}

async function markRead(req, res) {
  const n = await service.markRead({
    user_id: req.user.user_id,
    id: req.params.id,
  });
  res.json({ data: n });
}

async function markAllRead(req, res) {
  res.json({ data: await service.markAllRead({ user_id: req.user.user_id }) });
}

async function getPreferences(req, res) {
  res.json({ data: await service.getPreferences({ user_id: req.user.user_id }) });
}

async function upsertPreference(req, res) {
  const { notification_type } = req.params;
  const pref = await service.upsertPreference({ user_id: req.user.user_id, notification_type, ...req.body });
  res.json({ data: pref });
}

module.exports = { list, unreadCount, markRead, markAllRead, getPreferences, upsertPreference };
