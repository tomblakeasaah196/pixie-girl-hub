/**
 * WhatsApp Calls — out-of-app ring (Web Push).
 *
 * The Socket.io fanout in calls.realtime.js only reaches a tab that is OPEN
 * and connected. An agent whose laptop is asleep, whose PWA is backgrounded,
 * or who is simply signed out on that device has no socket at all — so before
 * this existed, a call could only ever be answered by someone already staring
 * at the Hub. This module is the third leg: every ringing call also goes out
 * as a high-urgency push so the phone rings like a phone.
 *
 *   call.ringing (owner)   → push the assigned agent
 *   call.ringing (brand)   → push everyone who could answer
 *   call.escalated         → push everyone EXCEPT the owner (already ringing)
 *   call.claim_released    → push everyone again (the accept failed)
 *   call.claimed           → cancel the ring notification everywhere else
 *   call.ended             → cancel the ring notification everywhere
 *
 * Design rules:
 *   - Never block the ring. Every handler is fire-and-forget with its own
 *     catch: a dead push service must not slow down (or break) the socket
 *     ring or the webhook response.
 *   - Short TTL. A ring push delivered after the caller gave up is worse than
 *     no push, so these carry `urgency: high` + a ~45 s TTL and the push
 *     service is told to drop rather than queue them.
 *   - Cancel is explicit. An OS notification with `requireInteraction` sits on
 *     the lock screen until dismissed, so "a colleague answered" has to travel
 *     as its own push (the service worker closes by tag).
 */

"use strict";

const events = require("./calls.events");
const repo = require("./calls.repo");
const push = require("../../shared/push/push.service");
const notifications = require("../../services/notifications.service");
const { logger } = require("../../config/logger");

/**
 * Seconds a ring push stays worth delivering. Meta rings for ~30 s and the
 * stale sweep settles at 120 s; 45 s covers a normal ring plus a little clock
 * skew without ever waking someone for a call that is long gone.
 */
const RING_PUSH_TTL_SECONDS = 45;

/** Notification type used for the per-user push opt-out (F-14 preferences). */
const NOTIF_TYPE = "whatsapp_call";

/** Ring-like cadence for devices that vibrate (Android/Chrome; iOS ignores). */
const RING_VIBRATE = [600, 250, 600, 250, 600];

const tagFor = (call_id) => `pgh-call-${call_id}`;

/**
 * Deep link that opens the thread AND arms the in-app answer flow. The
 * `answer_call` / `decline_call` params survive a login redirect, which is how
 * a signed-out device still lands on the right call (see CallLayer).
 */
function callUrl({ call_id, channel_id }, action) {
  // Both values are UUIDs, so no escaping is needed (and this keeps the module
  // free of a URL global the lint config doesn't know about).
  const parts = [];
  if (channel_id) parts.push(`channel=${channel_id}`);
  parts.push(`${action}=${call_id}`);
  return `/smartcomm?${parts.join("&")}`;
}

const answerUrl = (p) => callUrl(p, "answer_call");
const declineUrl = (p) => callUrl(p, "decline_call");

/**
 * Drop users who turned call pushes off. Absence of a preference row means
 * enabled (same default as every other channel), and a failed lookup must
 * never silence a ringing phone — on error we keep the user.
 */
async function filterByPreference(user_ids) {
  const checks = await Promise.all(
    user_ids.map(async (user_id) => {
      try {
        const ok = await notifications.isChannelEnabled({
          user_id,
          notification_type: NOTIF_TYPE,
          channel: "push",
        });
        return ok ? user_id : null;
      } catch {
        return user_id;
      }
    }),
  );
  return checks.filter(Boolean);
}

/** Everyone who could answer this call, minus `exclude`. */
async function audienceFor({ brand, channel_id }, exclude = []) {
  const skip = new Set(exclude.filter(Boolean));
  const all = await repo.findRingAudience({ brand, channel_id });
  return all.filter((id) => !skip.has(id));
}

/**
 * Send the ring push. `p` is the same payload calls.realtime relays over the
 * socket, so the notification and the in-app toast always name the same caller.
 */
