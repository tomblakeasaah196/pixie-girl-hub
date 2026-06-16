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
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");

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
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL } = process.env;
  return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_EMAIL);
}

/** Return the VAPID public key for the frontend to subscribe with. */
function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/** Store or refresh a push subscription for a user. */
async function saveSubscription({ user_id, endpoint, p256dh, auth_key, user_agent }) {
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

/** Send a push notification to all subscriptions for a user. */
async function sendToUser({ user_id, title, body, url, tag }) {
  const wp = getWebPush();
  if (!wp || !isConfigured()) return;

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL } = process.env;
  wp.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const { rows } = await query(
    `SELECT sub_id, endpoint, p256dh, auth_key FROM shared.push_subscriptions WHERE user_id = $1`,
    [user_id],
  );
  if (!rows.length) return;

  const payload = JSON.stringify({ title, body: body || "", url: url || "/notifications", tag });

  await Promise.all(
    rows.map(async (sub) => {
      try {
        await wp.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload,
        );
        await query(
          `UPDATE shared.push_subscriptions SET last_used_at = now() WHERE sub_id = $1`,
          [sub.sub_id],
        );
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired — clean up.
          await removeSubscription({ user_id, endpoint: sub.endpoint }).catch(() => {});
        } else {
          logger.warn({ err: err.message, user_id }, "push: delivery failed (non-fatal)");
        }
      }
    }),
  );
}

module.exports = { getPublicKey, saveSubscription, removeSubscription, sendToUser, isConfigured };
