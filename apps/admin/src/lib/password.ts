/**
 * Password policy — mirrors the backend validator
 * (src/shared/hr_payroll/auth.service.js assertStrongPassword).
 *
 * Rule: at least 8 characters, one uppercase letter, one number, and one
 * special character. Kept here so the UI can show a live strength meter and
 * block submit before a round-trip; the API is still the real boundary.
 */

export interface PasswordCheck {
  ok: boolean;
  hasLength: boolean;
  hasUpper: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
  /** First unmet rule, as a human sentence (null when ok). */
  error: string | null;
}

export const PASSWORD_RULE_TEXT =
  "At least 8 characters, with an uppercase letter, a number, and a special character.";

export function checkPassword(pw: string): PasswordCheck {
  const hasLength = pw.length >= 8;
  const hasUpper = /[A-Z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  const hasSpecial = /[^A-Za-z0-9]/.test(pw);

  let error: string | null = null;
  if (!hasLength) error = "Must be at least 8 characters";
  else if (!hasUpper) error = "Add an uppercase letter";
  else if (!hasNumber) error = "Add a number";
  else if (!hasSpecial) error = "Add a special character";

  return {
    ok: hasLength && hasUpper && hasNumber && hasSpecial,
    hasLength,
    hasUpper,
    hasNumber,
    hasSpecial,
    error,
  };
}

/** A 0..4 score for the strength bar (one point per satisfied rule). */
export function passwordScore(pw: string): number {
  const c = checkPassword(pw);
  return [c.hasLength, c.hasUpper, c.hasNumber, c.hasSpecial].filter(Boolean)
    .length;
}

/** Six-digit PIN validation, mirroring the backend (no trivial PINs). */
export function checkPin(pin: string): { ok: boolean; error: string | null } {
  if (!/^\d{6}$/.test(pin)) return { ok: false, error: "PIN must be 6 digits" };
  if (/^(\d)\1{5}$/.test(pin))
    return { ok: false, error: "Avoid a repeated digit" };
  if ("0123456789".includes(pin) || "9876543210".includes(pin))
    return { ok: false, error: "Avoid a sequential PIN" };
  return { ok: true, error: null };
}
