/**
 * Calendar (V2.2 §6.18) — repository.
 *
 * SHARED tables (business-scoped): calendar_events, event_participants,
 * event_resources. Events carry reference_type/reference_id so other modules'
 * records (service bookings, stylist assignments, deliveries, deals) surface on
 * one calendar. Parameterised SQL only.
 */

"use strict";

const { query, ex } = require("../../config/database");
// ── Events ─────────────────────────────────────────────────
async function createEvent({ client, e }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.calendar_events
       (business, title, event_type, start_at, end_at, all_day, location,
        description, recurrence_rule, reference_type, reference_id, created_by, is_private)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,false),$7,$8,$9,$10,$11,$12,COALESCE($13,false))
     RETURNING *`,
    [
      e.business,
      e.title,
      e.event_type,
      e.start_at,
      e.end_at,
      e.all_day === undefined ? null : e.all_day,
      e.location || null,
      e.description || null,
      e.recurrence_rule || null,
      e.reference_type || null,
      e.reference_id || null,
      e.created_by || null,
      e.is_private === undefined ? null : e.is_private,
    ],
  );
  return rows[0];
}
async function listEvents({
  brand,
  from,
  to,
  event_type,
  created_by,
  reference_type,
  reference_id,
}) {
  const where = ["e.business = $1", "e.is_deleted = false"];
  const params = [brand];
  let i = 2;
  if (from) {
    where.push(`e.start_at >= $${i++}`);
    params.push(from);
  }
  if (to) {
    where.push(`e.start_at <= $${i++}`);
    params.push(to);
  }
  if (event_type) {
    where.push(`e.event_type = $${i++}`);
    params.push(event_type);
  }
  if (created_by) {
    where.push(`e.created_by = $${i++}`);
    params.push(created_by);
  }
  if (reference_type) {
    where.push(`e.reference_type = $${i++}`);
    params.push(reference_type);
  }
  if (reference_id) {
    where.push(`e.reference_id = $${i++}`);
    params.push(reference_id);
  }
  const { rows } = await query(
    `SELECT e.*, u.display_name AS created_by_name
       FROM shared.calendar_events e
       LEFT JOIN shared.users u ON u.user_id = e.created_by
       WHERE ${where.join(" AND ")}
       ORDER BY e.start_at`,
    params,
  );
  return rows;
}
async function findEvent({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT e.*, u.display_name AS created_by_name
       FROM shared.calendar_events e
       LEFT JOIN shared.users u ON u.user_id = e.created_by
      WHERE e.event_id = $1 AND e.business = $2 AND e.is_deleted = false`,
    [id, brand],
  );
  return rows[0] || null;
}
async function updateEvent({ brand, id, patch }) {
  const allowed = [
    "title",
    "event_type",
    "start_at",
    "end_at",
    "all_day",
    "location",
    "description",
    "recurrence_rule",
    "is_private",
  ];
  const sets = [];
  const params = [];
  let i = 1;
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      sets.push(`${k} = $${i++}`);
      params.push(patch[k]);
    }
  }
  if (!sets.length) return findEvent({ brand, id });
  params.push(id, brand);
  const { rows } = await query(
    `UPDATE shared.calendar_events SET ${sets.join(", ")}, updated_at = now()
      WHERE event_id = $${i++} AND business = $${i} AND is_deleted = false RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function softDeleteEvent({ brand, id }) {
  const { rows } = await query(
    `UPDATE shared.calendar_events SET is_deleted = true, updated_at = now()
      WHERE event_id = $1 AND business = $2 RETURNING event_id`,
    [id, brand],
  );
  return rows[0] || null;
}

/**
 * Find events that overlap the given time range at the same location.
 * Two events overlap when: existing.start_at < new.end_at AND existing.end_at > new.start_at.
 * Excludes the event with `exclude_id` (for updates).
 */
async function findClashes({
  client,
  brand,
  location,
  start_at,
  end_at,
  exclude_id,
}) {
  const where = [
    "business = $1",
    "is_deleted = false",
    "location = $2",
    "start_at < $4",
    "end_at > $3",
  ];
  const params = [brand, location, start_at, end_at];
  let i = 5;
  if (exclude_id) {
    where.push(`event_id <> $${i++}`);
    params.push(exclude_id);
  }
  const { rows } = await ex(client)(
    `SELECT event_id, title, start_at, end_at, location
       FROM shared.calendar_events
      WHERE ${where.join(" AND ")}
      ORDER BY start_at
      LIMIT 10`,
    params,
  );
  return rows;
}

// ── Participants ───────────────────────────────────────────
async function addParticipant({ client, p }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.event_participants
       (event_id, user_id, contact_id, status, is_organiser)
     VALUES ($1,$2,$3,COALESCE($4,'invited'),COALESCE($5,false)) RETURNING *`,
    [
      p.event_id,
      p.user_id || null,
      p.contact_id || null,
      p.status || null,
      p.is_organiser === undefined ? null : p.is_organiser,
    ],
  );
  return rows[0];
}
async function listParticipants({ event_id }) {
  const { rows } = await query(
    `SELECT ep.*,
            u.display_name AS user_name,
            u.email AS user_email
       FROM shared.event_participants ep
       LEFT JOIN shared.users u ON u.user_id = ep.user_id
      WHERE ep.event_id = $1`,
    [event_id],
  );
  return rows;
}
async function respondParticipant({ event_id, participant_id, status }) {
  const { rows } = await query(
    `UPDATE shared.event_participants
        SET status = $3, responded_at = now()
      WHERE event_id = $1 AND participant_id = $2 RETURNING *`,
    [event_id, participant_id, status],
  );
  return rows[0] || null;
}
async function removeParticipant({ event_id, participant_id }) {
  const { rows } = await query(
    `DELETE FROM shared.event_participants
      WHERE event_id = $1 AND participant_id = $2 RETURNING participant_id`,
    [event_id, participant_id],
  );
  return rows[0] || null;
}

/** Events starting within a window — drives the reminder cron. */
async function upcoming({ brand, from, to, event_type }) {
  const where = [
    "business = $1",
    "is_deleted = false",
    "start_at >= $2",
    "start_at <= $3",
  ];
  const params = [brand, from, to];
  let i = 4;
  if (event_type) {
    where.push(`event_type = $${i++}`);
    params.push(event_type);
  }
  const { rows } = await query(
    `SELECT * FROM shared.calendar_events WHERE ${where.join(" AND ")} ORDER BY start_at`,
    params,
  );
  return rows;
}

// ── Resources ──────────────────────────────────────────────
async function addResource({ client, r }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.event_resources
       (event_id, resource_type, resource_name, quantity, notes)
     VALUES ($1,$2,$3,COALESCE($4,1),$5) RETURNING *`,
    [
      r.event_id,
      r.resource_type,
      r.resource_name,
      r.quantity === undefined ? null : r.quantity,
      r.notes || null,
    ],
  );
  return rows[0];
}
async function listResources({ event_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.event_resources WHERE event_id = $1`,
    [event_id],
  );
  return rows;
}

module.exports = {
  createEvent,
  listEvents,
  findEvent,
  updateEvent,
  softDeleteEvent,
  findClashes,
  addParticipant,
  listParticipants,
  respondParticipant,
  removeParticipant,
  upcoming,
  addResource,
  listResources,
};
