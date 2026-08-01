/**
 * Scoped service tokens — machine JWTs that let a background process re-enter
 * the REST surface AS a real user, without a human session behind them.
 *
 * First (and so far only) class: `cos_plan_exec`. Minted at Chief-of-Staff
 * plan-confirm time — while the CEO's request is live and fully authorized —
 * and handed to the BullMQ job that executes the plan's steps over loopback
 * HTTP. The middleware (middleware/auth.js) accepts it WITHOUT the
 * idle-session check (there is no sid; the CEO may have closed the tab), but
 * still resolves the real user so brand context + RBAC apply unchanged.
 *
 * Blast-radius containment (all three by design):
 *   1. Route scope — the token is only accepted on the CoS workspace surface
 *      (ALLOWED_PATH_PREFIXES below, mirroring the catalogue's `workspace.*`
 *      action routes). A leaked token cannot touch sales/cash/HR.
 *   2. Short TTL — 2h: ≥ the longest expected plan run, ≤ the plan's own
 *      expiry. It dies with the plan.
 *   3. Never at rest in Postgres — it lives only on the job payload (Redis)
 *      and is never logged.
 */

"use strict";

const jwt = require("jsonwebtoken");
const { config } = require("../../config/env");

/** `typ` claim marking a plan-execution service token. */
const COS_PLAN_EXEC_TYP = "cos_plan_exec";

/** How long a minted token stays valid. */
const COS_PLAN_EXEC_TTL = "2h";

/**
 * The only route prefixes a cos_plan_exec token is accepted on — the CoS
 * catalogue's workspace surface (see migrations 000324/000333/000335/000347).
 * Compared against the absolute request path (req.originalUrl minus query),
 * so the check is independent of where the auth middleware is mounted.
 */
const COS_PLAN_EXEC_ALLOWED_PATH_PREFIXES = [
  "/api/v1/goals",
  "/api/v1/tasks",
  "/api/v1/calendar",
  "/api/v1/notes",
  "/api/v1/contacts",
];

/**
 * Mint a plan-execution service token for the confirming user. `sub` is the
 * real user id — auth resolves it through the identity cache exactly like a
 * human token, so downstream RBAC/audit see the CEO, not a robot principal.
 *
 * @param {object} args
 * @param {string} args.user_id  The confirming user's uuid (becomes `sub`).
 * @param {string} args.plan_id  The plan this token may execute.
 * @param {string} args.brand    The plan's business key (informational claim).
 * @returns {string} signed JWT
 */
function mintCosPlanExecToken({ user_id, plan_id, brand }) {
  return jwt.sign(
    { sub: user_id, typ: COS_PLAN_EXEC_TYP, plan_id, brand },
    config.JWT_SECRET,
    { expiresIn: COS_PLAN_EXEC_TTL },
  );
}

/**
 * Is this absolute path (no query string) within the workspace surface a
 * cos_plan_exec token may touch? Exact prefix or prefix + "/" — so
 * `/api/v1/goalsxyz` does NOT pass on the `/api/v1/goals` prefix.
 */
function isCosPlanExecPathAllowed(path) {
  const p = String(path || "");
  return COS_PLAN_EXEC_ALLOWED_PATH_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(`${prefix}/`),
  );
}

module.exports = {
  COS_PLAN_EXEC_TYP,
  COS_PLAN_EXEC_TTL,
  COS_PLAN_EXEC_ALLOWED_PATH_PREFIXES,
  mintCosPlanExecToken,
  isCosPlanExecPathAllowed,
};
