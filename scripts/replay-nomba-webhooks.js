/**
 * One-off: re-drive stuck Nomba webhooks that are already in shared.webhook_log.
 *
 * WHY THIS EXISTS
 * Clicking "Resend" on Nomba's dashboard does NOT reprocess a webhook that is
 * already in our log: receive() dedups on external_id and returns early
 * (webhooks.service.js → `if (log.duplicate) return`). Rows that were logged
 * but failed processing (e.g. the Bug #1 NGN amount failures) must be re-driven
 * through the REPLAY path instead, which reprocesses by webhook_id and bypasses
 * that dedup.
 *
 * WHAT IT DOES
 * Enqueues every unprocessed, signature-valid Nomba webhook (ignoring the retry
 * cap) onto the `webhooks-replay` queue. The running worker — which now has the
 * Bug #1 / method fixes — reprocesses them and confirms the orders. Terminal
 * transfers with no order reference get parked in the reconciliation queue.
 *
 * WHAT IT WON'T FIX
 *  - FLH-SO-0037: signature_valid = false, so replay skips it by design — and it
 *    also fails on the stock_levels_on_hand_check constraint until that's fixed.
 *  - FLH-SO-0052: not in the log at all → nothing to replay. Check Nomba's
 *    dashboard; if a real payment exists there, use Resend (it's not yet logged).
 *
 * RUN (from the project root, same env/.env as the app, with the worker running):
 *   node scripts/replay-nomba-webhooks.js
 *
 * Safe to run repeatedly: recordGatewayPayment dedups on the provider reference,
 * so already-confirmed orders are not double-recorded.
 */

"use strict";

// A standalone script doesn't go through server boot, so the DB pool and Redis
// client aren't initialised yet — do it explicitly before touching either.
const { initDatabase, closeDatabase } = require("../src/config/database");
const { initRedis, closeRedis } = require("../src/config/redis");
const webhooks = require("../src/modules/business_setup/webhooks.service");
const repo = require("../src/modules/business_setup/webhooks.repo");

(async () => {
  try {
    await initDatabase();
    await initRedis();

    // Process each stuck row IN-PROCESS via onWebhookReceived, instead of
    // enqueuing onto the webhooks-replay queue. The queue path reuses a stable
    // jobId (`replay-<id>`); once those jobs have failed and are retained,
    // BullMQ treats re-adding the same jobId as a no-op, so a second run never
    // actually reprocesses (which is why you kept seeing the same error).
    // Calling the handler directly avoids that entirely. Idempotent:
    // recordGatewayPayment dedups on the provider reference, and onWebhookReceived
    // skips a row already marked processed.
    const rows = await repo.listReplayable({
      source: "nomba",
      limit: 500,
      maxRetries: null, // ignore the retry cap — re-drive everything still stuck
    });
    console.warn(`Found ${rows.length} replayable Nomba webhook(s). Processing…\n`);

    let ok = 0;
    let failed = 0;
    for (const r of rows) {
      try {
        await webhooks.onWebhookReceived({ webhook_id: r.webhook_id });
        ok += 1;
        console.warn(`  ok  ${r.webhook_id}`);
      } catch (err) {
        failed += 1;
        console.warn(`  ERR ${r.webhook_id} — ${err.message}`);
      }
    }
    console.warn(`\nDone. confirmed/parked: ${ok}, still failing: ${failed}.`);
    console.warn(
      "Signature-invalid rows (e.g. FLH-SO-0037) are skipped by listReplayable; " +
        "0037 also needs the stock-block fix before it can confirm.",
    );
  } catch (e) {
    console.error("replay failed:", e.message);
    process.exitCode = 1;
  } finally {
    // Flush + close so the process exits cleanly (enqueue is already awaited,
    // so the jobs are persisted in Redis before we disconnect).
    try {
      await closeRedis();
    } catch {
      // ignore Redis close failures
    }
    try {
      await closeDatabase();
    } catch {
      // ignore DB close failures
    }
    process.exit(process.exitCode || 0);
  }
})();
