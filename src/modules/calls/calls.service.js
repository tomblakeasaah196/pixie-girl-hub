/**
 * WhatsApp Calls (V2.2 §6.17 — Cloud API Calling) — business logic.
 *
 * Inbound voice calls: a customer taps the call button in the brand's
 * WhatsApp chat → Meta posts a `calls` webhook (`connect` with an SDP
 * offer) → we ring the conversation owner's browser first, escalate to
 * every online agent after 15s, and the winning agent answers over
 * WebRTC (their browser's SDP answer is relayed to Meta's /calls edge).
 *
 * State machine (shared.whatsapp_calls.status):
 *   ringing → in_progress → completed        answered, then hung up
 *   ringing → missed                          nobody answered (terminate)
 *   ringing → rejected                        an agent declined
 *   ringing/in_progress → failed              provider/media error
 *
 * Every terminal call is stamped onto the customer's SmartComm thread as
 * a 'call' card; missed calls additionally trigger the follow-up trio
 * (option 4a): auto WhatsApp reply + CRM task for the owner + notification.
 *
 * Ingestion runs twice on purpose — an inline fast path fired straight
 * from the webhook receiver (ring latency) and the durable outbox
 * consumer (crash safety). Both funnel through ingestCallsPayload, which
 * is idempotent on Meta's wa_call_id + (call, event) pairs.
 */

"use strict";

const { transaction } = require("../../config/database");
const repo = require("./calls.repo");
const events = require("./calls.events");
const { AppError, NotFoundError } = require("../../utils/errors");
const { logger } = require("../../config/logger");
const { audit } = require("../../middleware/audit");
const smartcommRepo = require("../smartcomm/smartcomm.repo");
const callingApi = require("../../services/whatsapp-calling.service");

// Ring choreography (option 3a): owner-first window, then everyone.
const RING_OWNER_FIRST_MS = 15_000;
// Safety net: a ringing row older than this with no terminate webhook is
// settled as missed by the sweep job (webhook loss must not strand a call).
const STALE_RING_SECONDS = 90;

// v1 default; candidates to move into Comms Studio automations alongside
// the layaway/birthday copy once calling proves itself.
const MISSED_CALL_REPLY =
  "Sorry we missed your call! 🙏 We'll get back to you as soon as possible — " +
  "or send us a message right here and we'll reply straight away.";

const OUTCOME_LABELS = {
  deal_closed: "Deal closed",
  order_placed: "Order placed",
  follow_up: "Follow up",
  enquiry: "Enquiry",
  complaint: "Complaint",
  wrong_number: "Wrong number",
  other: "Other",
};

// Lazy requires — smartcomm.service transitively pulls heavy deps; the
// subscribers file registers outbox consumers at require time.
const smartcommService = () => require("../smartcomm/smartcomm.service");
const smartcommSubscribers = () => require("../smartcomm/smartcomm.subscribers");

function tsToIso(unixSeconds) {
  const n = Number(unixSeconds);
  if (!unixSeconds || Number.isNaN(n)) return null;
  return new Date(n * 1000).toISOString();
}

function fmtDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

/** Strip server-only fields (the SDP offer) off API/socket payloads. */
function publicCall(call) {
  if (!call) return null;
  const rest = { ...call };
  delete rest.sdp_offer;
  return rest;
}

// ── Webhook parsing ───────────────────────────────────────────

/**
 * Parse the `calls` field changes out of a Meta WhatsApp webhook payload.
 * Pure function (exported for tests). Non-`calls` changes are ignored —
 * messages/statuses stay with the smartcomm ingester.
 */
function parseMetaWhatsAppCalls(payload) {
  const out = [];
  for (const entry of (payload && payload.entry) || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "calls") continue;
      const value = change.value || {};
      const external_account_id =
        (value.metadata && value.metadata.phone_number_id) || null;
      const contacts = value.contacts || [];
      for (const c of value.calls || []) {
        if (!c || !c.id) continue;
        const contact =
          contacts.find((x) => x.wa_id === c.from) || contacts[0] || {};
        out.push({
          external_account_id,
          wa_call_id: c.id,
          event: c.event || null, // connect | terminate | future kinds
          direction: c.direction || "USER_INITIATED",
          from: c.from || null,
          to: c.to || null,
          caller_name: (contact.profile && contact.profile.name) || null,
          timestamp: tsToIso(c.timestamp),
          sdp: (c.session && c.session.sdp) || null,
          status: c.status || null, // terminate: COMPLETED | FAILED | …
          start_time: tsToIso(c.start_time),
          end_time: tsToIso(c.end_time),
          duration:
            c.duration === null || c.duration === undefined
              ? null
              : Number(c.duration) || 0,
          raw: c,
        });
      }
    }
  }
  return out;
}

