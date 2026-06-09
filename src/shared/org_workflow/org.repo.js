/**
 * Organisation & Workflow Builder (V2.2 §6.27)
 * Repository — parameterised SQL only. No business logic, no HTTP.
 *
 * Org structure is SHARED, not per-brand: shared.org_units and
 * shared.org_positions both carry/resolve a `business` and are filtered by it
 * (units directly; positions via their unit). Brand context is enforced on
 * every read and write so one brand can never see or mutate another's tree.
 *
 *   org_units      PK unit_id      · soft-state via is_active (no is_deleted)
 *   org_positions  PK position_id  · the approval-authority graph the engine's
 *                                    resolveApprover() walks (deputy/escalate)
 */

"use strict";

const { query } = require("../../config/database");

const { VALID_BRANDS } = require("../../config/brands");

function assertBrand(brand) {
  if (!VALID_BRANDS.has(brand)) throw new Error(`Invalid brand: ${brand}`);
}

function exec(client) {
  return client ? client.query.bind(client) : query;
}

// Columns a caller may set/patch — anything else in the body is ignored.
const UNIT_WRITE_COLS = [
  "parent_unit_id",
  "unit_key",
  "display_name",
  "display_order",
  "is_active",
];
const POSITION_WRITE_COLS = [
  "unit_id",
  "position_key",
  "display_name",
  "profile_id",
  "reports_to_position_id",
  "is_management",
  "is_deputy",
  "deputy_capacities",
  "approval_threshold_ngn",
  "display_order",
];

// ── org_units ──────────────────────────────────────────────────────────

