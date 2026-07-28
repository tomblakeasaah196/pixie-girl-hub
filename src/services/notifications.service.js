/**
 * Centralised notification service — writes to shared.notifications and pushes
 * over socket.io + web-push. Columns match the schema (000004): user_id,
 * business, type, priority, title, body, reference_type, reference_id,
 * action_url, is_read.
 */

"use strict";

const { query } = require("../config/database");
const { getBroadcaster } = require("../realtime/emitter");
const { ROOMS } = require("../realtime/rooms");
const { deepLinkFor } = require("../shared/links/deep-links");

const VALID_PRIORITY = new Set(["low", "normal", "high", "urgent"]);

// Channel → preference column. Whitelist: `channel` is interpolated into SQL in
// isChannelEnabled, so it must never come from an untrusted source unchecked.
const CHANNEL_COLUMN = {
  in_app: "in_app",
  email: "email_enabled",
  whatsapp: "whatsapp_enabled",
  sms: "sms_enabled",
  push: "push_enabled",
};

/**
 * Create an in-app notification for a user (+ realtime push). Safe to call
 * from request or worker context; a socket gap is ignored.
 *
 * `actions` (optional) is a `[{label, value, endpoint}]` array persisted on the
 * row and surfaced as inline buttons in the notifications UI — used by the CoS
 * accountability loop (Done / In-Progress / Delayed). Defaults to [] so every
 * existing caller is unaffected.
 *
 * `email` (optional, default false) opts THIS notification into an email copy,
 * still gated by the user's per-type email preference. It is off by default so
 * enabling it here never turns on email for every notification in the app —
 * only callers that explicitly ask (CoS) fan out to email.
 */
async function notify({
  user_id,
  business,
  type,
  title,
  body,
  priority = "normal",
  reference_type,
  reference_id,
  action_url,
  actions = [],
  email = false,
}) {
  if (!user_id) return null;
  // Honour the user's in-app opt-out for this notification type (F-14).
  // Defaults to enabled when the user has set no preference row.
  if (type) {
    const allowed = await isChannelEnabled({
      user_id,
      notification_type: type,
      channel: "in_app",
    });
    if (!allowed) return null;
  }
  const prio = VALID_PRIORITY.has(priority) ? priority : "normal";
  const actionsArr = Array.isArray(actions) ? actions : [];
  // Every notification already names the record it is about
  // (reference_type + reference_id) but almost none passed a link, so the bell
  // dropped the reader on a dead end — nowhere more so than an approval, where
  // the approver had to go hunting for the request. Resolve the link from the
  // reference when the caller didn't give one, so a module gets a working
  // deep link by naming its record, and one route change fixes every notice
  // pointing at it. An explicit action_url always wins.
  const link =
    action_url || deepLinkFor(reference_type, reference_id) || null;
  const { rows } = await query(
    `INSERT INTO shared.notifications
       (user_id, business, type, priority, title, body, reference_type, reference_id, action_url, actions)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     RETURNING notification_id, created_at`,
    [
      user_id,
      business || null,
      type,
      prio,
      title,
      body || null,
      reference_type || null,
      reference_id || null,
      link,
      JSON.stringify(actionsArr),
    ],
  );
  const notif = {
    id: rows[0].notification_id,
    type,
    title,
    body,
    priority: prio,
    action_url: link,
    actions: actionsArr,
    created_at: rows[0].created_at,
  };
  try {
    getBroadcaster()
      .to(ROOMS.user_notifications(user_id))
      .emit("notification:new", notif);
  } catch {
    // redis not ready (tests/scripts); skip silently
  }
  // Fire web push for the user's registered push subscriptions if channel is enabled.
  try {
    const pushAllowed = await isChannelEnabled({
      user_id,
      notification_type: type,
      channel: "push",
    });
    if (pushAllowed) {
      const pushService = require("../shared/push/push.service");
      await pushService.sendToUser({
        user_id,
        title,
        body,
        url: action_url || "/notifications",
        tag: rows[0].notification_id,
      });
    }
  } catch {
    // push service may not be configured; skip silently
  }
  // Opt-in email copy (CoS), gated by the user's per-type email preference.
  if (email) {
    try {
      const emailAllowed = await isChannelEnabled({
        user_id,
        notification_type: type,
        channel: "email",
      });
      if (emailAllowed) {
        const { rows: u } = await query(
          `SELECT email, display_name FROM shared.users WHERE user_id = $1`,
          [user_id],
        );
        if (u[0] && u[0].email) {
          const emailService = require("./email.service");
          await emailService.send({
            to: u[0].email,
            subject: title,
            text: body || title,
            html: `<p>${body || title}</p>`,
            brand: business || undefined,
          });
        }
      }
    } catch {
      // SMTP not configured / send failed — the in-app + push copy still landed.
    }
  }
  return rows[0];
}

