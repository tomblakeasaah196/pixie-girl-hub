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

(async () => {
  try {
    await initDatabase();
    await initRedis();

    const ids = await webhooks.enqueueReplay({
      source: "nomba",
      limit: 500,
      maxRetries: null, // ignore the retry cap — re-drive everything still stuck
    });
    console.warn(`Enqueued ${ids.length} Nomba webhook(s) for replay.`);
    for (const id of ids) console.warn("  " + id);
    console.warn(
      "\nThe worker will now reprocess them. Re-check the orders in a minute.\n" +
        "Note: signature-invalid rows (e.g. FLH-SO-0037) are skipped by design,\n" +
        "and FLH-SO-0037 also needs the stock-block fix before it can confirm.",
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
