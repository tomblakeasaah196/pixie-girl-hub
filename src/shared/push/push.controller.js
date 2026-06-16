"use strict";

const service = require("./push.service");

/** GET /push/public-key — returns the VAPID public key (or 204 if unconfigured). */
async function publicKey(req, res) {
  const key = service.getPublicKey();
  if (!key) return res.status(204).send();
  res.json({ data: { public_key: key } });
}

/** POST /push/subscribe — register or refresh a push subscription. */
async function subscribe(req, res) {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: { message: "endpoint, keys.p256dh and keys.auth are required" } });
  }
  await service.saveSubscription({
    user_id: req.user.user_id,
    endpoint,
    p256dh: keys.p256dh,
    auth_key: keys.auth,
    user_agent: req.headers["user-agent"],
  });
  res.status(201).json({ data: { ok: true } });
}

/** DELETE /push/subscribe — unregister a push subscription. */
async function unsubscribe(req, res) {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: { message: "endpoint required" } });
  await service.removeSubscription({ user_id: req.user.user_id, endpoint });
  res.json({ data: { ok: true } });
}

module.exports = { publicKey, subscribe, unsubscribe };