/** True iff the webhook payload carries any `calls` field change. */
function payloadHasCalls(payload) {
  for (const entry of (payload && payload.entry) || []) {
    for (const change of entry.changes || []) {
      if (change.field === "calls") return true;
    }
  }
  return false;
}

/**
 * Ingest every call event in a (signature-verified) webhook payload.
 * Idempotent — safe for the inline fast path and the outbox consumer to
 * both run it. Throws on the first failure so the outbox retries.
 */
async function ingestCallsPayload(payload) {
  const evts = parseMetaWhatsAppCalls(payload);
  for (const evt of evts) {
    if (evt.event === "connect" && evt.direction !== "BUSINESS_INITIATED") {
      await handleConnect(evt);
    } else if (evt.event === "terminate") {
      await handleTerminate(evt);
    } else {
      await recordAuxEvent(evt);
    }
  }
  return evts.length;
}

// ── connect: ring the right people ────────────────────────────

async function handleConnect(evt) {
  const account = await smartcommRepo.findMessagingAccount({
    platform: "whatsapp",
    external_account_id: evt.external_account_id,
  });
  if (!account) {
    logger.warn(
      { external_account_id: evt.external_account_id, wa_call_id: evt.wa_call_id },
      "calls: no messaging_accounts row for inbound call — dropped",
    );
    return null;
  }
  const brand = account.business;

  // Contact + thread are committed in their own transactions BEFORE the
  // call row (same at-least-once reasoning as the smartcomm ingester:
  // both steps are idempotent, and the call row's FKs need them visible).
  const { contact } = await transaction(async (client) =>
    smartcommSubscribers().resolveOrCreateContact({
      client,
      brand,
      platform: "whatsapp",
      sender: {
        phone: evt.from,
        display_name: evt.caller_name,
        external_user_id: evt.from,
      },
    }),
  );
  const thread = await transaction(async (client) =>
    smartcommService().findOrCreateCustomerThread({
      client,
      brand,
      contact_id: contact.contact_id,
      platform: "whatsapp",
      external_thread_ref: evt.from,
    }),
  );

  const { call, duplicate } = await repo.createFromConnect({
    call: {
      business: brand,
      wa_call_id: evt.wa_call_id,
      contact_id: contact.contact_id,
      channel_id: thread.channel_id,
      from_number: evt.from,
      to_number: evt.to,
      caller_name: contact.display_name || evt.caller_name || evt.from,
      sdp_offer: evt.sdp,
      started_at: evt.timestamp,
    },
  });
  if (!call) return null;
  if (duplicate) return call; // redelivery / fast-path-vs-outbox race: already ringing

  await repo.insertEvent({
    e: { call_id: call.call_id, event: "connect", payload: evt.raw },
  });

  const owner = thread.assigned_to || null;
  const ring = {
    call_id: call.call_id,
    brand,
    caller_name: call.caller_name,
    from_number: call.from_number,
    contact_id: call.contact_id,
    channel_id: call.channel_id,
    started_at: call.started_at,
    owner_user_id: owner,
  };

  if (owner) {
    // Owner-first (option 3a): only the assigned agent rings for the
    // first window; the delayed job widens the ring if nobody claims.
    events.emit("call.ringing", { ...ring, scope: "owner" });
    await scheduleLifecycleJob("escalate", call.call_id, RING_OWNER_FIRST_MS);
  } else {
    await repo.setEscalated({ call_id: call.call_id });
    events.emit("call.ringing", { ...ring, scope: "brand" });
  }
  // Belt-and-braces sweep in case Meta's terminate webhook never lands.
  await scheduleLifecycleJob(
    "sweep-stale",
    call.call_id,
    STALE_RING_SECONDS * 1000 + 30_000,
  );
  return call;
}

/**
 * Delayed lifecycle jobs ride BullMQ (multi-instance safe). Redis being
 * unavailable must never kill the ring itself — the stale sweep is a
 * safety net, so failures degrade to a warn.
 */
