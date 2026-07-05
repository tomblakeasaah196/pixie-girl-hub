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
  "40001": { http: 409, code: "TEMPORARY_CONFLICT", retryable: true, message: "We hit a brief traffic spike. Please tap pay again." },
  "40P01": { http: 409, code: "TEMPORARY_CONFLICT", retryable: true, message: "We hit a brief traffic spike. Please tap pay again." },
  "55P03": { http: 409, code: "TEMPORARY_CONFLICT", retryable: true, message: "That item is being updated by another order. Please try again." },
  "57014": { http: 503, code: "SERVICE_BUSY", retryable: true, message: "We're under heavy load right now. Please try again in a moment." },
  "53300": { http: 503, code: "SERVICE_BUSY", retryable: true, message: "We're under heavy load right now. Please try again in a moment." },
  "53400": { http: 503, code: "SERVICE_BUSY", retryable: true, message: "We're under heavy load right now. Please try again in a moment." },
  "08000": { http: 503, code: "SERVICE_BUSY", retryable: true, message: "We couldn't reach our system briefly. Please try again." },
  "08003": { http: 503, code: "SERVICE_BUSY", retryable: true, message: "We couldn't reach our system briefly. Please try again." },
  "08006": { http: 503, code: "SERVICE_BUSY", retryable: true, message: "We couldn't reach our system briefly. Please try again." },
  "25P02": { http: 409, code: "TEMPORARY_CONFLICT", retryable: true, message: "Something interrupted that step. Please try again." },
  // Input-shaped — a value was missing/too long/wrong format. 400, not retryable
  // as-is, but framed so the buyer knows to check their details.
  "23502": { http: 400, code: "MISSING_VALUE", retryable: false, message: "A required detail was missing. Please check your form and try again." },
  "22001": { http: 400, code: "VALUE_TOO_LONG", retryable: false, message: "One of the values you entered is too long. Please shorten it and try again." },
  "22003": { http: 400, code: "VALUE_OUT_OF_RANGE", retryable: false, message: "One of the values you entered is out of range. Please check and try again." },
  "22P02": { http: 400, code: "INVALID_VALUE", retryable: false, message: "One of the values you entered is in the wrong format. Please check and try again." },
  // A trigger / stored function raised. Could be config or a guard — keep it
  // soft and pointed at support.
  P0001: { http: 409, code: "ACTION_BLOCKED", retryable: true, message: "We couldn't complete that just now. Please try again." },
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
        ...(meta.existing_orders ? { existing_orders: meta.existing_orders } : {}),
        // PERIOD_UNRECONCILED: let the payroll UI list/deep-link the days.
        ...(meta.unreconciled ? { unreconciled: meta.unreconciled } : {}),
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
