/**
 * HR field helpers (pure — no crypto, no DB).
 *
 * The actual AES encryption/decryption of staff PII happens in hr.repo.js via
 * services/encryption.service. These helpers cover the parts that are pure and
 * worth testing in isolation: which fields are sensitive, how to mask a
 * decrypted value for a non-owner viewer, and the KPI weight-sum rule.
 */

"use strict";

// Staff fields stored AES-encrypted at rest (per shared.staff_profiles schema).
const ENCRYPTED_FIELDS = [
  "bank_account_number",
  "bank_sort_code",
  "nin",
  "bvn",
];

/** Mask a decrypted value for a viewer who isn't allowed to see it in full. */
function maskField(field, value) {
  if (value === null || value === undefined || value === "") return value;
  const s = String(value);
  // Account numbers: reveal only the last 4 digits.
  if (field === "bank_account_number" && s.length >= 4) {
    return `••••${s.slice(-4)}`;
  }
  // NIN / BVN / sort code: fully masked.
  return "••••••";
}

/**
 * Return a copy of a staff row with sensitive fields masked unless the viewer
 * may see them (owner/CEO, or the staff member viewing their own record).
 */
function redactStaff(staff, canSeeSensitive) {
  if (!staff || canSeeSensitive) return staff;
  const out = { ...staff };
  for (const f of ENCRYPTED_FIELDS) {
    if (out[f] !== undefined) out[f] = maskField(f, out[f]);
  }
  return out;
}

function redactStaffList(rows, canSeeSensitive) {
  return rows.map((r) => redactStaff(r, canSeeSensitive));
}

// ── KPI weights (V2.2 §6.11: the 40/25/20/15 weighted appraisal) ──

const WEIGHT_TARGET = 100;
const WEIGHT_EPSILON = 0.01; // tolerate float rounding on NUMERIC(5,2)

function kpiWeightsTotal(defs) {
  return defs.reduce((sum, d) => sum + Number(d.weight_pct || 0), 0);
}

/** Active KPI weights must total 100. */
function kpiWeightsValid(total) {
  return Math.abs(total - WEIGHT_TARGET) <= WEIGHT_EPSILON;
}

module.exports = {
  ENCRYPTED_FIELDS,
  maskField,
  redactStaff,
  redactStaffList,
  kpiWeightsTotal,
  kpiWeightsValid,
  WEIGHT_TARGET,
};