async function pushRing({ p, user_ids }) {
  const eligible = await filterByPreference(user_ids);
  if (!eligible.length) return 0;

  const name = p.caller_name || p.from_number || "Unknown caller";
  const sent = await push.sendToUsers({
    user_ids: eligible,
    kind: "call_ring",
    title: `📞 ${name} is calling`,
    body: "Incoming WhatsApp call — tap to answer",
    url: answerUrl(p),
    tag: tagFor(p.call_id),
    actions: [
      { action: "answer", title: "Answer" },
      { action: "decline", title: "Decline" },
    ],
    require_interaction: true,
    renotify: true,
    vibrate: RING_VIBRATE,
    urgency: "high",
    ttl: RING_PUSH_TTL_SECONDS,
    data: {
      call_id: p.call_id,
      brand: p.brand,
      channel_id: p.channel_id || null,
      contact_id: p.contact_id || null,
      caller_name: p.caller_name || null,
      from_number: p.from_number || null,
      started_at: p.started_at || null,
      scope: p.scope || "brand",
      answer_url: answerUrl(p),
      decline_url: declineUrl(p),
    },
  });
  logger.debug(
    { call_id: p.call_id, recipients: eligible.length, endpoints: sent },
    "calls: ring push fanned out",
  );
  return sent;
}

/**
 * Tell every other device the ring is over. The service worker closes the
 * notification with this tag; the title/body are only ever seen by a stale
 * worker that doesn't understand `call_cancel` yet, so they still read as
 * something sensible.
 */
async function pushCancel({ call_id, brand, channel_id, user_ids, reason, title, body }) {
  if (!user_ids.length) return 0;
  return push.sendToUsers({
    user_ids,
    kind: "call_cancel",
    title: title || "Call ended",
    body: body || "",
    url: channel_id ? `/smartcomm?channel=${channel_id}` : "/smartcomm",
    tag: tagFor(call_id),
    silent: true,
    urgency: "high",
    ttl: RING_PUSH_TTL_SECONDS,
    data: { call_id, brand, channel_id: channel_id || null, reason },
  });
}

/** Wrap a handler so a push failure can never escape into the ring path. */
function safely(name, handler) {
  return (p) => {
    Promise.resolve()
      .then(() => handler(p))
      .catch((err) =>
        logger.warn(
          { err: err.message, call_id: p && p.call_id, event: name },
          "calls: ring push failed (non-fatal)",
        ),
      );
  };
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;

  // Owner-first window: only the assigned agent's devices ring.
  events.on(
    "call.ringing",
    safely("call.ringing", async (p) => {
      if (p.scope === "owner" && p.owner_user_id) {
        await pushRing({ p, user_ids: [p.owner_user_id] });
        return;
      }
      const audience = await audienceFor(p);
      await pushRing({ p, user_ids: audience });
    }),
  );

  // +15 s unclaimed: widen to the team. The owner already has a ringing
  // notification with this tag, so re-pushing them would only re-alert.
  events.on(
    "call.escalated",
    safely("call.escalated", async (p) => {
      const owner = p.channel_id
        ? await repo.getChannelOwner(p.channel_id)
        : null;
      const audience = await audienceFor(p, [owner]);
      await pushRing({ p, user_ids: audience });
    }),
  );

  // The winner's SDP accept failed and the call went back to ringing.
  events.on(
    "call.claim_released",
    safely("call.claim_released", async (p) => {
      const audience = await audienceFor(p);
      await pushRing({ p, user_ids: audience });
    }),
  );

  // Someone answered — stop every other device ringing.
  events.on(
    "call.claimed",
    safely("call.claimed", async (p) => {
      const audience = await audienceFor(p, [p.answered_by]);
      await pushCancel({
        call_id: p.call_id,
        brand: p.brand,
        channel_id: p.channel_id,
        user_ids: audience,
        reason: "claimed",
        title: "Call answered",
        body: p.answered_by_name
          ? `${p.answered_by_name} took the call.`
          : "A colleague took the call.",
      });
    }),
  );

  // Settled (completed / missed / rejected / failed) — clear the ring
  // everywhere. Missed calls get their own follow-up notification from
  // calls.service, so this one only ever needs to close the ring.
  //
  // Skipped for a call that was ANSWERED: `call.claimed` already cancelled
  // every other device the moment it was picked up, and the agent who answered
  // had their notification closed locally by the app. Sending a second silent
  // push per call would be pure waste — and on iOS, silent pushes that display
  // nothing are exactly what makes Safari revoke a push subscription, which
  // would leave that device unable to ring at all.
  events.on(
    "call.ended",
    safely("call.ended", async (p) => {
      if (p.answered_by) return;
      const audience = await audienceFor(p);
      await pushCancel({
        call_id: p.call_id,
        brand: p.brand,
        channel_id: p.channel_id,
        user_ids: audience,
        reason: p.status || "ended",
        title: p.status === "missed" ? "Missed call" : "Call ended",
        body: p.caller_name ? `${p.caller_name}` : "",
      });
    }),
  );

  logger.info("calls push subscribers registered");
}

register();

module.exports = {
  register,
  RING_PUSH_TTL_SECONDS,
  NOTIF_TYPE,
  tagFor,
  answerUrl,
  declineUrl,
};
