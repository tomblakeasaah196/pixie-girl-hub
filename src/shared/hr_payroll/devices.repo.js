/**
 * Device-binding repository (migration 000304).
 *
 * Parameterised SQL for shared.staff_devices + shared.device_change_log.
 * Brand-scoped via the same VISIBLE predicate the rest of HR uses. Repos
 * never emit events or touch req/res — the service layer does that.
 */

"use strict";

const { ex: exec } = require("../../config/database");

// Staff visible to a brand: primary brand OR listed as an additional brand.
const VISIBLE = `(sp.business = $1 OR $1 = ANY(sp.additional_businesses))`;

// ── enrolled devices ───────────────────────────────────────
/** Active devices for one employee (My HR list + enforcement). */
async function listActiveByProfile({ client, profileId }) {
  const { rows } = await exec(client)(
    `SELECT device_id, device_fingerprint, device_label, device_type,
            enrolled_at, last_seen_at, last_ip, is_active
       FROM shared.staff_devices
      WHERE profile_id = $1 AND is_active = true
      ORDER BY enrolled_at ASC`,
    [profileId],
  );
  return rows;
}

/** Count of active devices for the cap check. */
async function countActive({ client, profileId }) {
  const { rows } = await exec(client)(
    `SELECT count(*)::int AS n
       FROM shared.staff_devices
      WHERE profile_id = $1 AND is_active = true`,
    [profileId],
  );
  return rows[0].n;
}

/** The active device matching a fingerprint, if any (enforcement lookup). */
async function findActiveByFingerprint({ client, profileId, fingerprint }) {
  if (!fingerprint) return null;
  const { rows } = await exec(client)(
    `SELECT device_id, device_label, device_type
       FROM shared.staff_devices
      WHERE profile_id = $1 AND device_fingerprint = $2 AND is_active = true
      LIMIT 1`,
    [profileId, fingerprint],
  );
  return rows[0] || null;
}

async function insertDevice({
  client,
  business,
  profileId,
  userId,
  fingerprint,
  label,
  deviceType,
  ip,
}) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.staff_devices
       (business, profile_id, user_id, device_fingerprint, device_label,
        device_type, last_seen_at, last_ip)
     VALUES ($1,$2,$3,$4,$5,$6, now(), $7)
     RETURNING device_id, device_fingerprint, device_label, device_type,
               enrolled_at, last_seen_at, last_ip, is_active`,
    [business, profileId, userId, fingerprint, label, deviceType, ip ?? null],
  );
  return rows[0];
}

/** Find one device by id, scoped to the employee (self-service guard). */
async function findByIdForProfile({ client, profileId, deviceId }) {
  const { rows } = await exec(client)(
    `SELECT device_id, device_fingerprint, device_label, device_type, is_active
       FROM shared.staff_devices
      WHERE device_id = $1 AND profile_id = $2
      LIMIT 1`,
    [deviceId, profileId],
  );
  return rows[0] || null;
}

/** Deactivate (soft-remove) a device. Returns the row or null. */
async function deactivateDevice({ client, deviceId, profileId }) {
  const { rows } = await exec(client)(
    `UPDATE shared.staff_devices
        SET is_active = false, removed_at = now()
      WHERE device_id = $1 AND profile_id = $2 AND is_active = true
      RETURNING device_id, device_fingerprint, device_label, device_type`,
    [deviceId, profileId],
  );
  return rows[0] || null;
}

/** Refresh last-seen on a recognised punch (best-effort). */
async function touchDevice({ client, deviceId, ip }) {
  await exec(client)(
    `UPDATE shared.staff_devices
        SET last_seen_at = now(), last_ip = COALESCE($2, last_ip)
      WHERE device_id = $1`,
    [deviceId, ip ?? null],
  );
}

// ── change log (HR & Staff feed) ───────────────────────────
async function logChange({
  client,
  business,
  profileId,
  deviceId,
  action,
  label,
  fingerprint,
  actorUserId,
  note,
}) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.device_change_log
       (business, profile_id, device_id, action, device_label,
        device_fingerprint, actor_user_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING log_id, created_at`,
    [
      business,
      profileId,
      deviceId ?? null,
      action,
      label ?? null,
      fingerprint ?? null,
      actorUserId ?? null,
      note ?? null,
    ],
  );
  return rows[0];
}

// ── HR & Staff views ───────────────────────────────────────
/**
 * Every visible employee with their active devices rolled up into an array,
 * plus a flag for anyone who has enrolled none. Powers the HR "Devices" grid.
 */
async function listAllWithDevices({ client, brand }) {
  const { rows } = await exec(client)(
    `SELECT sp.profile_id,
            c.display_name,
            sp.job_title,
            sp.business,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'device_id', d.device_id,
                        'device_label', d.device_label,
                        'device_type', d.device_type,
                        'enrolled_at', d.enrolled_at,
                        'last_seen_at', d.last_seen_at,
                        'last_ip', host(d.last_ip)
                      ) ORDER BY d.enrolled_at ASC)
                 FROM shared.staff_devices d
                WHERE d.profile_id = sp.profile_id AND d.is_active = true),
              '[]'::json) AS devices,
            (SELECT count(*) FROM shared.staff_devices d2
              WHERE d2.profile_id = sp.profile_id AND d2.is_active = true)::int AS active_count
       FROM shared.staff_profiles sp
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE ${VISIBLE} AND sp.is_deleted = false
        AND (sp.end_date IS NULL OR sp.end_date >= CURRENT_DATE)
      ORDER BY c.display_name ASC NULLS LAST`,
    [brand],
  );
  return rows;
}

/** Recent device-change feed for the brand (the HR notification surface). */
async function listChangeFeed({ client, brand, limit = 50 }) {
  const { rows } = await exec(client)(
    `SELECT l.log_id, l.action, l.device_label, l.note, l.created_at,
            l.profile_id, c.display_name,
            au.display_name AS actor_name
       FROM shared.device_change_log l
       JOIN shared.staff_profiles sp ON sp.profile_id = l.profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
       LEFT JOIN shared.users au ON au.user_id = l.actor_user_id
      WHERE l.business = $1
      ORDER BY l.created_at DESC
      LIMIT $2`,
    [brand, Math.min(Number(limit) || 50, 200)],
  );
  return rows;
}

module.exports = {
  listActiveByProfile,
  countActive,
  findActiveByFingerprint,
  insertDevice,
  findByIdForProfile,
  deactivateDevice,
  touchDevice,
  logChange,
  listAllWithDevices,
  listChangeFeed,
};
