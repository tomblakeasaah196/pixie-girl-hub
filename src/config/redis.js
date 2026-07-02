/**
 * Redis client.
 *
 * Used for:
 *   - Identity cache — per-request user / brand-config / permission-grant
 *     lookups with event-driven invalidation (shared/cache/identity-cache.js)
 *   - Sessions (refresh tokens, password-reset tokens, revocation)
 *   - Pub/Sub coordination across Socket.io workers (redis adapter)
 *   - BullMQ job queues (workers and scheduled jobs)
 *   - Rate limiting (express-rate-limit Redis store)
 */

"use strict";

const IORedis = require("ioredis");
const { config } = require("./env");
const { logger } = require("./logger");

let client = null;
let publisher = null;
let subscriber = null;

function buildOptions() {
  return {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    db: config.REDIS_DB,
    maxRetriesPerRequest: null, // BullMQ requires null
    enableReadyCheck: true,
    reconnectOnError(err) {
      logger.warn({ err: err.message }, "redis reconnecting");
      return true;
    },
  };
}

async function initRedis() {
  client = new IORedis(buildOptions());
  publisher = new IORedis(buildOptions());
  subscriber = new IORedis(buildOptions());

  for (const [name, c] of [
    ["main", client],
    ["publisher", publisher],
    ["subscriber", subscriber],
  ]) {
    c.on("error", (err) => logger.error({ err, conn: name }, "redis error"));
    c.on("connect", () => logger.debug({ conn: name }, "redis connected"));
  }

  await client.ping();
  return client;
}

function getClient() {
  if (!client) throw new Error("redis not initialised");
  return client;
}

function getPublisher() {
  if (!publisher) throw new Error("redis publisher not initialised");
  return publisher;
}

function getSubscriber() {
  if (!subscriber) throw new Error("redis subscriber not initialised");
  return subscriber;
}

async function closeRedis() {
  await Promise.allSettled([
    client?.quit(),
    publisher?.quit(),
    subscriber?.quit(),
  ]);
  client = publisher = subscriber = null;
}

module.exports = {
  initRedis,
  getClient,
  getPublisher,
  getSubscriber,
  closeRedis,
};
