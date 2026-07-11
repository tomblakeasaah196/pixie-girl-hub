/**
 * WhatsApp Calls — durable webhook consumer.
 *
 * Registers a second named consumer of the `webhook.received` outbox
 * event (next to smartcomm-ingest): meta_whatsapp payloads carrying
 * `calls` field changes are funnelled into calls.service.
 *
 * Latency note: the outbox poller ticks every ~5s, which is fine for
 * messages but an eternity for a ringing phone. The webhook receiver
 * therefore ALSO fires the same ingest inline right after commit (see
 * webhooks.service). Both paths are idempotent (wa_call_id + per-event
 * dedup), so whichever runs second is a no-op — the inline path buys the
 * latency, this consumer buys the crash-safety.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const webhookRepo = require("../business_setup/webhooks.repo");
const service = require("./calls.service");
const { logger } = require("../../config/logger");

let registered = false;

async function onWebhookReceived({ webhook_id, source }) {
  if (source !== "meta_whatsapp") return;
  const log = await webhookRepo.findById(webhook_id);
  if (!log) return;
  if (!log.signature_valid) return; // never process unverified
  const payload = log.payload || {};
  if (!service.payloadHasCalls(payload)) return;
  try {
    await service.ingestCallsPayload(payload);
  } catch (err) {
    logger.error(
      { err: err.message, webhook_id },
      "calls: webhook ingest failed",
    );
    throw err; // let the outbox retry
  }
}

function register() {
  if (registered) return;
  registered = true;
  outbox.register("webhook.received", "calls-ingest", onWebhookReceived);
  logger.info("calls subscribers registered (webhook.received)");
}

register();

module.exports = { register, onWebhookReceived };