async function scheduleLifecycleJob(name, call_id, delay) {
  try {
    const { enqueue } = require("../../jobs/queue-producer");
    await enqueue(
      "calls-lifecycle",
      name,
      { call_id },
      { delay, attempts: 1, jobId: `${name}-${call_id}` },
    );
  } catch (err) {
    logger.warn(
      { err: err.message, call_id, job: name },
      "calls: lifecycle job enqueue failed",
    );
  }
}

/** 15s elapsed with no claim → widen the ring to every online agent. */
async function escalateRing({ call_id }) {
  const escalated = await repo.setEscalated({ call_id });
  if (!escalated) return null; // answered/ended/already escalated — nothing to do
  events.emit("call.escalated", {
    call_id: escalated.call_id,
    brand: escalated.business,
    caller_name: escalated.caller_name,
    from_number: escalated.from_number,
    contact_id: escalated.contact_id,
    channel_id: escalated.channel_id,
    started_at: escalated.started_at,
    scope: "brand",
  });
  return escalated;
}

/** Terminate webhook lost → settle the stranded ringing row as missed. */
async function sweepStaleRinging({ call_id }) {
  const call = await repo.findByCallIdUnscoped({ call_id });
  if (!call || call.status !== "ringing") return null;
  const ageSeconds = (Date.now() - new Date(call.started_at).getTime()) / 1000;
  if (ageSeconds < STALE_RING_SECONDS) return null;
  const ended = await repo.markEnded({
    call_id,
    status: "missed",
    end_reason: "stale_no_terminate",
  });
  if (!ended) return null;
  logger.warn({ call_id }, "calls: ringing call swept as missed (no terminate webhook)");
  await finaliseCall(ended);
  return ended;
}

// ── terminate: settle + follow up ─────────────────────────────

async function handleTerminate(evt) {
  const call = await repo.findByWaCallId({ wa_call_id: evt.wa_call_id });
  if (!call) {
    logger.warn(
      { wa_call_id: evt.wa_call_id },
      "calls: terminate for unknown call — ignored",
    );
    return null;
  }
  await repo.insertEvent({
    e: { call_id: call.call_id, event: "terminate", payload: evt.raw },
  });

  const metaStatus = String(evt.status || "").toUpperCase();
  let finalStatus;
  if (call.status === "in_progress") {
    finalStatus = metaStatus === "FAILED" ? "failed" : "completed";
  } else if (call.status === "ringing") {
    finalStatus = "missed";
  } else {
    return call; // already settled locally (hangup/reject won the race)
  }

  const ended = await repo.markEnded({
    call_id: call.call_id,
    status: finalStatus,
    end_reason: metaStatus || null,
    ended_at: evt.end_time,
    duration_seconds: evt.duration,
  });
  if (!ended) return call;
  await finaliseCall(ended);
  return ended;
}

/**
 * Terminal housekeeping shared by every path into a final state:
 * timeline card on the thread, missed-call follow-ups, realtime fanout.
 * Each leg is best-effort — a card failure must not block the follow-ups.
 */
async function finaliseCall(call) {
  let cardMessageId = null;
  try {
    cardMessageId = await postTimelineCard(call);
  } catch (err) {
    logger.error(
      { err: err.message, call_id: call.call_id },
      "calls: timeline card failed",
    );
  }
  if (call.status === "missed" || call.status === "rejected") {
    try {
      await runMissedFollowups(call);
    } catch (err) {
      logger.error(
        { err: err.message, call_id: call.call_id },
        "calls: missed-call follow-ups failed",
      );
    }
  }
  events.emit("call.ended", {
    call_id: call.call_id,
    brand: call.business,
    status: call.status,
    duration_seconds: call.duration_seconds,
    answered_by: call.answered_by,
    channel_id: call.channel_id,
    contact_id: call.contact_id,
    caller_name: call.caller_name,
    message_id: cardMessageId,
  });
  return cardMessageId;
}

