/**
 * Device-recognition decision (migration 000304) — pure, no I/O.
 *
 * Decides whether a clock punch should be treated as coming from a KNOWN
 * device, an UNKNOWN one (flag red — never block), or as NOT APPLICABLE.
 * Kept pure so the policy is unit-tested in isolation; selfClock does the DB
 * lookups and feeds the result in.
 *
 * Policy (product decision 2026-07-07):
 *   - CEO is exempt → null (never flagged).
 *   - An employee who has enrolled NO device yet → null (neutral; we don't
 *     red-flag the rollout, the widget nudges them to enrol).
 *   - Otherwise: the punch fingerprint must match one of their active devices.
 *     Match → true. No match (wrong/absent fingerprint) → false = the
 *     buddy-punch signal that drives the red marker + HR query.
 *
 * @param {object}  args
 * @param {boolean} args.isCeo          req.user.is_ceo
 * @param {number}  args.enrolledCount  active enrolled devices for the employee
 * @param {boolean} args.hasMatch       the punch fingerprint matched one of them
 * @returns {boolean|null} device_recognized
 */
function evaluateDeviceRecognition({ isCeo, enrolledCount, hasMatch }) {
  if (isCeo) return null;
  if (!enrolledCount || enrolledCount <= 0) return null;
  return Boolean(hasMatch);
}

module.exports = { evaluateDeviceRecognition };
