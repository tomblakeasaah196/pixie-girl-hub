/**
 * Notifications (V2.2) — HTTP controller. Personal to the authenticated user
 * (no permission gate beyond auth — you only ever see your own).
 */

"use strict";

const service = require("../../services/notifications.service");
const { parsePagination } = require("../../utils/pagination");

async function list(req, res) {
  const { page, page_size } = parsePagination(req.query);
  const r = await service.list({
    user_id: req.user.user_id,
    only_unread: req.query.unread === "true",
    business: req.query.business || req.brand || null,
    page,
    page_size,
  });
  // House pagination envelope ({data, meta} — see docs/API_CONVENTIONS). The
  // admin api client auto-unwraps bare {data} payloads but PRESERVES envelopes
  // carrying `meta`; the old flat {data, page, total} shape was unwrapped to a
  // bare array in the browser, so the bell dropdown, the notifications page and
  // the Command Center all rendered empty even while the unread badge showed a
  // count (the /unread-count endpoint is already {data:{unread}}).
  res.json({
    data: r.data,
    meta: {
      page: r.page,
      page_size: r.page_size,
      total: r.total,
      has_more: r.page * r.page_size < r.total,
    },
  });
}

async function unreadCount(req, res) {
  res.json({
    data: {
      unread: await service.unreadCount({
        user_id: req.user.user_id,
        business: req.query.business || req.brand || null,
      }),
    },
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
  res.json({
    data: await service.markAllRead({
      user_id: req.user.user_id,
      business: req.body?.business || req.brand || null,
    }),
  });
}

async function deleteOne(req, res) {
  res.json({
    data: await service.deleteOne({
      user_id: req.user.user_id,
      id: req.params.id,
    }),
  });
}

async function bulkDelete(req, res) {
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: { message: "ids must be an array" } });
  }
  res.json({
    data: await service.bulkDelete({ user_id: req.user.user_id, ids }),
  });
}

async function getPreferences(req, res) {
  res.json({
    data: await service.getPreferences({ user_id: req.user.user_id }),
  });
}

async function upsertPreference(req, res) {
  const { notification_type } = req.params;
  const pref = await service.upsertPreference({
    user_id: req.user.user_id,
    notification_type,
    ...req.body,
  });
  res.json({ data: pref });
}

module.exports = {
  list,
  unreadCount,
  markRead,
  markAllRead,
  deleteOne,
  bulkDelete,
  getPreferences,
  upsertPreference,
};
