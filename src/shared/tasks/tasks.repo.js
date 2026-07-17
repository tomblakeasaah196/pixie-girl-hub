/**
 * Tasks (V2.2 §6.19) — repository.
 *
 * SHARED tables (business-scoped): tasks, task_subtasks. Tasks are raised
 * manually or auto-created by DB triggers (e.g. a new service_job raises a
 * staff task) and can reference any source record via reference_type/id.
 * Parameterised SQL only.
 */

"use strict";

const { query, ex } = require("../../config/database");
// ── Tasks ──────────────────────────────────────────────────
async function createTask({ client, task }) {
  // Explicit remind_at (custom reminder) wins; else derive from
  // reminder_minutes before the due date.
  const remind_at =
    task.remind_at ||
    (task.reminder_minutes !== null &&
    task.reminder_minutes !== undefined &&
    task.due_at
      ? new Date(
          new Date(task.due_at).getTime() - task.reminder_minutes * 60000,
        ).toISOString()
      : null);
  const { rows } = await ex(client)(
    `INSERT INTO shared.tasks
       (business, title, description, status, priority, assigned_to, due_at,
        parent_task_id, reference_type, reference_id, created_by,
        is_personal, reminder_minutes, remind_at, calendar_event_id)
     VALUES ($1,$2,$3,COALESCE($4,'to_do'),COALESCE($5,'normal'),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      task.business,
      task.title,
      task.description || null,
      task.status || null,
      task.priority || null,
      task.assigned_to || null,
      task.due_at || null,
      task.parent_task_id || null,
      task.reference_type || null,
      task.reference_id || null,
      task.created_by,
      task.is_personal === true,
      task.reminder_minutes ?? null,
      remind_at,
      task.calendar_event_id || null,
    ],
  );
  return rows[0];
}
async function listTasks({
  brand,
  status,
  assigned_to,
  visible_to,
  priority,
  reference_type,
  reference_id,
  search,
  page = 1,
  page_size = 50,
}) {
  const where = ["t.business = $1", "t.is_deleted = false"];
  const params = [brand];
  let i = 2;
  if (status) {
    where.push(`t.status = $${i++}`);
    params.push(status);
  }
  if (assigned_to) {
    where.push(`t.assigned_to = $${i++}`);
    params.push(assigned_to);
  }
  // Record scope 'own' (RBAC layer 4): a task is yours if you're the
  // assignee OR you raised it (you still track work you handed to others).
  if (visible_to) {
    where.push(`(t.assigned_to = $${i} OR t.created_by = $${i})`);
    params.push(visible_to);
    i++;
  }
  if (priority) {
    where.push(`t.priority = $${i++}`);
    params.push(priority);
  }
  if (reference_type) {
    where.push(`t.reference_type = $${i++}`);
    params.push(reference_type);
  }
  if (reference_id) {
    where.push(`t.reference_id = $${i++}`);
    params.push(reference_id);
  }
  if (search) {
    where.push(`t.title ILIKE $${i++}`);
    params.push(`%${search}%`);
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.tasks t ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT t.*,
            ua.display_name AS assigned_to_name,
            uc.display_name AS created_by_name,
            (SELECT count(*)::int FROM shared.task_subtasks WHERE task_id = t.task_id) AS subtask_count,
            (SELECT count(*)::int FROM shared.task_subtasks WHERE task_id = t.task_id AND is_done = true) AS subtask_done_count
       FROM shared.tasks t
       LEFT JOIN shared.users ua ON ua.user_id = t.assigned_to
       LEFT JOIN shared.users uc ON uc.user_id = t.created_by
       ${w}
       ORDER BY (t.due_at IS NULL), t.due_at ASC, t.created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
}
async function findTask({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT t.*,
            ua.display_name AS assigned_to_name,
            uc.display_name AS created_by_name
       FROM shared.tasks t
       LEFT JOIN shared.users ua ON ua.user_id = t.assigned_to
       LEFT JOIN shared.users uc ON uc.user_id = t.created_by
      WHERE t.task_id = $1 AND t.business = $2 AND t.is_deleted = false`,
    [id, brand],
  );
  return rows[0] || null;
}
async function updateTask({ brand, id, patch }) {
  const allowed = [
    "title",
    "description",
    "priority",
    "status",
    "assigned_to",
    "due_at",
    "reference_type",
    "reference_id",
    "is_personal",
    "reminder_minutes",
    "remind_at",
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
  // A moved reminder must fire again — re-arm the sweep's sent flag.
  if (patch.remind_at !== undefined) sets.push("reminder_sent_at = NULL");
  if (!sets.length) return findTask({ brand, id });
  params.push(id, brand);
  const { rows } = await query(
    `UPDATE shared.tasks SET ${sets.join(", ")}, updated_at = now()
      WHERE task_id = $${i++} AND business = $${i} AND is_deleted = false RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function setStatus({ brand, id, status, completed }) {
  const { rows } = await query(
    `UPDATE shared.tasks
        SET status = $3,
            completed_at = CASE WHEN $4::boolean THEN now() ELSE NULL END,
            updated_at = now()
      WHERE task_id = $1 AND business = $2 AND is_deleted = false RETURNING *`,
    [id, brand, status, completed === true],
  );
  return rows[0] || null;
}
async function softDeleteTask({ brand, id }) {
  const { rows } = await query(
    `UPDATE shared.tasks SET is_deleted = true, updated_at = now()
      WHERE task_id = $1 AND business = $2 RETURNING task_id`,
    [id, brand],
  );
  return rows[0] || null;
}

// ── Subtasks ───────────────────────────────────────────────
async function listSubtasks({ task_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.task_subtasks WHERE task_id = $1 ORDER BY display_order`,
    [task_id],
  );
  return rows;
}
async function addSubtask({ s }) {
  const { rows } = await query(
    `INSERT INTO shared.task_subtasks (task_id, title, display_order)
     VALUES ($1,$2,COALESCE($3,0)) RETURNING *`,
    [
      s.task_id,
      s.title,
      s.display_order === undefined ? null : s.display_order,
    ],
  );
  return rows[0];
}
async function setSubtaskDone({ subtask_id, is_done }) {
  const { rows } = await query(
    `UPDATE shared.task_subtasks
        SET is_done = $2, completed_at = CASE WHEN $2::boolean THEN now() ELSE NULL END
      WHERE subtask_id = $1 RETURNING *`,
    [subtask_id, is_done === true],
  );
  return rows[0] || null;
}
async function deleteSubtask({ subtask_id }) {
  const { rows } = await query(
    `DELETE FROM shared.task_subtasks WHERE subtask_id = $1 RETURNING subtask_id`,
    [subtask_id],
  );
  return rows[0] || null;
}

/** All non-cancelled tasks for the board view (optionally scoped to an assignee). */
async function boardTasks({ brand, assigned_to, visible_to }) {
  const where = [
    "t.business = $1",
    "t.is_deleted = false",
    "t.status <> 'cancelled'",
  ];
  const params = [brand];
  let i = 2;
  if (assigned_to) {
    where.push(`t.assigned_to = $${i++}`);
    params.push(assigned_to);
  }
  if (visible_to) {
    where.push(`(t.assigned_to = $${i} OR t.created_by = $${i})`);
    params.push(visible_to);
    i++;
  }
  const { rows } = await query(
    `SELECT t.*,
            ua.display_name AS assigned_to_name,
            uc.display_name AS created_by_name,
            (SELECT count(*)::int FROM shared.task_subtasks WHERE task_id = t.task_id) AS subtask_count,
            (SELECT count(*)::int FROM shared.task_subtasks WHERE task_id = t.task_id AND is_done = true) AS subtask_done_count
       FROM shared.tasks t
       LEFT JOIN shared.users ua ON ua.user_id = t.assigned_to
       LEFT JOIN shared.users uc ON uc.user_id = t.created_by
       WHERE ${where.join(" AND ")}
       ORDER BY
         CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         (t.due_at IS NULL), t.due_at ASC, t.created_at DESC`,
    params,
  );
  return rows;
}

/**
 * Assignable teammates for this business — the identity source the CoS needs
 * to resolve "assign to my BDM" into a real user_id (shared.tasks.assigned_to
 * is an FK to shared.users, and a contact_id is NOT a user). Active users who
 * can access the brand (or the CEO, who spans all), searchable by name/role,
 * CEO first. Returns a compact shape: user_id, display_name, email, role, is_ceo.
 */
async function listAssignableUsers({ brand, search, limit = 50 }) {
  const where = [
    "u.status = 'active'",
    "u.is_active = true",
    "($1 = ANY(u.permitted_businesses) OR u.is_ceo = true)",
  ];
  const params = [brand];
  let i = 2;
  if (search && String(search).trim()) {
    // Match a person's name/email OR the name of a role they hold ("BDM").
    where.push(
      `(u.display_name ILIKE $${i} OR u.email ILIKE $${i} OR EXISTS (
          SELECT 1 FROM shared.user_roles ur2
            JOIN shared.roles r2 ON r2.role_id = ur2.role_id
           WHERE ur2.user_id = u.user_id AND r2.role_name ILIKE $${i}))`,
    );
    params.push(`%${String(search).trim()}%`);
    i++;
  }
  const { rows } = await query(
    `SELECT u.user_id,
            COALESCE(u.display_name, u.email) AS display_name,
            u.email,
            u.is_ceo,
            (SELECT r.role_name
               FROM shared.user_roles ur
               JOIN shared.roles r ON r.role_id = ur.role_id
              WHERE ur.user_id = u.user_id
              ORDER BY r.role_name
              LIMIT 1) AS role_name
       FROM shared.users u
      WHERE ${where.join(" AND ")}
      ORDER BY u.is_ceo DESC, display_name ASC
      LIMIT $${i}`,
    [...params, Math.min(Number(limit) || 50, 100)],
  );
  return rows;
}

module.exports = {
  createTask,
  listTasks,
  findTask,
  updateTask,
  setStatus,
  softDeleteTask,
  listSubtasks,
  addSubtask,
  setSubtaskDone,
  deleteSubtask,
  boardTasks,
  listAssignableUsers,
};
