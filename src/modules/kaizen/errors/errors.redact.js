/**
 * PII redaction for captured errors. Error payloads and logs may contain
 * customer data; we store the LEAST data that still lets us fix the bug.
 *
 * Two layers (belt-and-braces), per guide §7.3:
 *   1. Allowlist context: only known-safe keys are kept from a request.
 *   2. Scrub: any free text (message, stack, kept values) has email / phone /
 *      long-digit / token-ish patterns replaced with [redacted].
 *
 * We NEVER store: request body values, authorization/cookie headers, tokens,
 * passwords, PINs, bank/account numbers, emails, phones, names, addresses.
 * User identity is stored only as an opaque salted hash (never the raw id).
 */

"use strict";

const crypto = require("crypto");

// Keys we consider safe to keep from a request context. Everything else is
// dropped. Kept deliberately small.
const SAFE_CONTEXT_KEYS = new Set([
  "resource_type",
  "module",
  "action",
  "queue",
  "jobId",
  "job_name",
  "app_version",
  "component",
  "count",
  "code",
  // Per-gateway failure trail on a payment-link 5xx ("nomba: HTTP 400 — …"),
  // so the Errors console names the gateway that rejected the checkout.
  "gateway_attempts",
]);

// Patterns scrubbed from any free text we do keep. ORDER MATTERS: emails first,
// then long token-ish runs (so a 32+ char token is caught WHOLE before the
// digit scrubbers can fragment it), then phones, then bare long-digit runs.
const SCRUBBERS = [
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[redacted-email]"],
  // bearer / token-ish long alphanumerics (before digit scrubbers)
  [/[A-Za-z0-9_-]{32,}/g, "[redacted-token]"],
  // + country code / spaced phone numbers (>= 7 digits with separators)
  [/(?:\+?\d[\s-]?){7,}\d/g, "[redacted-phone]"],
  // long digit runs (accounts, cards, pins concatenated)
  [/\b\d{7,}\b/g, "[redacted-num]"],
];

function scrub(text) {
  if (text == null) return text;
  let s = String(text);
  for (const [re, rep] of SCRUBBERS) s = s.replace(re, rep);
  return s;
}

/** Opaque, salted, one-way user reference — never the raw id/email. */
function opaqueUserRef(rawId, salt) {
  if (!rawId) return null;
  return crypto
    .createHash("sha256")
    .update(String(rawId) + "|" + (salt || ""))
    .digest("hex")
    .slice(0, 32);
}

/** Keep only allowlisted, scrubbed keys from an arbitrary context object. */
function safeContext(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input)) {
    if (!SAFE_CONTEXT_KEYS.has(k)) continue;
    if (v == null) continue;
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else out[k] = scrub(String(v)).slice(0, 500);
  }
  return out;
}

module.exports = { scrub, opaqueUserRef, safeContext, SAFE_CONTEXT_KEYS };
