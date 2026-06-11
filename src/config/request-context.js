/**
 * Per-request ambient context (R-1 — make RLS effective).
 *
 * Carries the resolved brand + user for the lifetime of a request (or any
 * `run()` scope) without threading them through every function signature.
 * `config/database.js` reads this so `transaction()` can `SET LOCAL
 * app.current_business` / `app.current_user_id` on the connection it opens —
 * which is what the RLS policies in migration 000200 key off.
 *
 * Design notes:
 *   - When there is NO context (background workers, crons, boot, CEO group
 *     endpoints that bypass brand-context), the GUC stays unset → the policy's
 *     `current_business() IS NULL` branch lets every brand through. That is the
 *     intended "no filter" path for cross-brand jobs — so this is fully
 *     backward-compatible: only request-scoped code gets brand-filtered.
 *   - `crossBrand: true` is the explicit CEO/group escape hatch: context is set
 *     (so audit user_id is available) but the brand filter is intentionally
 *     left open.
 */

"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");

/** @typedef {{ brand?: string, userId?: string, crossBrand?: boolean }} RequestContext */

const storage = new AsyncLocalStorage();

/**
 * Run `fn` with the given context bound for its entire async lifetime.
 * @param {RequestContext} ctx
 * @param {() => any} fn
 */
function run(ctx, fn) {
  return storage.run(ctx || {}, fn);
}

/** @returns {RequestContext | undefined} */
function get() {
  return storage.getStore();
}

/** The brand to filter by, or null when no single-brand context applies. */
function getBrand() {
  const ctx = storage.getStore();
  if (!ctx || ctx.crossBrand) return null;
  return ctx.brand || null;
}

/** The acting user id, or null. */
function getUserId() {
  const ctx = storage.getStore();
  return (ctx && ctx.userId) || null;
}

module.exports = { run, get, getBrand, getUserId };