/** Stamp the finished call onto the customer's SmartComm thread. */
async function postTimelineCard(call) {
  if (!call.contact_id) return null;
  let content;
  if (call.status === "completed") {
    const agent = call.answered_by ? await repo.getUserName(call.answered_by) : null;
    content = `📞 WhatsApp call — ${fmtDuration(call.duration_seconds)}${
      agent ? ` · answered by ${agent}` : ""
    }`;
  } else if (call.status === "rejected") {
    content = "📞 Missed WhatsApp call (declined)";
  } else if (call.status === "failed") {
    content = "📞 WhatsApp call failed";
  } else {
    content = "📞 Missed WhatsApp call";
  }
  const { message } = await smartcommService().recordCallActivity({
    brand: call.business,
    contact_id: call.contact_id,
    external_thread_ref: call.from_number,
    content,
    metadata: {
      call_id: call.call_id,
      call_status: call.status,
      duration_seconds: call.duration_seconds,
      answered_by_name: call.answered_by
        ? await repo.getUserName(call.answered_by)
        : null,
    },
  });
  await repo.setTimelineMessage({
    call_id: call.call_id,
    message_id: message.message_id,
  });
  return message.message_id;
}

/**
 * Missed-call trio (option 4a): auto WhatsApp reply, CRM task assigned to
 * the conversation owner, persistent notification. Each leg independent.
 */
async function runMissedFollowups(call) {
  let auto_reply_sent = false;
  try {
    const whatsapp = require("../../services/whatsapp.service");
    await whatsapp.sendText({
      brand: call.business,
      to: call.from_number,
      body: MISSED_CALL_REPLY,
    });
    auto_reply_sent = true;
  } catch (err) {
    logger.warn(
      { err: err.message, call_id: call.call_id },
      "calls: missed-call auto-reply failed",
    );
  }

  const owner = call.channel_id
    ? await repo.getChannelOwner(call.channel_id)
    : null;

  let missed_task_id = null;
  try {
    const created_by = owner || (await repo.findFallbackTaskCreator());
    if (created_by) {
      const tasksRepo = require("../../shared/tasks/tasks.repo");
      const task = await tasksRepo.createTask({
        client: null,
        task: {
          business: call.business,
          title: `Missed WhatsApp call — ${call.caller_name || call.from_number}`,
          description:
            `${call.caller_name || "A customer"} (${call.from_number || "unknown number"}) ` +
            `called on WhatsApp and nobody answered.\n` +
            `Call them back or reply in Messaging.`,
          status: "today",
          priority: "high",
          assigned_to: owner,
          created_by,
          reference_type: "whatsapp_call",
          reference_id: call.call_id,
        },
      });
      missed_task_id = task.task_id;
    } else {
      logger.warn(
        { call_id: call.call_id },
        "calls: no eligible task creator — missed-call task skipped",
      );
    }
  } catch (err) {
    logger.warn(
      { err: err.message, call_id: call.call_id },
      "calls: missed-call task creation failed",
    );
  }

  if (owner) {
    try {
      const notifications = require("../../services/notifications.service");
      await notifications.notify({
        user_id: owner,
        business: call.business,
        // Its own type (not "message"): a missed call and a new chat message
        // are different urgencies, and an agent must be able to keep call
        // alerts on while muting message noise — see calls.push.js, which uses
        // the same key for the ring's push opt-out.
        type: "whatsapp_call",
        priority: "high",
        title: "Missed WhatsApp call",
        body: `${call.caller_name || call.from_number} tried to call and nobody answered.`,
        reference_type: "whatsapp_call",
        reference_id: call.call_id,
        action_url: call.channel_id ? `/smartcomm?channel=${call.channel_id}` : "/smartcomm",
      });
    } catch (err) {
      logger.warn(
        { err: err.message, call_id: call.call_id },
        "calls: missed-call notification failed",
      );
    }
  }

  await repo.setMissedFollowups({
    call_id: call.call_id,
    auto_reply_sent,
    missed_task_id,
  });
}

/** Aux/unknown call events: keep the audit trail, change nothing. */
async function recordAuxEvent(evt) {
  if (!evt.event) return;
  const call = await repo.findByWaCallId({ wa_call_id: evt.wa_call_id });
  if (!call) return;
  await repo.insertEvent({
    e: { call_id: call.call_id, event: evt.event, payload: evt.raw },
  });
}

// ── Agent actions (HTTP) ──────────────────────────────────────

/**
 * Claim a ringing call — atomic, exactly one winner. Returns the SDP
 * offer + ICE config the browser needs to build its answer.
 */
