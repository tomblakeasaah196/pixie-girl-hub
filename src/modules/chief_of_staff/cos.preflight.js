/**
 * Chief of Staff — plan-build-time pre-flight validation.
 *
 * A batch plan's steps used to be validated only when they RAN, so a bad field
 * (an assignee that's a name not a user_id, a missing required title, a stray
 * hallucinated key that a strict Zod validator rejects) surfaced as a run-time
 * failure AFTER the CEO approved — and, before dependency-aware execution, took
 * every later step down with it (docs/COS_ARCHITECTURE_AUDIT.md §3.2–3.4).
 *
 * preflight() moves those checks to build time using the catalogue action's own
 * `payload_schema` (the exact JSON-Schema contract the model was handed):
 *
 *   1. STRIP hallucinated keys — anything not in the schema's properties. This
 *      is what unblocks writes against `.strict()` endpoint validators, which
 *      reject the whole request on one unknown key.
 *   2. WARN (not block) on: a missing required field, a value outside an enum,
 *      an id-shaped field that isn't a UUID, or a datetime that won't parse.
 *      The warning rides on the step (preflight_note) and the plan card shows it
 *      BEFORE approval, so the CEO fixes it with the ✎ editor.
 *
 * Cross-step tokens (`{{step:N.field}}`) are unresolved at build time, so any
 * value that is (or contains) a token is treated as "will resolve at run time"
 * and skipped for format checks / counted as present for required. Pure, no I/O.
 */

"use strict";

const { parseFlexDatetime } = require("../../utils/validation");

const TOKEN_RE = /\{\{\s*step:\d+\.[a-zA-Z0-9_.]+\s*\}\}/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Fields whose value is an identifier resolved from a read/earlier step — a
// bare name or slug here is the classic "assign to Ada" failure.
const ID_LIKE = new Set(["id", "assigned_to", "taskId", "eventId", "mid", "milestone_id", "goal_id", "user_id", "contact_id"]);
// Fields the endpoints parse as flexible ISO datetimes.
const DATETIME_LIKE = new Set(["due_at", "start_at", "end_at", "remind_at"]);

/** Does this value (string / array / object) contain an unresolved step token? */
function containsToken(value) {
  if (typeof value === "string") return TOKEN_RE.test(value);
  if (Array.isArray(value)) return value.some(containsToken);
  if (value && typeof value === "object") return Object.values(value).some(containsToken);
  return false;
}

const isEmpty = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const isIdLike = (key) => ID_LIKE.has(key) || key.endsWith("_id");

/**
 * @param {object} args
 * @param {object} args.action   catalogue row (payload_schema is a JSON-Schema object)
 * @param {object} args.payload  the model's tool arguments for this step
 * @returns {{payload: object, note: string|null, dropped: string[]}}
 */
function preflight({ action, payload }) {
  const schema = action && action.payload_schema;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { payload: payload || {}, note: null, dropped: [] };
  }
  if (!schema || typeof schema !== "object" || schema.type !== "object" || !schema.properties) {
    return { payload, note: null, dropped: [] };
  }

  try {
    const props = schema.properties;
    const allowed = new Set(Object.keys(props));
    const required = Array.isArray(schema.required) ? schema.required : [];

    // 1. Strip hallucinated keys (anything not in the schema).
    const cleaned = {};
    const dropped = [];
    for (const [k, v] of Object.entries(payload)) {
      if (allowed.has(k)) cleaned[k] = v;
      else dropped.push(k);
    }

    // 2. Collect (non-blocking) warnings.
    const issues = [];

    for (const r of required) {
      const v = cleaned[r];
      if (isEmpty(v) && !containsToken(v)) issues.push(`missing “${r}”`);
    }

    for (const [k, v] of Object.entries(cleaned)) {
      if (isEmpty(v) || containsToken(v)) continue;
      const spec = props[k] || {};

      if (Array.isArray(spec.enum) && typeof v === "string" && !spec.enum.includes(v)) {
        issues.push(`“${k}” is “${v}”, expected one of: ${spec.enum.join(", ")}`);
        continue;
      }
      if (isIdLike(k) && typeof v === "string" && !UUID_RE.test(v)) {
        const hint =
          k === "assigned_to"
            ? "a teammate user_id from search_users"
            : "an id from a read/earlier step";
        issues.push(`“${k}” isn't a valid id (needs ${hint}, not “${String(v).slice(0, 40)}”)`);
        continue;
      }
      if (DATETIME_LIKE.has(k) && typeof v === "string") {
        if (!parseFlexDatetime(v, { dateOnlyTime: "12:00:00" })) {
          issues.push(`“${k}” isn't a valid date/time (“${String(v).slice(0, 40)}”)`);
        }
      }
    }

    const note = issues.length ? issues.join("; ") : null;
    return { payload: cleaned, note, dropped };
  } catch {
    // Never let a validation helper break plan building.
    return { payload, note: null, dropped: [] };
  }
}

module.exports = { preflight, containsToken, ID_LIKE, DATETIME_LIKE };