async function findAll({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
}) {
  assertBrand(brand);
  const where = ["business = $1"];
  const params = [brand];
  let i = 2;

  if (
    filters.include_inactive !== "true" &&
    filters.include_inactive !== true
  ) {
    where.push("is_active = true");
  }
  if (filters.parent_unit_id) {
    where.push(`parent_unit_id = $${i++}`);
    params.push(filters.parent_unit_id);
  }
  if (filters.q) {
    where.push(`(display_name ILIKE $${i} OR unit_key ILIKE $${i})`);
    params.push(`%${filters.q}%`);
    i++;
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const offset = (page - 1) * page_size;
  const run = exec(client);

  const { rows } = await run(
    `SELECT * FROM shared.org_units ${whereSql}
      ORDER BY display_order ASC, display_name ASC
      LIMIT $${i} OFFSET $${i + 1}`,
    [...params, page_size, offset],
  );
  const { rows: countRows } = await run(
    `SELECT count(*)::int AS total FROM shared.org_units ${whereSql}`,
    params,
  );

  return { data: rows, page, page_size, total: countRows[0].total };
}

async function findById({ client, brand, id }) {
  assertBrand(brand);
  const { rows } = await exec(client)(
    `SELECT * FROM shared.org_units WHERE unit_id = $1 AND business = $2 LIMIT 1`,
    [id, brand],
  );
  return rows[0] || null;
}

async function create({ client, brand, input }) {
  assertBrand(brand);
  const cols = ["business"];
  const placeholders = ["$1"];
  const params = [brand];
  let i = 2;
  for (const col of UNIT_WRITE_COLS) {
    if (input[col] === undefined) continue;
    cols.push(col);
    placeholders.push(`$${i++}`);
    params.push(input[col]);
  }
  const { rows } = await exec(client)(
    `INSERT INTO shared.org_units (${cols.join(", ")})
     VALUES (${placeholders.join(", ")})
     RETURNING *`,
    params,
  );
  return rows[0];
}

async function update({ client, brand, id, patch }) {
  assertBrand(brand);
  const sets = [];
  const params = [];
  let i = 1;
  for (const col of UNIT_WRITE_COLS) {
    if (patch[col] === undefined) continue;
    sets.push(`${col} = $${i++}`);
    params.push(patch[col]);
  }
  if (sets.length === 0) return findById({ client, brand, id });
  params.push(id, brand);
  const { rows } = await exec(client)(
    `UPDATE shared.org_units SET ${sets.join(", ")}
      WHERE unit_id = $${i} AND business = $${i + 1}
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/** Soft-deactivate (the table has no is_deleted/deleted_at — uses is_active). */
async function deactivate({ client, brand, id }) {
  assertBrand(brand);
  const { rows } = await exec(client)(
    `UPDATE shared.org_units SET is_active = false
      WHERE unit_id = $1 AND business = $2
      RETURNING *`,
    [id, brand],
  );
  return rows[0] || null;
}

// ── org_positions (joined to units for brand isolation) ─────────────────

async function listPositions({ client, brand, unit_id }) {
  assertBrand(brand);
  const params = [brand];
  let sql = `
    SELECT p.*
      FROM shared.org_positions p
      JOIN shared.org_units u ON u.unit_id = p.unit_id
     WHERE u.business = $1`;
  if (unit_id) {
    sql += ` AND p.unit_id = $2`;
    params.push(unit_id);
  }
  sql += ` ORDER BY p.display_order ASC, p.display_name ASC`;
  const { rows } = await exec(client)(sql, params);
  return rows;
}

async function findPosition({ client, brand, id }) {
  assertBrand(brand);
  const { rows } = await exec(client)(
    `SELECT p.*
       FROM shared.org_positions p
       JOIN shared.org_units u ON u.unit_id = p.unit_id
      WHERE p.position_id = $1 AND u.business = $2
      LIMIT 1`,
    [id, brand],
  );
  return rows[0] || null;
}

/** Guard: a unit_id must belong to this brand before we attach a position. */
async function unitBelongsToBrand({ client, brand, unit_id }) {
  const unit = await findById({ client, brand, id: unit_id });
  return Boolean(unit);
}

async function createPosition({ client, brand, input }) {
  assertBrand(brand);
  const cols = [];
  const placeholders = [];
  const params = [];
  let i = 1;
  for (const col of POSITION_WRITE_COLS) {
    if (input[col] === undefined) continue;
    cols.push(col);
    placeholders.push(
      col === "deputy_capacities" ? `$${i++}::text[]` : `$${i++}`,
    );
    params.push(input[col]);
  }
  const { rows } = await exec(client)(
    `INSERT INTO shared.org_positions (${cols.join(", ")})
     VALUES (${placeholders.join(", ")})
     RETURNING *`,
    params,
  );
  return rows[0];
}

async function updatePosition({ client, brand, id, patch }) {
  assertBrand(brand);
  const sets = [];
  const params = [];
  let i = 1;
  for (const col of POSITION_WRITE_COLS) {
    if (patch[col] === undefined) continue;
    sets.push(
      col === "deputy_capacities"
        ? `${col} = $${i++}::text[]`
        : `${col} = $${i++}`,
    );
    params.push(patch[col]);
  }
  if (sets.length === 0) return findPosition({ client, brand, id });
  params.push(id);
  const { rows } = await exec(client)(
    `UPDATE shared.org_positions SET ${sets.join(", ")}
      WHERE position_id = $${i}
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/** Positions have no is_active flag — removal is a real delete (config row). */
async function deletePosition({ client, brand, id }) {
  assertBrand(brand);
  await exec(client)(
    `DELETE FROM shared.org_positions p
       USING shared.org_units u
      WHERE p.unit_id = u.unit_id
        AND p.position_id = $1 AND u.business = $2`,
    [id, brand],
  );
}

/** Guard: a position must resolve to a unit in this brand. */
async function positionBelongsToBrand({ client, brand, position_id }) {
  const pos = await findPosition({ client, brand, id: position_id });
  return Boolean(pos);
}

// ── org_position_dotted_lines (info-only reporting; never approval) ─────

async function listDottedLines({ client, brand, position_id }) {
  assertBrand(brand);
  const params = [brand];
  let sql = `
    SELECT d.*, tp.display_name AS dotted_to_display_name
      FROM shared.org_position_dotted_lines d
      JOIN shared.org_positions p  ON p.position_id = d.position_id
      JOIN shared.org_units      u  ON u.unit_id = p.unit_id
      JOIN shared.org_positions tp ON tp.position_id = d.dotted_to_position_id
     WHERE u.business = $1`;
  if (position_id) {
    sql += ` AND d.position_id = $2`;
    params.push(position_id);
  }
  sql += ` ORDER BY d.created_at ASC`;
  const { rows } = await exec(client)(sql, params);
  return rows;
}

async function findDottedLine({ client, brand, dotted_id }) {
  assertBrand(brand);
  const { rows } = await exec(client)(
    `SELECT d.*
       FROM shared.org_position_dotted_lines d
       JOIN shared.org_positions p ON p.position_id = d.position_id
       JOIN shared.org_units      u ON u.unit_id = p.unit_id
      WHERE d.dotted_id = $1 AND u.business = $2
      LIMIT 1`,
    [dotted_id, brand],
  );
  return rows[0] || null;
}

async function createDottedLine({ client, brand, input }) {
  assertBrand(brand);
  // Omit `rights` entirely when not supplied so the column DEFAULT applies.
  const cols = ["position_id", "dotted_to_position_id", "notes"];
  const vals = ["$1", "$2", "$3"];
  const params = [
    input.position_id,
    input.dotted_to_position_id,
    input.notes ?? null,
  ];
  if (input.rights !== undefined) {
    cols.push("rights");
    vals.push(`$${params.length + 1}::jsonb`);
    params.push(JSON.stringify(input.rights));
  }
  const { rows } = await exec(client)(
    `INSERT INTO shared.org_position_dotted_lines (${cols.join(", ")})
     VALUES (${vals.join(", ")})
     RETURNING *`,
    params,
  );
  return rows[0];
}

async function updateDottedLine({ client, brand, dotted_id, patch }) {
  assertBrand(brand);
  const sets = [];
  const params = [];
  let i = 1;
  if (patch.rights !== undefined) {
    sets.push(`rights = $${i++}::jsonb`);
    params.push(JSON.stringify(patch.rights));
  }
  if (patch.notes !== undefined) {
    sets.push(`notes = $${i++}`);
    params.push(patch.notes);
  }
  if (sets.length === 0) return findDottedLine({ client, brand, dotted_id });
  params.push(dotted_id);
  const { rows } = await exec(client)(
    `UPDATE shared.org_position_dotted_lines SET ${sets.join(", ")}
      WHERE dotted_id = $${i}
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function deleteDottedLine({ client, brand, dotted_id }) {
  assertBrand(brand);
  await exec(client)(
    `DELETE FROM shared.org_position_dotted_lines d
       USING shared.org_positions p, shared.org_units u
      WHERE d.position_id = p.position_id AND p.unit_id = u.unit_id
        AND d.dotted_id = $1 AND u.business = $2`,
    [dotted_id, brand],
  );
}

module.exports = {
  // units
  findAll,
  findById,
  create,
  update,
  deactivate,
  // positions
  listPositions,
  findPosition,
  unitBelongsToBrand,
  positionBelongsToBrand,
  createPosition,
  updatePosition,
  deletePosition,
  // dotted lines
  listDottedLines,
  findDottedLine,
  createDottedLine,
  updateDottedLine,
  deleteDottedLine,
};