async function list({
  user_id,
  only_unread,
  business,
  page = 1,
  page_size = 30,
}) {
  const where = ["user_id = $1"];
  const params = [user_id];
  if (only_unread) where.push("is_read = false");
  if (business) {
    params.push(business);
    where.push(`business = $${params.length}`);
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.notifications ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT * FROM shared.notifications ${w}
      ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
}

async function unreadCount({ user_id, business }) {
  const where = ["user_id = $1", "is_read = false"];
  const params = [user_id];
  if (business) {
    params.push(business);
    where.push(`business = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT count(*)::int AS unread FROM shared.notifications WHERE ${where.join(" AND ")}`,
    params,
  );
  return rows[0].unread;
}

// Tell every open tab/device of this user that notifications were
// consumed, so bell badges and toast stacks drop without a poll.
function emitRead(user_id, payload) {
  try {
    getBroadcaster()
      .to(ROOMS.user_notifications(user_id))
      .emit("notification:read", payload || {});
  } catch {
    // redis not ready (tests/scripts); skip silently
  }
}

async function markRead({ user_id, id }) {
  const { rows } = await query(
    `UPDATE shared.notifications SET is_read = true, read_at = now()
      WHERE notification_id = $1 AND user_id = $2 RETURNING *`,
    [id, user_id],
  );
  if (rows[0]) emitRead(user_id, { ids: [id] });
  return rows[0] || null;
}

async function markAllRead({ user_id, business }) {
  const where = ["user_id = $1", "is_read = false"];
  const params = [user_id];
  if (business) {
    params.push(business);
    where.push(`business = $${params.length}`);
  }
  const { rowCount } = await query(
    `UPDATE shared.notifications SET is_read = true, read_at = now() WHERE ${where.join(" AND ")}`,
    params,
  );
  if (rowCount > 0) emitRead(user_id, { all: true, business: business || null });
  return { marked: rowCount };
}

/**
 * Mark every unread notification pointing at one reference read — e.g.
 * opening a chat thread consumes its 'smartcomm_channel' notifications
 * so the bell count matches what the user has actually seen. Emits
 * notification:read so every connected client updates in realtime.
 */
async function markReadByReference({ user_id, reference_type, reference_id }) {
  if (!user_id || !reference_type || !reference_id) return { marked: 0 };
  const { rows } = await query(
    `UPDATE shared.notifications SET is_read = true, read_at = now()
      WHERE user_id = $1 AND reference_type = $2 AND reference_id = $3
        AND is_read = false
      RETURNING notification_id`,
    [user_id, reference_type, reference_id],
  );
  if (rows.length > 0) {
    emitRead(user_id, {
      ids: rows.map((r) => r.notification_id),
      reference_type,
      reference_id,
    });
  }
  return { marked: rows.length };
}

/**
 * Like markReadByReference, but for EVERY user at once — used when the
 * thing the notifications point at was handled outside any one user's
 * session (a customer thread answered from the Instagram app clears the
 * whole team's "new message" bell, since no in-Hub read will ever fire).
 * Emits notification:read per affected user so open tabs drop the badge.
 */
async function markReadByReferenceAllUsers({ reference_type, reference_id }) {
  if (!reference_type || !reference_id) return { marked: 0 };
  const { rows } = await query(
    `UPDATE shared.notifications SET is_read = true, read_at = now()
      WHERE reference_type = $1 AND reference_id = $2
        AND is_read = false
      RETURNING notification_id, user_id`,
    [reference_type, reference_id],
  );
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r.notification_id);
  }
  for (const [uid, ids] of byUser) {
    emitRead(uid, { ids, reference_type, reference_id });
  }
  return { marked: rows.length };
}

async function deleteOne({ user_id, id }) {
  const { rowCount } = await query(
    `DELETE FROM shared.notifications WHERE notification_id = $1 AND user_id = $2`,
    [id, user_id],
  );
  return { deleted: rowCount };
}

async function bulkDelete({ user_id, ids }) {
  if (!Array.isArray(ids) || ids.length === 0) return { deleted: 0 };
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(",");
  const { rowCount } = await query(
    `DELETE FROM shared.notifications WHERE user_id = $1 AND notification_id IN (${placeholders})`,
    [user_id, ...ids],
  );
  return { deleted: rowCount };
}

// ── Notification preferences (F-14) ──────────────────────

async function getPreferences({ user_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.notification_preferences WHERE user_id = $1 ORDER BY notification_type`,
    [user_id],
  );
  return rows;
}

async function upsertPreference({
  user_id,
  notification_type,
  in_app,
  email_enabled,
  whatsapp_enabled,
  sms_enabled,
  push_enabled,
}) {
  const { rows } = await query(
    `INSERT INTO shared.notification_preferences
       (user_id, notification_type, in_app, email_enabled, whatsapp_enabled, sms_enabled, push_enabled)
     VALUES ($1, $2, COALESCE($3, true), COALESCE($4, true), COALESCE($5, false), COALESCE($6, false), COALESCE($7, true))
     ON CONFLICT (user_id, notification_type) DO UPDATE
       SET in_app           = COALESCE($3, notification_preferences.in_app),
           email_enabled    = COALESCE($4, notification_preferences.email_enabled),
           whatsapp_enabled = COALESCE($5, notification_preferences.whatsapp_enabled),
           sms_enabled      = COALESCE($6, notification_preferences.sms_enabled),
           push_enabled     = COALESCE($7, notification_preferences.push_enabled),
           updated_at       = now()
     RETURNING *`,
    [
      user_id,
      notification_type,
      in_app ?? null,
      email_enabled ?? null,
      whatsapp_enabled ?? null,
      sms_enabled ?? null,
      push_enabled ?? null,
    ],
  );
  return rows[0];
}

async function isChannelEnabled({ user_id, notification_type, channel }) {
  const col = CHANNEL_COLUMN[channel];
  if (!col) throw new Error(`Unknown notification channel: ${channel}`);
  const { rows } = await query(
    `SELECT ${col} AS enabled FROM shared.notification_preferences
      WHERE user_id = $1 AND notification_type = $2`,
    [user_id, notification_type],
  );
  return rows.length === 0 ? true : rows[0].enabled;
}

module.exports = {
  notify,
  list,
  unreadCount,
  markRead,
  markAllRead,
  markReadByReference,
  markReadByReferenceAllUsers,
  deleteOne,
  bulkDelete,
  getPreferences,
  upsertPreference,
  isChannelEnabled,
};
