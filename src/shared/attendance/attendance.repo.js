/**
 * Attendance repository (V2.2 §6.11.1).
 * Shared tables: geofences (admin CRUD) + staff_clock_events (APPEND-ONLY).
 * Clock events are only ever inserted/read here — never updated or deleted.
 */

"use strict";

const { ex: exec } = require("../../config/database");
// ── geofences (shared, business-scoped) ────────────────────
const GEO_WRITE = [
  "name",
  "unit_id",
  "latitude",
  "longitude",
  "radius_m",
  "address",
  "is_active",
];

async function listGeofences({ client, brand, include_inactive }) {
  const where = ["business = $1"];
  if (include_inactive !== "true") where.push("is_active = true");
  const { rows } = await exec(client)(
    `SELECT * FROM shared.geofences WHERE ${where.join(" AND ")} ORDER BY name ASC`,
    [brand],
  );
  return rows;
}
async function activeGeofences({ client, brand }) {
  const { rows } = await exec(client)(
    `SELECT * FROM shared.geofences WHERE business = $1 AND is_active = true`,
    [brand],
  );
  return rows;
}
async function findGeofence({ client, brand, id }) {
  const { rows } = await exec(client)(
    `SELECT * FROM shared.geofences WHERE geofence_id = $1 AND business = $2 LIMIT 1`,
    [id, brand],
  );
  return rows[0] || null;
}
async function createGeofence({ client, brand, input, created_by }) {
  const cols = ["business"];
  const vals = ["$1"];
  const params = [brand];
  let i = 2;
  for (const c of GEO_WRITE) {
    if (input[c] === undefined) continue;
    cols.push(c);
    vals.push(`$${i++}`);
    params.push(input[c]);
  }
  cols.push("created_by");
  vals.push(`$${i}`);
  params.push(created_by ?? null);
  const { rows } = await exec(client)(
    `INSERT INTO shared.geofences (${cols.join(", ")}) VALUES (${vals.join(", ")}) RETURNING *`,
    params,
  );
  return rows[0];
}
async function updateGeofence({ client, brand, id, patch }) {
  const sets = [];
  const params = [];
  let i = 1;
  for (const c of GEO_WRITE) {
    if (patch[c] === undefined) continue;
    sets.push(`${c} = $${i++}`);
    params.push(patch[c]);
  }
  if (!sets.length) return findGeofence({ client, brand, id });
  params.push(id, brand);
  const { rows } = await exec(client)(
    `UPDATE shared.geofences SET ${sets.join(", ")} WHERE geofence_id = $${i} AND business = $${i + 1} RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function deactivateGeofence({ client, brand, id }) {
  const { rows } = await exec(client)(
    `UPDATE shared.geofences SET is_active = false WHERE geofence_id = $1 AND business = $2 RETURNING *`,
    [id, brand],
  );
  return rows[0] || null;
}

// ── staff_clock_events (append-only) ───────────────────────
async function profileBusiness({ client, profile_id }) {
  const { rows } = await exec(client)(
    `SELECT business FROM shared.staff_profiles WHERE profile_id = $1 AND is_deleted = false LIMIT 1`,
    [profile_id],
  );
  return rows[0] ? rows[0].business : null;
}

async function insertClockEvent({ client, data }) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.staff_clock_events
       (profile_id, event_type, latitude, longitude, accuracy_m,
        device_fingerprint, device_user_agent, ip_address,
        matched_geofence_id, distance_m, accepted, rejection_reason, occurred_at,
        is_offsite, formatted_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, COALESCE($13, now()),$14,$15)
     RETURNING *`,
    [
      data.profile_id,
      data.event_type,
      data.latitude ?? null,
      data.longitude ?? null,
      data.accuracy_m ?? null,
      data.device_fingerprint ?? null,
      data.device_user_agent ?? null,
      data.ip_address ?? null,
      data.matched_geofence_id ?? null,
      data.distance_m ?? null,
      data.accepted,
      data.rejection_reason ?? null,
      data.occurred_at ?? null,
      data.is_offsite ?? false,
      data.formatted_address ?? null,
    ],
  );
  return rows[0];
}

async function listClockEvents({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 50,
}) {
  // Join staff_profiles to scope by business.
  const where = ["sp.business = $1"];
  const params = [brand];
  let i = 2;
  if (filters.profile_id) {
    where.push(`e.profile_id = $${i++}`);
    params.push(filters.profile_id);
  }
  if (filters.event_type) {
    where.push(`e.event_type = $${i++}`);
    params.push(filters.event_type);
  }
  if (filters.accepted !== undefined) {
    where.push(`e.accepted = $${i++}`);
    params.push(filters.accepted);
  }
  if (filters.from) {
    where.push(`e.occurred_at >= $${i++}`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push(`e.occurred_at <= $${i++}`);
    params.push(filters.to);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const offset = (page - 1) * page_size;
  const run = exec(client);
  const { rows } = await run(
    `SELECT e.* FROM shared.staff_clock_events e
       JOIN shared.staff_profiles sp ON sp.profile_id = e.profile_id
      ${whereSql}
      ORDER BY e.occurred_at DESC LIMIT $${i} OFFSET $${i + 1}`,
    [...params, page_size, offset],
  );
  const { rows: cr } = await run(
    `SELECT count(*)::int AS total FROM shared.staff_clock_events e
       JOIN shared.staff_profiles sp ON sp.profile_id = e.profile_id ${whereSql}`,
    params,
  );
  return { data: rows, page, page_size, total: cr[0].total };
}

module.exports = {
  listGeofences,
  activeGeofences,
  findGeofence,
  createGeofence,
  updateGeofence,
  deactivateGeofence,
  profileBusiness,
  insertClockEvent,
  listClockEvents,
};
