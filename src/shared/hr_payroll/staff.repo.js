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
    `SELECT u.user_id, u.email, u.display_name, u.password_hash, u.pin_hash,
            u.status, u.is_ceo, u.default_business_key, u.failed_login_count,
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
    `SELECT u.user_id, u.email, u.display_name, u.password_hash, u.pin_hash,
            u.status, u.is_ceo,
            u.default_business_key, u.failed_login_count,
            COALESCE((SELECT array_agg(r.role_name)
                        FROM shared.user_roles ur
                        JOIN shared.roles r ON r.role_id = ur.role_id
                       WHERE ur.user_id = u.user_id), '{}') AS role_names,
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

// ── PIN credentials ──────────────────────────────────────
/**
 * Set (or replace) a user's login PIN. Stores the argon2 hash, stamps
 * pin_set_at and clears any accumulated PIN-failure count.
 */
async function setPin(userId, pinHash) {
  await query(
    `UPDATE shared.users
        SET pin_hash = $2,
            pin_set_at = now(),
            pin_failed_count = 0
      WHERE user_id = $1`,
    [userId, pinHash],
  );
}

/** Remove a user's PIN entirely (disables PIN login for the account). */
async function clearPin(userId) {
  await query(
    `UPDATE shared.users
        SET pin_hash = NULL,
            pin_set_at = NULL,
            pin_failed_count = 0
      WHERE user_id = $1`,
    [userId],
  );
}

/**
 * Record a failed PIN attempt. Mirrors recordFailedLogin: at 5 strikes
 * the account is locked, so a brute-forced PIN can't outpace a
 * brute-forced password.
 */
async function recordPinFail(userId) {
  await query(
    `UPDATE shared.users
        SET pin_failed_count = pin_failed_count + 1,
            status = CASE WHEN pin_failed_count + 1 >= 5 THEN 'locked' ELSE status END
      WHERE user_id = $1`,
    [userId],
  );
}

/**
 * Record a successful PIN login. Resets the PIN-failure counter and
 * updates last_login_* the same way a password login does.
 */
async function recordPinSuccess(userId, { ip, user_agent }) {
  await query(
    `UPDATE shared.users
        SET pin_failed_count = 0,
            failed_login_count = 0,
            last_login_at = now(),
            last_login_ip = $2,
            last_login_user_agent = $3
      WHERE user_id = $1`,
    [userId, ip, user_agent],
  );
}

async function findByIdWithProfile(userId) {
  const { rows } = await query(
    `SELECT u.user_id, u.email, u.display_name, u.is_ceo, u.default_business_key,
            u.avatar_url, u.phone, u.status,
            sp.job_title, sp.department, sp.employee_number,
            COALESCE(
              (SELECT array_agg(business_key) FROM shared.user_business_access uba WHERE uba.user_id = u.user_id),
              '{}'
            ) AS available_businesses
       FROM shared.users u
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
      WHERE u.user_id = $1
      LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

async function updateUserProfile(userId, { display_name, avatar_url, phone }) {
  const sets = [];
  const vals = [userId];
  if (display_name !== undefined) { vals.push(display_name); sets.push(`display_name = $${vals.length}`); }
  if (avatar_url !== undefined) { vals.push(avatar_url); sets.push(`avatar_url = $${vals.length}`); }
  if (phone !== undefined) { vals.push(phone); sets.push(`phone = $${vals.length}`); }
  if (!sets.length) return;
  await query(`UPDATE shared.users SET ${sets.join(', ')} WHERE user_id = $1`, vals);
}

module.exports = {
  findById,
  findByEmail,
  recordFailedLogin,
  recordSuccessfulLogin,
  updatePassword,
  setPin,
  clearPin,
  recordPinFail,
  recordPinSuccess,
  findByIdWithProfile,
  updateUserProfile,
};
