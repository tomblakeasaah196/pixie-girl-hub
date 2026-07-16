/**
 * Chief of Staff — humanise a failed step's error for the plan card.
 *
 * praxis.executor returns the endpoint's raw error body on failure (an AppError
 * envelope, a Zod field map, or a translated Postgres code). Storing that JSON
 * verbatim in execution_error made even a recoverable failure read as a system
 * crash (docs/COS_ARCHITECTURE_AUDIT.md §3.7). humaniseExecutionError turns it
 * into one plain sentence the CEO can act on; isValidationFailure decides
 * whether a failure is worth a self-repair attempt.
 */

"use strict";

// Friendly names for the fields the CoS actually writes.
const FIELD_LABEL = {
  title: "the title",
  body: "the note text",
  due_at: "the due date",
  start_at: "the start time",
  end_at: "the end time",
  remind_at: "the reminder time",
  assigned_to: "the assignee",
  event_type: "the event type",
  status: "the status",
  priority: "the priority",
  target_date: "the target date",
  reference_id: "the linked contact",
  reference_type: "the link type",
  participants: "the participants",
};

const labelFor = (key) => FIELD_LABEL[key] || `“${key}”`;

/** The error object, whether wrapped in {error:…} or not. */
function unwrap(result) {
  if (!result || typeof result !== "object") return {};
  return result.error && typeof result.error === "object" ? result.error : result;
}

/**
 * @param {{result:any, http_status?:number}} args
 * @returns {string} a single plain-language sentence
 */
function humaniseExecutionError({ result, http_status }) {
  const err = unwrap(result);
  const code = err.code;
  const baseMsg = err.user_message || err.message || null;

  // Field-level validation (Zod / AppError.fields) — most common, most fixable.
  if (err.fields && typeof err.fields === "object" && !Array.isArray(err.fields)) {
    const parts = Object.entries(err.fields)
      .slice(0, 4)
      .map(([k, msgs]) => {
        const first = Array.isArray(msgs) ? msgs[0] : msgs;
        return `${labelFor(k)} (${String(first).toLowerCase()})`;
      });
    if (parts.length) return `Some details need fixing: ${parts.join(", ")}.`;
  }

  switch (code) {
    case "REFERENCE_INVALID":
      return "This step points to a record that doesn't exist yet — usually an assignee or linked item that couldn't be found. Check that id and retry.";
    case "CONFLICT":
      return baseMsg || "This clashes with something that already exists.";
    case "INVALID_VALUE":
      return "A value here isn't allowed — check the highlighted field and retry.";
    case "FORBIDDEN":
      return "You don't have permission to do this — it's outside the Chief of Staff's remit.";
    case "NOT_FOUND":
      return baseMsg || "The item this step refers to couldn't be found.";
    default:
      break;
  }

  if (baseMsg && code !== "VALIDATION_ERROR") return baseMsg;
  if (typeof http_status === "number" && http_status >= 500) {
    return "The server hit an error running this step — try again in a moment.";
  }
  return baseMsg || "This step couldn't be completed.";
}

/** A failure that a corrected payload could plausibly fix (worth self-repair). */
function isValidationFailure({ result, http_status }) {
  const code = unwrap(result).code;
  if (http_status === 400 || http_status === 422) return true;
  return ["VALIDATION_ERROR", "INVALID_VALUE", "REFERENCE_INVALID"].includes(code);
}

module.exports = { humaniseExecutionError, isValidationFailure };
