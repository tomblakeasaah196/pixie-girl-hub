/**
 * WhatsApp Calls realtime — bridge domain events to Socket.io rooms.
 *
 *   call.ringing (scope owner)  → user:{owner}:calls        ring one agent
 *   call.ringing (scope brand)  → brand:{key}:calls          ring everyone
 *   call.escalated              → brand:{key}:calls          widen the ring
 *   call.claim_released         → brand:{key}:calls          re-ring after a failed accept
 *   call.claimed                → brand:{key}:calls + owner   stop ringing everywhere
 *   call.ended                  → brand:{key}:calls (+agent)  stop ring / remote hangup
 *   call.outcome_recorded       → brand:{key}:calls           refresh history lists
 *
 * Uses getBroadcaster() so events raised in the worker process (outbox
 * consumer, lifecycle jobs) still reach connected clients via the Redis
 * emitter bridge.
 */

"use strict";

const events = require("./calls.events");
const { getBroadcaster } = require("../../realtime/emitter");
const { logger } = require("../../config/logger");

let registered = false;

function emit(room, event, payload) {
  try {
    getBroadcaster().to(room).emit(event, payload);
  } catch (err) {
    // Redis unavailable (tests/scripts without initRedis) — skip silently.
    logger.debug({ err: err.message, room, event }, "calls realtime emit skipped");
  }
}

const brandRoom = (brand) => `brand:${brand}:calls`;
const userRoom = (userId) => `user:${userId}:calls`;

function register() {
  if (registered) return;
  registered = true;

  events.on("call.ringing", (p) => {
    const payload = {
      call_id: p.call_id,
      brand: p.brand,
      caller_name: p.caller_name,
      from_number: p.from_number,
      contact_id: p.contact_id,
      channel_id: p.channel_id,
      started_at: p.started_at,
      scope: p.scope,
    };
    if (p.scope === "owner" && p.owner_user_id) {
      emit(userRoom(p.owner_user_id), "call:ringing", payload);
    } else {
      emit(brandRoom(p.brand), "call:ringing", payload);
    }
  });

  events.on("call.escalated", (p) => {
    emit(brandRoom(p.brand), "call:ringing", {
      call_id: p.call_id,
      brand: p.brand,
      caller_name: p.caller_name,
      from_number: p.from_number,
      contact_id: p.contact_id,
      channel_id: p.channel_id,
      started_at: p.started_at,
      scope: "brand",
    });
  });

  events.on("call.claim_released", (p) => {
    emit(brandRoom(p.brand), "call:ringing", {
      call_id: p.call_id,
      brand: p.brand,
      caller_name: p.caller_name,
      from_number: p.from_number,
      contact_id: p.contact_id,
      channel_id: p.channel_id,
      started_at: p.started_at,
      scope: "brand",
    });
  });

  events.on("call.claimed", (p) => {
    emit(brandRoom(p.brand), "call:claimed", {
      call_id: p.call_id,
      answered_by: p.answered_by,
      answered_by_name: p.answered_by_name,
      channel_id: p.channel_id,
    });
  });

  events.on("call.ended", (p) => {
    const payload = {
      call_id: p.call_id,
      status: p.status,
      duration_seconds: p.duration_seconds,
      channel_id: p.channel_id,
      caller_name: p.caller_name,
    };
    emit(brandRoom(p.brand), "call:ended", payload);
    if (p.answered_by) emit(userRoom(p.answered_by), "call:ended", payload);
  });

  events.on("call.outcome_recorded", (p) => {
    emit(brandRoom(p.brand), "call:outcome_recorded", {
      call_id: p.call_id,
      outcome: p.outcome,
    });
  });

  logger.info("calls realtime subscribers registered");
}

register();

module.exports = { register };