async function claimCall({ user, brand, id }) {
  await smartcommService().assertPlatformAccess({
    user,
    brand,
    platform: "whatsapp",
    action: "reply",
  });
  const call = await repo.claim({
    business: brand,
    call_id: id,
    user_id: user.user_id,
  });
  if (!call) {
    const existing = await repo.findById({ business: brand, call_id: id });
    if (!existing) throw new NotFoundError("Call");
    throw new AppError(
      "CALL_NOT_RINGING",
      existing.status === "in_progress"
        ? "A colleague already answered this call."
        : "This call has already ended.",
      409,
    );
  }
  await repo.insertEvent({
    e: { call_id: id, event: "claimed", actor_user_id: user.user_id },
  });
  events.emit("call.claimed", {
    call_id: id,
    brand,
    answered_by: user.user_id,
    answered_by_name: user.display_name || null,
    channel_id: call.channel_id,
  });
  return {
    call: publicCall(call),
    sdp_offer: call.sdp_offer,
    ice_servers: callingApi.getIceServers(),
  };
}

/** Relay the claiming browser's SDP answer to Meta — the call goes live. */
async function acceptCall({ user, brand, id, sdp, request_id }) {
  const call = await repo.findById({ business: brand, call_id: id });
  if (!call) throw new NotFoundError("Call");
  if (call.status !== "in_progress" || call.answered_by !== user.user_id) {
    throw new AppError(
      "CALL_NOT_CLAIMED",
      "Claim the call before accepting it.",
      409,
    );
  }
  try {
    await callingApi.accept({ brand, call_id: call.wa_call_id, sdp });
  } catch (err) {
    // Give the call back — another agent (or a retry) can still win it
    // before Meta times the ring out.
    const released = await repo.releaseClaim({ call_id: id, user_id: user.user_id });
    if (released) {
      events.emit("call.claim_released", {
        call_id: id,
        brand,
        caller_name: released.caller_name,
        from_number: released.from_number,
        contact_id: released.contact_id,
        channel_id: released.channel_id,
        started_at: released.started_at,
      });
    }
    throw err;
  }
  await repo.insertEvent({
    e: { call_id: id, event: "accepted", actor_user_id: user.user_id },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "calls.accepted",
    target_type: "whatsapp_call",
    target_id: id,
    request_id,
  });
  return { ok: true };
}

/** Decline a ringing call. Runs the missed-call follow-ups — the customer
 *  still didn't get to talk to anyone. */
async function rejectCall({ user, brand, id, request_id }) {
  await smartcommService().assertPlatformAccess({
    user,
    brand,
    platform: "whatsapp",
    action: "reply",
  });
  const call = await repo.findById({ business: brand, call_id: id });
  if (!call) throw new NotFoundError("Call");
  if (call.status !== "ringing") {
    throw new AppError("CALL_NOT_RINGING", "This call is no longer ringing.", 409);
  }
  const ended = await repo.markEnded({
    call_id: id,
    status: "rejected",
    end_reason: "rejected_by_agent",
  });
  if (!ended) {
    throw new AppError("CALL_NOT_RINGING", "This call is no longer ringing.", 409);
  }
  try {
    await callingApi.reject({ brand, call_id: call.wa_call_id });
  } catch (err) {
    // The row is already settled; Meta racing us to terminate is fine.
    logger.warn(
      { err: err.message, call_id: id },
      "calls: Graph reject failed (call likely already ended)",
    );
  }
  await repo.insertEvent({
    e: { call_id: id, event: "rejected", actor_user_id: user.user_id },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "calls.rejected",
    target_type: "whatsapp_call",
    target_id: id,
    request_id,
  });
  await finaliseCall(ended);
  return publicCall(ended);
}

/** Hang up an in-progress call from our side. */
async function hangupCall({ user, brand, id, request_id }) {
  const call = await repo.findById({ business: brand, call_id: id });
  if (!call) throw new NotFoundError("Call");
  if (call.status !== "in_progress") {
    throw new AppError("CALL_NOT_ACTIVE", "This call is not in progress.", 409);
  }
  if (call.answered_by !== user.user_id && !user.is_ceo) {
    throw new AppError(
      "NOT_CALL_OWNER",
      "Only the agent on the call can hang it up.",
      403,
    );
  }
  try {
    await callingApi.terminate({ brand, call_id: call.wa_call_id });
  } catch (err) {
    // Customer may have hung up a beat earlier — settle locally anyway.
    logger.warn(
      { err: err.message, call_id: id },
      "calls: Graph terminate failed (call likely already ended)",
    );
  }
  const ended = await repo.markEnded({
    call_id: id,
    status: "completed",
    end_reason: "agent_hangup",
  });
  await repo.insertEvent({
    e: { call_id: id, event: "hangup", actor_user_id: user.user_id },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "calls.hangup",
    target_type: "whatsapp_call",
    target_id: id,
    request_id,
  });
  if (ended) await finaliseCall(ended);
  return publicCall(ended || (await repo.findById({ business: brand, call_id: id })));
}

