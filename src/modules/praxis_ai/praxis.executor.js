/**
 * Praxis action executor (V2.2 §6.29) — runs a CONFIRMED pending action by
 * calling the real catalogued endpoint over loopback HTTP with the confirming
 * user's own Authorization header.
 *
 * Self-HTTP (rather than an internal function call) is deliberate: the
 * request re-enters the full middleware pipeline — auth, brand context, RBAC,
 * Zod validation, audit, rate-limit loopback skip — so Praxis can never do
 * more than the confirming user could do by hand, exactly as the spec's
 * "acts with the user's own permissions, never elevates" rule demands. The
 * catalogue row supplies method + route + payload; nothing outside the
 * catalogue is constructible.
 */

"use strict";

const axios = require("axios");
const { config } = require("../../config/env");
const { AppError } = require("../../utils/errors");

// Keep stored execution results bounded — a big list response must not bloat
// the ai_pending_actions row (the UI links to the record, it doesn't re-render
// the whole payload).
const RESULT_MAX_CHARS = 4000;

function trimResult(data) {
  try {
    const s = JSON.stringify(data);
    if (s.length <= RESULT_MAX_CHARS) return data;
    return { _truncated: true, preview: s.slice(0, RESULT_MAX_CHARS) };
  } catch {
    return { _unserialisable: true };
  }
}

/**
 * Substitute :params in a catalogued route from the payload. Substituted keys
 * leave the body so strict Zod validators don't reject them as unknown fields.
 * Throws when a route parameter has no value — the model failed to fill it,
 * and guessing would be worse than asking.
 */
function resolveRoute(route, payload) {
  const body = { ...(payload || {}) };
  const missing = [];
  const resolved = route.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, key) => {
    const v = body[key];
    if (v === undefined || v === null || v === "") {
      missing.push(key);
      return `:${key}`;
    }
    delete body[key];
    return encodeURIComponent(String(v));
  });
  if (missing.length) {
    throw new AppError(
      "ACTION_ROUTE_PARAMS_MISSING",
      `The proposed action is missing route parameter(s): ${missing.join(", ")}`,
      422,
      {
        user_message:
          "This action is missing a required reference — ask Praxis to include it and try again.",
      },
    );
  }
  return { path: resolved, body };
}

/**
 * Execute one confirmed pending action.
 * @param {object} args
 * @param {object} args.pending     The ai_pending_actions row (method, route, payload, business).
 * @param {string} args.authHeader  The confirming request's Authorization header.
 * @param {string} [args.requestId] Correlation id threaded through to the nested call.
 * @returns {Promise<{ok: boolean, http_status: number, result: any}>}
 */
async function executeAction({ pending, authHeader, requestId }) {
  const method = String(pending.method || "post").toLowerCase();
  const { path, body } = resolveRoute(pending.route, pending.payload);

  const res = await axios({
    method,
    url: `http://127.0.0.1:${config.PORT}${path}`,
    headers: {
      Authorization: authHeader,
      "X-Brand-Context": pending.business || "",
      "Content-Type": "application/json",
      ...(requestId ? { "X-Request-Id": requestId } : {}),
    },
    data: method === "get" || method === "delete" ? undefined : body,
    params: method === "get" ? body : undefined,
    timeout: 30_000,
    // We translate HTTP failures ourselves so the caller can markFailed with
    // the endpoint's real error body instead of an axios throw.
    validateStatus: () => true,
  });

  return {
    ok: res.status < 400,
    http_status: res.status,
    result: trimResult(res.data),
  };
}

module.exports = { executeAction, resolveRoute };
