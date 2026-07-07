/**
 * Kaizen performance service — in-memory per-route reservoir + 1-minute rollup
 * flush. Runs IN THE API PROCESS (where the requests are). We keep a bounded
 * reservoir per route so percentiles stay meaningful without storing per-request
 * rows. The flush self-schedules on a timer in this same process (the worker's
 * cron can't see this process's memory — see guide §7.5).
 */

"use strict";

const { logger } = require("../../../config/logger");
const repo = require("./perf.repo");

const MAX_SAMPLES_PER_KEY = 2000; // reservoir cap per route/method per window
const FLUSH_INTERVAL_MS = 60_000;

// key = "METHOD pattern" → { method, routePattern, samples:[ms], count, err, max, seen }
let reservoir = new Map();
let windowStart = new Date();
let flushTimer = null;

/** Record one finished request. Cheap: O(1) amortised. */
function record({ method, routePattern, durationMs, status }) {
  if (!routePattern || durationMs == null) return;
  const key = `${method} ${routePattern}`;
  let e = reservoir.get(key);
  if (!e) {
    e = { method, routePattern, samples: [], count: 0, err: 0, max: 0 };
    reservoir.set(key, e);
  }
  e.count += 1;
  if (status >= 500) e.err += 1;
  if (durationMs > e.max) e.max = durationMs;
  // Reservoir sampling: keep a representative bounded set for percentiles.
  if (e.samples.length < MAX_SAMPLES_PER_KEY) {
    e.samples.push(durationMs);
  } else {
    const j = Math.floor(Math.random() * e.count);
    if (j < MAX_SAMPLES_PER_KEY) e.samples[j] = durationMs;
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

/** Snapshot the current window, compute rollups, persist, and reset. */
async function flush() {
  if (reservoir.size === 0) {
    windowStart = new Date();
    return { flushed: 0 };
  }
  const snapshot = reservoir;
  const wStart = windowStart;
  reservoir = new Map();
  windowStart = new Date();
  const wEnd = windowStart;

  const rows = [];
  for (const e of snapshot.values()) {
    const sorted = e.samples.slice().sort((a, b) => a - b);
    rows.push({
      window_start: wStart,
      window_end: wEnd,
      route_pattern: e.routePattern,
      method: e.method,
      req_count: e.count,
      err_count: e.err,
      p50_ms: percentile(sorted, 50),
      p95_ms: percentile(sorted, 95),
      p99_ms: percentile(sorted, 99),
      max_ms: Math.round(e.max),
    });
  }
  try {
    await repo.insertRollups(rows);
  } catch (err) {
    logger.warn({ err: err.message }, "kaizen perf flush failed");
  }
  return { flushed: rows.length };
}

/** Start the self-flush timer (idempotent). Called from server.js. */
function startAutoFlush(intervalMs = FLUSH_INTERVAL_MS) {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flush().catch((err) => logger.warn({ err: err.message }, "perf auto-flush error"));
  }, intervalMs);
  // Don't keep the event loop alive just for the flush timer.
  if (flushTimer.unref) flushTimer.unref();
  logger.info({ intervalMs }, "kaizen perf auto-flush started");
}

function stopAutoFlush() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

// ── Read side (dashboard) ────────────────────────────────────────────────────
async function summary({ hours = 24 }) {
  return repo.summary({ hours });
}
async function route({ pattern, hours = 24 }) {
  return repo.routeSeries({ pattern, hours });
}

module.exports = { record, flush, startAutoFlush, stopAutoFlush, summary, route };
