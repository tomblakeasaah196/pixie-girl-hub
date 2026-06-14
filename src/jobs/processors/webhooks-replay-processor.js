/**
 * BullMQ processor: webhooks-replay — failed inbound webhook retries.
 *
 * The real-time path verifies an inbound webhook, logs it to shared.webhook_log,
 * and enqueues `webhook.received` on the transactional outbox; the outbox
 * dispatcher then runs `webhooks.service.onWebhookReceived` with bounded retries.
 * When those retries are exhausted (or a downstream consumer was down when the
 * event arrived), the row is left `processed = false` with an `error_message`.
 * This queue re-drives those rows.
 *
 * Two job shapes:
 *   1. Single   — enqueue("webhooks-replay", "replay", { webhook_id })
 *   2. Sweep    — enqueue("webhooks-replay", "sweep",
 *                   { sweep: true, source?, limit?, max_retries? })
 *                 finds replayable rows and re-drives each (per-row errors are
 *                 caught so one bad event doesn't abort the batch).
 *
 * Re-processing is idempotent: recordGatewayPayment dedups on the provider
 * reference + client_idempotency_key, and onWebhookReceived no-ops a row that
 * is already `processed`. Only signature-valid rows are ever replayed.
 */

"use strict";

const { logger } = require("../../config/logger");
const webhooks = require("../../modules/business_setup/webhooks.service");
const repo = require("../../modules/business_setup/webhooks.repo");

async function replayOne(webhook_id) {
  await webhooks.onWebhookReceived({ webhook_id });
}

module.exports = async function process(job) {
  const data = job.data || {};

  // ── Single webhook ────────────────────────────────────────
  if (data.webhook_id && !data.sweep) {
    await replayOne(data.webhook_id);
    logger.info(
      { jobId: job.id, webhook_id: data.webhook_id },
      "webhook replayed",
    );
    return { replayed: 1 };
  }

  // ── Sweep: re-drive a batch of replayable rows ────────────
  const { source = null, limit = 100, max_retries: maxRetries = 25 } = data;
  const rows = await repo.listReplayable({ source, limit, maxRetries });

  let ok = 0;
  const failed = [];
  for (const r of rows) {
    try {
      await replayOne(r.webhook_id);
      ok += 1;
    } catch (err) {
      // onWebhookReceived already recorded the error on the row and bumped
      // retry_count; keep going so a single broken event can't stall the sweep.
      failed.push(r.webhook_id);
      logger.warn(
        {
          jobId: job.id,
          webhook_id: r.webhook_id,
          err: String(err && err.message),
        },
        "webhook replay failed",
      );
    }
  }

  logger.info(
    {
      jobId: job.id,
      source,
      scanned: rows.length,
      replayed: ok,
      failed: failed.length,
    },
    "webhook replay sweep complete",
  );
  return { scanned: rows.length, replayed: ok, failed };
};
