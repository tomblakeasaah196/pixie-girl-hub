/**
 * Customer Onboarding real-time relay.
 *
 * Subscribes to customer_onboarding domain events and broadcasts thin
 * signals into the canonical room brand:{brand}:customer_onboarding. Per
 * ARCHITECTURE.md, modules emit domain events; this relay (not the service)
 * talks to Socket.io. Registered once during socket init.
 *
 * Consumer: Quick Sale's QR panel joins this room while a capture link it
 * minted is awaiting a submission, matches submission_id against its own
 * link, then fetches the contact itself — so, like sales-realtime.js, the
 * payload here carries only IDs, never the customer's name/phone/email.
 */

"use strict";

const events = require("../modules/customer_onboarding/customer-onboarding.events");
const { ROOMS } = require("./rooms");
const { getBroadcaster } = require("./emitter");
const { logger } = require("../config/logger");

function emitToBrand(brand, channel, payload) {
  if (!brand) return;
  try {
    getBroadcaster().to(ROOMS.customer_onboarding(brand)).emit(channel, payload);
  } catch (err) {
    // Redis unavailable (tests/scripts without initRedis).
    logger.debug({ err: err.message }, "onboarding realtime emit skipped");
  }
}

let registered = false;

function registerOnboardingRealtime() {
  // Idempotent: socket init (API) and startWorkers (worker/in-process dev)
  // may both call this; the second call must not duplicate emissions.
  if (registered) return;
  registered = true;

  events.on("submission.completed", ({ brand, submission_id, contact_id }) =>
    emitToBrand(brand, "onboarding:submission.completed", {
      submission_id,
      contact_id,
    }),
  );

  logger.info("customer onboarding realtime relay registered");
}

module.exports = { registerOnboardingRealtime };
