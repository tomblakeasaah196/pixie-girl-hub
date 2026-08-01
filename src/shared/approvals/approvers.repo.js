/**
 * Who can approve this? — one answer for every module.
 *
 * Stock had this query inline; cash requests, expenses and purchasing each
 * needed their own copy, which is how modules drift apart (one honours role
 * expiry, another forgets the CEO, a third misses brand-scoped grants). The
 * approval spine asks HERE, so "approver" means the same thing everywhere:
 *
 *   the CEO, plus anyone holding a role granted <module>.approve for this
 *   brand (or all brands), whose grant hasn't expired, on an active account.
 *
 * That is exactly what `requirePermission(module, 'approve')` lets through at
 * the route, so nobody is asked to decide something the API would refuse them.
 */

"use strict";

const { ex } = require("../../config/database");

async function usersWhoCanApprove({ client, brand, module }) {
  const { rows } = await ex(client)(
    `SELECT DISTINCT u.user_id, u.email, u.display_name, u.is_ceo
       FROM shared.users u
      WHERE u.is_active = true
        AND (
          u.is_ceo = true
          OR u.user_id IN (
            SELECT ur.user_id
              FROM shared.user_roles ur
              JOIN shared.permissions p ON p.role_id = ur.role_id
             WHERE p.module = $2 AND p.action = 'approve'
               AND (ur.business = '*' OR ur.business = $1)
               AND (ur.expires_at IS NULL OR ur.expires_at > now())
          )
        )`,
    [brand, module],
  );
  return rows;
}

module.exports = { usersWhoCanApprove };
