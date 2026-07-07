/**
 * Stable per-device identifier for attendance device binding (000304).
 *
 * A random id minted once and persisted in localStorage, so every clock punch
 * from this browser/profile carries the same fingerprint. It is deliberately
 * simple: clearing site data, a fresh browser, or a new phone counts as a new
 * device that needs re-enrolling (the self-service email-OTP flow). This is a
 * possession signal to flag buddy-punching — NOT a cryptographic identity.
 */

const KEY = "pgh.device.fp";

export function getDeviceFingerprint(): string {
  try {
    let fp = localStorage.getItem(KEY);
    if (!fp) {
      fp = crypto.randomUUID();
      localStorage.setItem(KEY, fp);
    }
    return fp;
  } catch {
    // Private mode / storage disabled — fall back to a per-session id so the
    // punch still carries a fingerprint (it just won't match on next load).
    return `ephemeral-${crypto.randomUUID()}`;
  }
}
