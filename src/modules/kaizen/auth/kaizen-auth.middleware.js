/**
 * Kaizen operator auth middleware.
 *
 * Verifies the KAIZEN access token (separate secret + `aud: "kaizen"`) and
 * attaches req.operator. A platform (shared.users) token can NEVER satisfy this
 * — different secret and audience — which is the hard access boundary.
 */

"use strict";

const { AppError } = require("../../../utils/errors");
const service = require("./kaizen-auth.service");
const repo = require("./kaizen-auth.repo");

async function kaizenAuthMiddleware(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new AppError("KAIZEN_AUTH_REQUIRED", "Authorization required", 401);
  }
  let payload;
  try {
    payload = service.verifyAccessToken(header.slice("Bearer ".length).trim());
  } catch (err) {
    if (err instanceof AppError) throw err; // e.g. KAIZEN_NOT_CONFIGURED
    throw new AppError("KAIZEN_INVALID_TOKEN", "Invalid or expired token", 401);
  }

  const op = await repo.findOperatorById(payload.sub);
  if (!op || op.status !== "active") {
    throw new AppError("KAIZEN_OPERATOR_INACTIVE", "Operator not active", 401);
  }

  req.operator = {
    operator_id: op.operator_id,
    email: op.email,
    display_name: op.display_name,
    must_change_password: op.must_change_password === true,
  };
  return next();
}

module.exports = { kaizenAuthMiddleware };
