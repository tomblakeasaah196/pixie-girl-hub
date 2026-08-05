/**
 * Centralised error handler.
 *
 * Sends a consistent error shape to clients:
 *   { error: { code, message, fields? }, request_id }
 *
 * Never leaks SQL errors, stack traces, or internal messages.
 * Validation errors (Zod/Joi) get 400 with field-level details.
 */

"use strict";

const { ZodError } = require("zod");
const { logger } = require("../config/logger");
const { AppError } = require("../utils/errors");
const { getSupportContact, supportSentence } = require("../config/support");
// Kaizen error capture — fire-and-forget, never awaited, never throws.
const { captureError } = require("../modules/kaizen/errors/errors.capture");

function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "Route not found" },
    request_id: req.request_id,
  });
}

// Postgres error codes that are NOT a clean business rule but must never reach
// the buyer as an opaque 500. Each maps to a friendly, often-retryable message.
// (23505/23503/23514 keep their own dedicated handlers below.)
const PG_FRIENDLY = {
  // Transient — a retry usually succeeds.
  40001: {
    http: 409,
    code: "TEMPORARY_CONFLICT",
    retryable: true,
    message: "We hit a brief traffic spike. Please tap pay again.",
  },
  "40P01": {
    http: 409,
    code: "TEMPORARY_CONFLICT",
    retryable: true,
    message: "We hit a brief traffic spike. Please tap pay again.",
  },
  "55P03": {
    http: 409,
    code: "TEMPORARY_CONFLICT",
    retryable: true,
    message: "That item is being updated by another order. Please try again.",
  },
  57014: {
    http: 503,
    code: "SERVICE_BUSY",
    retryable: true,
    message: "We're under heavy load right now. Please try again in a moment.",
  },
  53300: {
    http: 503,
    code: "SERVICE_BUSY",
    retryable: true,
    message: "We're under heavy load right now. Please try again in a moment.",
  },
  53400: {
    http: 503,
    code: "SERVICE_BUSY",
    retryable: true,
    message: "We're under heavy load right now. Please try again in a moment.",
  },
  "08000": {
    http: 503,
    code: "SERVICE_BUSY",
    retryable: true,
    message: "We couldn't reach our system briefly. Please try again.",
  },
  "08003": {
    http: 503,
    code: "SERVICE_BUSY",
    retryable: true,
    message: "We couldn't reach our system briefly. Please try again.",
  },
  "08006": {
    http: 503,
    code: "SERVICE_BUSY",
    retryable: true,
    message: "We couldn't reach our system briefly. Please try again.",
  },
  "25P02": {
    http: 409,
    code: "TEMPORARY_CONFLICT",
    retryable: true,
    message: "Something interrupted that step. Please try again.",
  },
  // Input-shaped — a value was missing/too long/wrong format. 400, not retryable
  // as-is, but framed so the buyer knows to check their details.
  23502: {
    http: 400,
    code: "MISSING_VALUE",
    retryable: false,
    message:
      "A required detail was missing. Please check your form and try again.",
  },
  22001: {
    http: 400,
    code: "VALUE_TOO_LONG",
    retryable: false,
    message:
      "One of the values you entered is too long. Please shorten it and try again.",
  },
  22003: {
    http: 400,
    code: "VALUE_OUT_OF_RANGE",
    retryable: false,
    message:
      "One of the values you entered is out of range. Please check and try again.",
  },
  "22P02": {
    http: 400,
    code: "INVALID_VALUE",
    retryable: false,
    message:
      "One of the values you entered is in the wrong format. Please check and try again.",
  },
  // A trigger / stored function raised. Could be config or a guard — keep it
  // soft and pointed at support.
  P0001: {
    http: 409,
    code: "ACTION_BLOCKED",
    retryable: true,
    message: "We couldn't complete that just now. Please try again.",
  },
};

// Attach the brand support contact (WhatsApp/email) when we can resolve the
// brand from the request, so the buyer always has a human to reach.
function supportFor(req) {
  const brand = req.brand || null;
  if (!brand) return null;
  const contact = getSupportContact(brand);
  if (!contact.whatsapp && !contact.email) return null;
  return {
    whatsapp: contact.whatsapp,
    email: contact.email,
    message: supportSentence(contact),
  };
}

/**
 * Kaizen-safe context for a 5xx AppError. safeContext() keeps only allowlisted
 * keys and stringifies what it keeps, so the per-gateway `attempts` array is
 * flattened here into one readable line ("nomba: HTTP 400 — …") rather than
 * being dropped as "[object Object]".
 */
function contextFor(err) {
  const meta = (err && err.metadata) || {};
  const ctx = { code: err.code };
  if (Array.isArray(meta.attempts) && meta.attempts.length) {
    ctx.gateway_attempts = meta.attempts
      .map((a) => `${a.provider}: ${a.error}`)
      .join(" | ");
  }
  return ctx;
}

