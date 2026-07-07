/**
 * Error fingerprinting — turns a noisy error into a stable signature so that
 * "the same bug" always lands in the same group, no matter how many times it
 * fires or which ids/values happen to be in the message.
 *
 *   signature   = normalise(message) | error_code | route_pattern | top_frame
 *   fingerprint = sha256(signature)
 *
 * Route + code + top stack frame keep genuinely-distinct bugs distinct even
 * when their messages collide. See guide §7.3.
 */

"use strict";

const crypto = require("crypto");

/**
 * Replace the volatile parts of a message with placeholders so that
 * "User 4f3c… not found" and "User 91ab… not found" normalise to the same
 * string. Order matters (UUID before hex before generic digits).
 */
function normalise(message) {
  if (!message) return "";
  let s = String(message).toLowerCase();

  s = s
    // UUIDs
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      "<uuid>",
    )
    // emails
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, "<email>")
    // quoted string literals: '...' or "..."
    .replace(/'[^']*'/g, "<str>")
    .replace(/"[^"]*"/g, "<str>")
    // long hex ids / hashes (tokens, object ids)
    .replace(/\b[0-9a-f]{16,}\b/g, "<hex>")
    // file line/column suffixes like :212:14
    .replace(/:\d+:\d+/g, ":<pos>")
    // decimals & integers
    .replace(/\b\d+\.\d+\b/g, "<num>")
    .replace(/\b\d+\b/g, "<num>")
    // collapse whitespace
    .replace(/\s+/g, " ")
    .trim();

  return s;
}

/**
 * Pull and normalise the top *application* stack frame. We strip absolute path
 * prefixes and line:col so the frame is stable across deploys/boxes.
 */
function topFrame(stack) {
  if (!stack) return "";
  const lines = String(stack).split("\n");
  // First line that looks like "    at fn (path:line:col)" — skip the message.
  const frame = lines.find((l) => /^\s*at\s+/.test(l));
  if (!frame) return "";
  return frame
    .trim()
    .replace(/[(]?\/[^\s()]+[)]?/g, (m) => {
      // keep only the tail of the path (e.g. modules/sales/sales.service.js)
      const cleaned = m.replace(/[()]/g, "");
      const parts = cleaned.split("/");
      return parts.slice(-3).join("/");
    })
    .replace(/:\d+:\d+/g, "")
    .toLowerCase();
}

/**
 * @param {object} parts
 * @param {string} [parts.message]
 * @param {string} [parts.errorCode]
 * @param {string} [parts.routePattern]
 * @param {string} [parts.stack]
 * @returns {{ fingerprint: string, title: string, signature: string }}
 */
function fingerprintOf({ message, errorCode, routePattern, stack }) {
  const normalisedMessage = normalise(message);
  const signature = [
    normalisedMessage,
    errorCode || "",
    routePattern || "",
    topFrame(stack),
  ].join("|");
  const fingerprint = crypto
    .createHash("sha256")
    .update(signature)
    .digest("hex");

  // Human title: prefer the original (untruncated-ish) message, else the code.
  const title =
    (message && String(message).split("\n")[0].slice(0, 300)) ||
    errorCode ||
    "Unknown error";

  return { fingerprint, title, signature };
}

module.exports = { fingerprintOf, normalise, topFrame };
