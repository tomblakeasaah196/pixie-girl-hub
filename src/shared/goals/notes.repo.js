/**
 * Workspace Notes (Chief of Staff, PR1) — repository.
 * SHARED table shared.workspace_notes, business-scoped AND owner-scoped
 * (notes are personal to their creator by default). Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

async function createNote({ n }) {
  const { rows } = await query(
    `INSERT INTO shared.workspace_notes
       (business, user_id, title, body, goal_id, milestone_id, pinned, source)
     VALUES ($1,$2,$3,COALESCE($4,''),$5,$6,COALESCE($7,false),COALESCE($8,'manual'))
     RETURNING *`,
    [
      n.business,
      n.user_id,
      n.title || null,
      n.body,
      n.goal_id || null,
      n.milestone_id || null,
      n.pinned,
      n.source || null,
    ],
  );
  return rows[0];
}

async function listNotes({
  brand,
  user_id,
  goal_id,
  pinned,
  search,
  page = 1,
  page_size = 50,
}) {
  const where = ["n.business = $1", "n.user_id = $2", "n.is_deleted = false"];
  const params = [brand, user_id];
  let i = 3;
  if (goal_id) {
    where.push(`n.goal_id = $${i++}`);
    params.push(goal_id);
  }
  if (pinned !== undefined) {
    where.push(`n.pinned = $${i++}`);
    params.push(pinned);
  }
  if (search) {
    where.push(`(n.body ILIKE $${i} OR coalesce(n.title,'') ILIKE $${i})`);
    params.push(`%${search}%`);
    i++;
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.workspace_notes n ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT n.* FROM shared.workspace_notes n
       ${w}
       ORDER BY n.pinned DESC, n.updated_at DESC
       LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
}

async function findNote({ brand, user_id, id }) {
  const { rows } = await query(
    `SELECT * FROM shared.workspace_notes
      WHERE note_id = $1 AND business = $2 AND user_id = $3 AND is_deleted = false`,
    [id, brand, user_id],
  );
  return rows[0] || null;
}

async function updateNote({ brand, user_id, id, patch }) {
  const allowed = ["title", "body", "goal_id", "milestone_id", "pinned"];
  const sets = [];
  const params = [];
  let i = 1;
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      sets.push(`${k} = $${i++}`);
      params.push(patch[k]);
    }
  }
  if (!sets.length) return findNote({ brand, user_id, id });
  params.push(id, brand, user_id);
  const { rows } = await query(
    `UPDATE shared.workspace_notes SET ${sets.join(", ")}, updated_at = now()
      WHERE note_id = $${i++} AND business = $${i++} AND user_id = $${i}
        AND is_deleted = false
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function softDeleteNote({ brand, user_id, id }) {
  const { rows } = await query(
    `UPDATE shared.workspace_notes SET is_deleted = true, updated_at = now()
      WHERE note_id = $1 AND business = $2 AND user_id = $3 AND is_deleted = false
      RETURNING note_id`,
    [id, brand, user_id],
  );
  return rows[0] || null;
}

module.exports = {
  createNote,
  listNotes,
  findNote,
  updateNote,
  softDeleteNote,
};
