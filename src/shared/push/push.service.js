/**
 * Web Push (VAPID) service. Delivers OS-level push notifications to registered
 * browser subscriptions when the user is offline or the tab is closed.
 *
 * Required env vars:
 *   VAPID_PUBLIC_KEY   — base64url-encoded VAPID public key
 *   VAPID_PRIVATE_KEY  — base64url-encoded VAPID private key
 *   VAPID_EMAIL        — mailto: or https: contact URI (required by browsers)
 *
 * Generate a key pair once and add to .env:
 *   node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys();
 *             console.log(JSON.stringify(k));"
 *
 * Two classes of push ride this service:
 *   - ordinary notifications (default urgency, browser-default TTL) — a late
 *     delivery is still useful, so the push service may queue them;
 *   - RINGING CALLS, which are time-critical. Those pass `urgency: "high"`
 *     and a short `ttl`, because a ring that lands after the caller hung up is
 *     worse than no ring at all. `kind` tells the service worker which shape
 *     it received (see apps/admin/public/sw.js).
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const { config } = require("../../config/env");

let webpush = null;

function getWebPush() {
  if (webpush) return webpush;
  try {
    webpush = require("web-push");
  } catch {
    return null;
  }
  return webpush;
}

function isConfigured() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL } = config;
  return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_EMAIL);
}

/** Return the VAPID public key for the frontend to subscribe with. */
function getPublicKey() {
  return config.VAPID_PUBLIC_KEY || null;
}

/** Store or refresh a push subscription for a user. */
async function saveSubscription({
  user_id,
  endpoint,
  p256dh,
  auth_key,
  user_agent,
}) {
  await query(
    `INSERT INTO shared.push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, endpoint) DO UPDATE
       SET p256dh = $3, auth_key = $4, last_used_at = now()`,
    [user_id, endpoint, p256dh, auth_key, user_agent || null],
  );
}

/** Remove an expired or unsubscribed endpoint. */
async function removeSubscription({ user_id, endpoint }) {
  await query(
    `DELETE FROM shared.push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
    [user_id, endpoint],
  );
}

/**
 * Build the JSON body the service worker receives. Only defined keys are
 * included so the payload stays inside the 4 KB push limit and older service
 * workers (which read title/body/url/tag only) keep working unchanged.
 */
function buildPayload({
  kind,
  title,
  body,
  url,
  tag,
  actions,
  require_interaction,
  renotify,
  vibrate,
  silent,
  data,
}) {
  const payload = {
    title: title || "Pixie Hub",
    body: body || "",
    url: url || "/notifications",
  };
  if (tag) payload.tag = tag;
  if (kind) payload.kind = kind;
  if (Array.isArray(actions) && actions.length) payload.actions = actions;
  if (require_interaction) payload.require_interaction = true;
  if (renotify) payload.renotify = true;
  if (Array.isArray(vibrate) && vibrate.length) payload.vibrate = vibrate;
  if (silent) payload.silent = true;
  if (data && typeof data === "object") payload.data = data;
  return JSON.stringify(payload);
}

/**
 * Deliver one already-serialised payload to every subscription of one user.
 * Expired endpoints (410/404) are pruned; every other failure is a warn —
 * push is never allowed to fail the caller's flow.
 */
async function deliver({ user_id, payload, urgency, ttl }) {
  const wp = getWebPush();
  if (!wp || !isConfigured()) return 0;

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL } = config;
  wp.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const { rows } = await query(
    `SELECT sub_id, endpoint, p256dh, auth_key FROM shared.push_subscriptions WHERE user_id = $1`,
    [user_id],
  );
  if (!rows.length) return 0;

  const options = {};
  if (urgency) options.urgency = urgency;
  if (Number.isFinite(ttl)) options.TTL = ttl;

  let sent = 0;
  await Promise.all(
    rows.map(async (sub) => {
      try {
        await wp.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth_key },
          },
          payload,
          options,
        );
        sent += 1;
        await query(
          `UPDATE shared.push_subscriptions SET last_used_at = now() WHERE sub_id = $1`,
          [sub.sub_id],
        );
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired — clean up.
          await removeSubscription({ user_id, endpoint: sub.endpoint }).catch(
            () => {},
          );
        } else {
          logger.warn(
            { err: err.message, user_id },
            "push: delivery failed (non-fatal)",
          );
        }
      }
    }),
  );
  return sent;
}

/**
 * Send a push notification to all subscriptions for a user. Returns the
 * number of endpoints that accepted it (0 when push is unconfigured or the
 * user has no registered device — callers use this to decide whether an
 * out-of-app alert actually went anywhere).
 */
async function sendToUser({ user_id, urgency, ttl, ...rest }) {
  if (!user_id) return 0;
  return deliver({
    user_id,
    payload: buildPayload(rest),
    urgency,
    ttl,
  });
}

/**
 * Fan one push out to several users (deduped). Used by the ring fanout, where
 * the same notification goes to every agent who could answer. Serialised once,
 * delivered in parallel; a failure for one user never blocks the others.
 */
async function sendToUsers({ user_ids, urgency, ttl, ...rest }) {
  const unique = [...new Set((user_ids || []).filter(Boolean))];
  if (!unique.length) return 0;
  const payload = buildPayload(rest);
  const counts = await Promise.all(
    unique.map((user_id) =>
      deliver({ user_id, payload, urgency, ttl }).catch(() => 0),
    ),
  );
  return counts.reduce((a, b) => a + b, 0);
}

module.exports = {
  getPublicKey,
  saveSubscription,
  removeSubscription,
  sendToUser,
  sendToUsers,
  isConfigured,
  buildPayload,
};
