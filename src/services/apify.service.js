/**
 * Apify REST client — thin wrapper, no SDK dependency (matches how this
 * codebase talks to WhatsApp/Instagram: plain axios calls against the
 * provider's REST API, see messaging-accounts.service.js).
 *
 * Two things a caller needs from Apify:
 *   - testConnection(apiKey) — confirm the token is live (GET /users/me)
 *   - runActorSync(...)      — run one actor to completion and get its
 *                               dataset items back in a single call, via
 *                               Apify's "run-sync-get-dataset-items" endpoint
 *                               (no run-polling needed for a single-profile
 *                               scrape that finishes in a few seconds)
 *
 * Actor ids are written "author/actor-name" everywhere in Apify's own UI and
 * docs (and that's how they're stored in shared.social_platforms), but the
 * REST path form replaces the slash with a tilde — toActorPath() below does
 * that translation so callers never have to think about it.
 */

"use strict";

const axios = require("axios");
const { AppError } = require("../utils/errors");

const BASE_URL = "https://api.apify.com/v2";
const DEFAULT_TIMEOUT_MS = 60_000;

function toActorPath(actorId) {
  return String(actorId).replace("/", "~");
}

function unwrapApifyError(err) {
  const status = err.response && err.response.status;
  const body = err.response && err.response.data;
  const apiError = body && body.error;
  if (apiError && apiError.message) {
    const parts = [apiError.message];
    if (apiError.type) parts.push(`(${apiError.type})`);
    return {
      message: parts.join(" "),
      status: status && status >= 400 && status < 500 ? status : 502,
    };
  }
  return {
    message: err.message || "Apify request failed",
    status: status && status >= 400 && status < 500 ? status : 502,
  };
}

/**
 * Confirm an API key is live. Returns the account's public identity so the
 * Test button can show something concrete (matches the WhatsApp/Facebook
 * "Test" pattern of surfacing provider_name/provider_id).
 */
async function testConnection({ apiKey }) {
  if (!apiKey) {
    throw new AppError("NO_TOKEN", "No Apify API key saved", 422);
  }
  try {
    const { data } = await axios.get(`${BASE_URL}/users/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15_000,
    });
    const user = data && data.data;
    return {
      ok: true,
      username: (user && user.username) || null,
      email: (user && user.email) || null,
      plan: (user && user.plan && user.plan.id) || null,
    };
  } catch (err) {
    const { message, status } = unwrapApifyError(err);
    throw new AppError("PROVIDER_PING_FAILED", message, status);
  }
}

/**
 * Substitute {{handle}} / {{profile_url}} placeholders in a platform's
 * stored input template. Leaves any other key untouched — this is
 * deliberately not a general templating engine, just enough to fill in the
 * two values every profile-scraper input needs one of.
 */
function buildActorInput(template, { handle, profile_url }) {
  const json = JSON.stringify(template || {});
  const filled = json
    .replace(/\{\{handle\}\}/g, handle || "")
    .replace(/\{\{profile_url\}\}/g, profile_url || "");
  return JSON.parse(filled);
}

/**
 * Run an actor to completion and return its dataset items. Uses Apify's
 * synchronous "run-sync-get-dataset-items" endpoint — right fit for a
 * single-profile scrape that Apify's own docs describe as a short-lived run
 * (seconds), not the async run/poll/dataset-fetch dance a long batch job
 * would need.
 */
async function runActorSync({ apiKey, actorId, input, timeoutSecs = 90 }) {
  if (!apiKey) {
    throw new AppError("NO_TOKEN", "No Apify API key saved", 422);
  }
  if (!actorId) {
    throw new AppError(
      "NO_ACTOR",
      "This platform has no Apify actor configured yet",
      422,
    );
  }
  try {
    const { data } = await axios.post(
      `${BASE_URL}/acts/${toActorPath(actorId)}/run-sync-get-dataset-items`,
      input || {},
      {
        params: { token: apiKey, timeout: timeoutSecs },
        headers: { "Content-Type": "application/json" },
        timeout: (timeoutSecs + 15) * 1000,
      },
    );
    return Array.isArray(data) ? data : [];
  } catch (err) {
    const { message, status } = unwrapApifyError(err);
    throw new AppError("ACTOR_RUN_FAILED", message, status);
  }
}

module.exports = {
  testConnection,
  runActorSync,
  buildActorInput,
  DEFAULT_TIMEOUT_MS,
};