// 4-arg signature is required for Express to recognise this as error handler eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const request_id = req.request_id;

  if (err instanceof AppError) {
    logger.warn(
      {
        request_id,
        code: err.code,
        http: err.http_status,
        user: req.user?.user_id,
      },
      err.message,
    );
    // A 5xx AppError is a genuine backend failure, not a user mistake — report
    // it to Kaizen. Without this, every deliberately-thrown server error
    // (ALL_GATEWAYS_FAILED, NOMBA_NOT_CONFIGURED, …) returned here and never
    // reached the Errors console: staff saw "Failed to generate payment link"
    // in the UI while Kaizen showed nothing at all. Fire-and-forget; the
    // error's own metadata (e.g. the per-gateway `attempts`) rides along so the
    // console shows WHICH gateway rejected the call and why.
    if (err.http_status >= 500) {
      captureError(err, req, {
        source: "backend",
        code: err.code,
        httpStatus: err.http_status,
        context: contextFor(err),
      });
    }
    // Surface recovery hints (order reference, retryable, support contact) from
    // the error's metadata so the buyer-facing client never dead-ends.
    const meta = err.metadata || {};
    return res.status(err.http_status).json({
      error: {
        code: err.code,
        message: err.user_message || err.message,
        fields: err.fields,
        ...(meta.retryable !== undefined ? { retryable: meta.retryable } : {}),
        ...(meta.order_id ? { order_id: meta.order_id } : {}),
        ...(meta.support ? { support: meta.support } : {}),
        // POTENTIAL_DUPLICATE: let the frontend show the existing orders.
        ...(meta.existing_orders
          ? { existing_orders: meta.existing_orders }
          : {}),
        // PERIOD_UNRECONCILED: let the payroll UI list/deep-link the days.
        ...(meta.unreconciled ? { unreconciled: meta.unreconciled } : {}),
        // NO_LONGER_ASSIGNED: name of the current assignee so the Stylist
        // Studio can render "reassigned to X → back to my jobs" instead
        // of a bare 403 wall.
        ...(meta.reassigned ? { reassigned: meta.reassigned } : {}),
      },
      request_id,
    });
  }

  if (err instanceof ZodError) {
    const fields = err.issues.reduce((acc, i) => {
      const path = i.path.join(".");
      if (!acc[path]) acc[path] = [];
      acc[path].push(i.message);
      return acc;
    }, {});
    logger.warn({ request_id, fields }, "validation error");
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid input", fields },
      request_id,
    });
  }

  // PG unique-violation / fk-violation surface as code-only — never raw message
  if (err.code === "23505") {
    logger.warn({ request_id, constraint: err.constraint }, "unique violation");
    return res.status(409).json({
      error: {
        code: "CONFLICT",
        message: "A record with these values already exists",
      },
      request_id,
    });
  }
  if (err.code === "23503") {
    logger.warn({ request_id, constraint: err.constraint }, "fk violation");
    return res.status(409).json({
      error: {
        code: "REFERENCE_INVALID",
        message: "Referenced record not found",
      },
      request_id,
    });
  }
  if (err.code === "23514") {
    logger.warn({ request_id, constraint: err.constraint }, "check violation");
    return res.status(400).json({
      error: {
        code: "INVALID_VALUE",
        message: "A value violates a domain constraint",
      },
      request_id,
    });
  }

  // Known-but-not-business Postgres codes: translate to a friendly, often
  // retryable message instead of the opaque 500. This is what stops a buyer
  // from getting stuck mid-checkout on a transient DB hiccup or a stray value.
  const friendly = err && err.code && PG_FRIENDLY[err.code];
  if (friendly) {
    logger.warn(
      { request_id, pg_code: err.code, constraint: err.constraint },
      "translated pg error",
    );
    // Report it. These are OUR failures — a deadlock, a statement timeout, a
    // transaction we aborted ourselves (25P02) — dressed in a soft, retryable
    // message so the user isn't dead-ended. Most map to a 4xx, which the
    // capture gate drops by default, so until now they were invisible: staff
    // saw "Something interrupted that step. Please try again." on the stylist
    // assign modal while the Errors console had no matching row. `force` puts
    // them on the board; the raw PG message ("current transaction is aborted…")
    // is what groups them, and the pg code is carried for the detail view.
    captureError(err, req, {
      source: "backend",
      httpStatus: friendly.http,
      force: true,
      context: { code: err.code, component: "postgres" },
    });
    const support = supportFor(req);
    return res.status(friendly.http).json({
      error: {
        code: friendly.code,
        message: friendly.message,
        retryable: friendly.retryable,
        ...(support ? { support } : {}),
      },
      request_id,
    });
  }

  // Fallthrough — unexpected. Still never a dead-end: apologise, invite a
  // retry, and hand the caller a reference (request id) they can quote.
  logger.error({ err, request_id }, "unhandled error");
  // Report the 500 to Kaizen (grouped + PII-redacted). Fire-and-forget: this
  // never blocks or breaks the response below.
  captureError(err, req, { source: "backend", httpStatus: 500 });
  // The "your card was not charged" reassurance + buyer support contact only
  // make sense on the public buyer flow (the checkout POST). Showing them for
  // an admin 500 — e.g. saving a campaign in the Landing Studio — is confusing
  // and alarming, because there is no card or order in play. Scope the payment
  // wording to the actual checkout route; everyone else gets a neutral message.
  const url = req.originalUrl || req.url || "";
  const isBuyerRoute = url.startsWith("/api/public");
  const isCheckout = isBuyerRoute && /\/checkout\b/.test(url);
  const support = isBuyerRoute ? supportFor(req) : null;
  const message = isCheckout
    ? "Something went wrong on our side. Your card was not charged — please try again in a moment."
    : "Something went wrong on our side — please try again in a moment.";
  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message,
      retryable: true,
      reference: request_id,
      ...(support ? { support } : {}),
    },
    request_id,
  });
}

module.exports = { errorHandler, notFoundHandler };
