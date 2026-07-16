"use strict";

/**
 * CoS error humaniser (cos.errors.js) — turns a raw endpoint error body into
 * one plain sentence, and decides which failures are worth a self-repair retry.
 */

const {
  humaniseExecutionError,
  isValidationFailure,
} = require("../../../src/modules/chief_of_staff/cos.errors");

test("field-level validation errors read as a fixable sentence", () => {
  const msg = humaniseExecutionError({
    result: { error: { code: "VALIDATION_ERROR", message: "Invalid input", fields: { due_at: ["Invalid datetime"] } } },
    http_status: 400,
  });
  expect(msg).toMatch(/due date/i);
  expect(msg).not.toMatch(/[{}]/); // no raw JSON leaks through
});

test("a bad foreign reference explains the likely cause", () => {
  const msg = humaniseExecutionError({
    result: { error: { code: "REFERENCE_INVALID", message: "Referenced record not found" } },
    http_status: 409,
  });
  expect(msg).toMatch(/doesn't exist|assignee|linked/i);
});

test("prefers a user_message when present", () => {
  const msg = humaniseExecutionError({
    result: { error: { code: "SOMETHING", message: "Raw", user_message: "A friendly hint." } },
    http_status: 422,
  });
  expect(msg).toBe("A friendly hint.");
});

test("falls back to a generic sentence for a 500", () => {
  const msg = humaniseExecutionError({ result: { error: {} }, http_status: 500 });
  expect(msg).toMatch(/server|try again/i);
});

test("isValidationFailure flags 400/422 and known validation codes", () => {
  expect(isValidationFailure({ result: {}, http_status: 400 })).toBe(true);
  expect(isValidationFailure({ result: {}, http_status: 422 })).toBe(true);
  expect(isValidationFailure({ result: { error: { code: "REFERENCE_INVALID" } }, http_status: 409 })).toBe(true);
  expect(isValidationFailure({ result: { error: { code: "FORBIDDEN" } }, http_status: 403 })).toBe(false);
  expect(isValidationFailure({ result: {}, http_status: 500 })).toBe(false);
});
