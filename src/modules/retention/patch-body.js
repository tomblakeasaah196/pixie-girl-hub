/**
 * Shared helper for admin "edit" validators.
 *
 * The admin edit drawers load an existing row and submit the WHOLE object back
 * on save — including server-owned columns (ids, business, timestamps, counters)
 * and optional fields that are null in the database. Two things then break a
 * naive update validator:
 *
 *   1. `z.coerce.number()` coerces null → 0 (because Number(null) === 0), so a
 *      `.positive()` optional that was null in the DB fails with
 *      "Number must be greater than 0".
 *   2. `.strict()` schemas reject the extra server-owned keys outright
 *      ("Unrecognized key(s) in object: 'business', 'updated_at', …").
 *
 * `cleanPatch` drops null / undefined / "" values before validation, so a
 * `partial().strip()` schema accepts the round-tripped row: absent fields are
 * simply left unchanged, and unknown keys are stripped rather than rejected.
 */

"use strict";

function cleanPatch(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}

/** Validator middleware: clean the body, then parse with an update schema. */
const mkPatch = (schema) => (req, _res, next) => {
  req.body = schema.parse(cleanPatch(req.body));
  next();
};

module.exports = { cleanPatch, mkPatch };
