/**
 * captureError() — the fire-and-forget entrypoint the rest of the backend calls
 * to report an error to Kaizen. Wired into:
 *   - src/middleware/error-handler.js  (5xx + unhandled fall-through)
 *   - src/server.js                    (uncaughtException / unhandledRejection)
 *   - src/jobs/worker.js               (BullMQ 'failed' listeners)
 *
 * CONTRACT (critical): this must NEVER throw, and callers must NOT await it. It
 * extracts a route pattern + a PII-redacted context from the request, then
 * hands a clean payload to the errors service. All work is wrapped so a capture
 * failure can never break request handling. See guide §7.3.
 */

"use strict";

const { config } = require("../../../config/env");
const { logger } = require("../../../config/logger");
const { scrub, opaqueUserRef, safeContext } = require("./errors.redact");
const service = require("./errors.service");

/** Derive a stable route pattern like 'POST /api/v1/sales/:id/pay'. */
function routePatternOf(req) {
  if (!req) return null;
  try {
    const method = req.method || "";
    // Express fills req.route.path on matched routes; combine with baseUrl.
    const base = req.baseUrl || "";
    const routePath = req.route?.path;
    if (routePath) return `${method} ${base}${routePath}`.trim();
    // Fall back to a coarse bucket (strip obvious ids from the raw path).
    const raw = (req.originalUrl || req.url || "").split("?")[0];
    const coarse = raw
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        ":id",
      )
      .replace(/\/\d+(?=\/|$)/g, "/:id");
    return `${method} ${coarse}`.trim();
  } catch {
    return null;
  }
}

/**
 * @param {Error|any} err     the thrown error (or a reason)
 * @param {object|null} req   the Express request, if available
 * @param {object} [opts]     { source, code, severity, httpStatus, context, force }
 */
function captureError(err, req, opts = {}) {
  // Detach from the caller entirely — never block, never throw.
  setImmediate(async () => {
    try {
      const e = err || {};
      const message =
        (typeof e === "string" ? e : e.message) || e.code || "Unknown error";
      const stack = e.stack || null;
      const errorCode = opts.code || e.code || null;

      // 4xx capture is opt-in (avoids validation-noise). Always capture 5xx +
      // process-level (no httpStatus) + explicit non-http captures.
      //
      // `force` overrides the opt-in for 4xx that are OUR fault, not the
      // caller's — chiefly the translated Postgres failures in error-handler.js
      // (25P02, deadlock, statement timeout), which answer with a soft 409/503
      // so staff can retry. Those are backend faults wearing a 4xx, and leaving
      // them behind the opt-in is exactly why a broken assign showed the user
      // "please try again" while the Errors console showed nothing at all.
      const httpStatus = opts.httpStatus ?? null;
      if (
        !opts.force &&
        httpStatus &&
        httpStatus >= 400 &&
        httpStatus < 500 &&
        !config.KAIZEN_CAPTURE_4XX
      ) {
        return;
      }

      const routePattern = routePatternOf(req);
      const userRef = req?.user?.user_id
        ? opaqueUserRef(req.user.user_id, config.KAIZEN_JWT_SECRET || "kz")
        : null;

      await service.record({
        message,
        stack,
        errorCode,
        source: opts.source || "backend",
        routePattern,
        httpStatus,
        severity: opts.severity || (httpStatus >= 500 ? "error" : "error"),
        occurrence: {
          request_id: req?.request_id || null,
          route: routePattern,
          method: req?.method || null,
          http_status: httpStatus,
          brand: req?.brand || null,
          user_ref: userRef,
          context: {
            ...safeContext(opts.context),
            // keep a bounded, scrubbed stack in the sample for the export/detail
            stack: stack ? scrub(stack).slice(0, 4000) : undefined,
          },
        },
      });
    } catch (captureErr) {
      logger.warn(
        { err: captureErr.message },
        "kaizen captureError swallowed a failure",
      );
    }
  });
}

module.exports = { captureError, routePatternOf };
