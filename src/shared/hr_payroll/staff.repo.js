/**
 * Staff (user) repository.
 * Backs auth + HR profile screens.
 *
 * Tables: shared.users, shared.staff_profiles, shared.user_business_access
 */

"use strict";

const { query } = require("../../config/database");

async function findById(userId) {
  const { rows } = await query(
    `SELECT u.user_id, u.email, u.display_name, u.password_hash, u.status, u.is_ceo,
            u.default_business_key, u.failed_login_count,
            COALESCE((SELECT array_agg(role_id) FROM shared.user_roles ur WHERE ur.user_id = u.user_id), '{}') AS role_ids,
            COALESCE((SELECT array_agg(business_key) FROM shared.user_business_access uba WHERE uba.user_id = u.user_id), '{}') AS available_businesses
       FROM shared.users u
      WHERE u.user_id = $1
      LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

async function findByEmail(email) {
  const { rows } = await query(
    `SELECT u.user_id, u.email, u.display_name, u.password_hash, u.status, u.is_ceo,
            u.default_business_key, u.failed_login_count,
            COALESCE((SELECT array_agg(business_key) FROM shared.user_business_access uba WHERE uba.user_id = u.user_id), '{}') AS available_businesses
       FROM shared.users u
      WHERE u.email = $1
      LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

async function recordFailedLogin(userId) {
  await query(
    `UPDATE shared.users
        SET failed_login_count = failed_login_count + 1,
            status = CASE WHEN failed_login_count + 1 >= 5 THEN 'locked' ELSE status END
      WHERE user_id = $1`,
    [userId],
  );
}

async function recordSuccessfulLogin(userId, { ip, user_agent }) {
  await query(
    `UPDATE shared.users
        SET failed_login_count = 0,
            last_login_at = now(),
            last_login_ip = $2,
            last_login_user_agent = $3
      WHERE user_id = $1`,
    [userId, ip, user_agent],
  );
}

/**
 * Set a new password hash (used by the password-reset flow). Also clears the
 * failed-login counter and lifts a 'locked' status back to 'active' — a
 * successful reset is a legitimate way to recover a locked-out account. Other
 * statuses (e.g. suspended) are left untouched.
 */
async function updatePassword(userId, passwordHash) {
  await query(
    `UPDATE shared.users
        SET password_hash = $2,
            failed_login_count = 0,
            status = CASE WHEN status = 'locked' THEN 'active' ELSE status END
      WHERE user_id = $1`,
    [userId, passwordHash],
  );
}

module.exports = {
  findById,
  findByEmail,
  recordFailedLogin,
  recordSuccessfulLogin,
  updatePassword,
};
