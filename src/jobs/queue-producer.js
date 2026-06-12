/**
 * BullMQ queue producer — usable from ANY process (web or worker).
 *
 * The worker owns the consumers; this lets request-path code (e.g. smartcomm)
 * enqueue durable jobs onto the same queues without depending on the worker's
 * in-process queue map. Queue instances are lazily created on the shared Redis
 * connection and cached.
 */

"use strict";

const { Queue } = require("bullmq");
const { getClient } = require("../config/redis");

const queues = new Map();

function getQueue(name) {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, { connection: getClient() }));
  }
  return queues.get(name);
}

/**
 * Enqueue a job with sensible durability defaults (retry + exponential backoff,
 * trimmed history). Callers can override via `opts`.
 */
async function enqueue(name, jobName, data, opts = {}) {
  return getQueue(name).add(jobName, data, {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
    ...opts,
  });
}

module.exports = { enqueue };