/** Post-call disposition (option 5a — mandatory in the UI). */
async function recordOutcome({ user, brand, id, outcome, notes, request_id }) {
  const call = await repo.findById({ business: brand, call_id: id });
  if (!call) throw new NotFoundError("Call");
  if (call.status !== "completed") {
    throw new AppError(
      "CALL_NOT_COMPLETED",
      "Outcomes can only be recorded on completed calls.",
      409,
    );
  }
  if (call.answered_by !== user.user_id && !user.is_ceo) {
    throw new AppError(
      "NOT_CALL_OWNER",
      "Only the agent who took the call can record its outcome.",
      403,
    );
  }
  const updated = await repo.setOutcome({
    call_id: id,
    business: brand,
    outcome,
    outcome_notes: notes,
    user_id: user.user_id,
  });
  if (!updated) throw new NotFoundError("Call");
  if (updated.message_id) {
    try {
      await smartcommService().updateCallActivity({
        message_id: updated.message_id,
        content: `📞 WhatsApp call — ${fmtDuration(updated.duration_seconds)} · ${
          OUTCOME_LABELS[outcome] || outcome
        }`,
        metadata: { outcome, outcome_notes: notes || null },
      });
    } catch (err) {
      logger.warn(
        { err: err.message, call_id: id },
        "calls: outcome card update failed",
      );
    }
  }
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "calls.outcome_recorded",
    target_type: "whatsapp_call",
    target_id: id,
    after: { outcome, notes: notes || null },
    request_id,
  });
  events.emit("call.outcome_recorded", { call_id: id, brand, outcome });
  return publicCall(updated);
}

// ── Reads ─────────────────────────────────────────────────────

async function listCalls({ user, brand, status, contact_id, answered_by, limit, offset }) {
  await smartcommService().assertPlatformAccess({
    user,
    brand,
    platform: "whatsapp",
    action: "view",
  });
  const rows = await repo.list({
    business: brand,
    status,
    contact_id,
    answered_by,
    limit,
    offset,
  });
  return rows.map(publicCall);
}

async function getCall({ user, brand, id }) {
  await smartcommService().assertPlatformAccess({
    user,
    brand,
    platform: "whatsapp",
    action: "view",
  });
  const call = await repo.findById({ business: brand, call_id: id });
  if (!call) throw new NotFoundError("Call");
  return publicCall(call);
}

/**
 * Rings this agent should be hearing RIGHT NOW, in the socket ring's own
 * shape. This is the client's reconciliation read, and it exists because the
 * ring is a fire-and-forget socket event: a tab that was asleep, offline, or
 * simply not open yet when `call:ringing` went out has no way to learn about a
 * live call. The client calls this on connect, on reconnect, on waking, and
 * on cold start from a push notification — so a ring is never lost to a
 * network gap, and a ring that has since been answered is never left hanging.
 *
 * Owner-first is applied in SQL (see repo.findRingingForUser) so the client
 * can't drift from the server's routing rule.
 */
async function listRingingForUser({ user, brand }) {
  await smartcommService().assertPlatformAccess({
    user,
    brand,
    platform: "whatsapp",
    action: "view",
  });
  const rows = await repo.findRingingForUser({
    business: brand,
    user_id: user.user_id,
  });
  return rows.map((r) => ({
    call_id: r.call_id,
    brand: r.business,
    caller_name: r.caller_name,
    from_number: r.from_number,
    contact_id: r.contact_id,
    channel_id: r.channel_id,
    started_at: r.started_at,
    scope: r.escalated_at ? "brand" : "owner",
  }));
}

module.exports = {
  // webhook ingestion
  parseMetaWhatsAppCalls,
  payloadHasCalls,
  ingestCallsPayload,
  handleConnect,
  handleTerminate,
  // lifecycle jobs
  escalateRing,
  sweepStaleRinging,
  // agent actions
  claimCall,
  acceptCall,
  rejectCall,
  hangupCall,
  recordOutcome,
  // reads
  listCalls,
  getCall,
  listRingingForUser,
  // exposed for tests
  finaliseCall,
  runMissedFollowups,
  publicCall,
};
