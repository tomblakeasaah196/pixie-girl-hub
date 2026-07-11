/**
 * Queue inspector — "why is my job stuck in the queue?"
 *
 * Connects to the SAME Redis the app uses (config/redis) and, for every BullMQ
 * queue the worker owns, prints the counts (waiting / active / completed /
 * failed / delayed) plus the error reason of the most recent failed jobs.
 *
 * Read-only. Sends nothing, deletes nothing.
 *
 *   node scripts/queue-inspect.js                 # all queues
 *   node scripts/queue-inspect.js email-send      # one queue, with job dumps
 */

"use strict";

const { Queue } = require("bullmq");
const { config } = require("../src/config/env");

const QUEUE_NAMES = [
  "media-processing",
  "email-send",
  "whatsapp-send",
  "instagram-send",
  "webhooks-replay",
  "ai-embed",
  "report-generate",
  "cart-ttl",
];

const connection = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
  db: config.REDIS_DB,
  maxRetriesPerRequest: null,
};

async function main() {
  const only = process.argv[2];
  const names = only ? [only] : QUEUE_NAMES;

  console.warn(
    `Redis → ${connection.host}:${connection.port} db=${connection.db}\n`,
  );

  for (const name of names) {
    const q = new Queue(name, { connection });
    const counts = await q.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
      "paused",
    );
    const flag =
      counts.waiting > 0 && counts.active === 0
        ? "  ⟵ jobs waiting, none active"
        : "";
    console.warn(
      `${name.padEnd(18)} waiting=${counts.waiting} active=${counts.active} ` +
        `completed=${counts.completed} failed=${counts.failed} ` +
        `delayed=${counts.delayed} paused=${counts.paused}${flag}`,
    );

    // Dump recent failures — the failedReason is the actual send error that
    // the old processor swallowed.
    const failed = await q.getFailed(0, 4);
    for (const job of failed) {
      console.warn(
        `   ✗ failed job ${job.id} (${job.name}) — ${job.failedReason}`,
      );
      if (only) console.warn(`     data: ${JSON.stringify(job.data)}`);
    }

    // With a single-queue arg, also peek at what's waiting so you can see the
    // payloads that never got picked up.
    if (only) {
      const waiting = await q.getWaiting(0, 4);
      for (const job of waiting) {
        console.warn(
          `   … waiting job ${job.id} (${job.name}) — to=${job.data?.to} subject=${job.data?.subject}`,
        );
      }
    }

    await q.close();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("queue-inspect failed:", err.message);
  process.exit(1);
});
