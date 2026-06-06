/**
 * Brand CRUD repo factory (module kit).
 *
 * Most admin-config tables are the same shape: list (filtered + paginated +
 * real count), get-by-id, create, update (dynamic), and soft/hard delete —
 * differing only in table name, PK, and writable columns. This factory builds
 * a correct, parameterised repo from that spec so each config table doesn't
 * re-implement (and re-bug) the same SQL.
 *
 * spec:
 *   schema        'brand'  → {brand}.{table}      (per-business schema)
 *                 'shared' → shared.{table}, filtered by a `business` column
 *   table         table name (no schema prefix)
 *   pk            primary-key column
 *   writeCols     columns a caller may set on create/update
 *   jsonbCols     subset cast with ::jsonb (values JSON.stringify-d)
 *   arrayCols     subset cast with ::<arrayType> (default text[])
 *   softDeleteCol if set, delete = UPDATE col=false; else hard DELETE
 *   orderBy       ORDER BY clause (default created_at DESC)
 *   filterCols    columns allowed as equality filters from the query
 */

"use strict";

const { query } = require("../../config/database");

const VALID_BRANDS = new Set(["pixiegirl", "faitlynhair"]);

function makeBrandRepo(spec) {
  const {
    schema = "brand",
    table,
    pk,
    writeCols = [],
    jsonbCols = [],
    arrayCols = {},
    softDeleteCol = null,
    orderBy = "created_at DESC",
    filterCols = [],
  } = spec;

  const jsonbSet = new Set(jsonbCols);
  const arraySet = arrayCols; // { col: 'text[]' | 'uuid[]' | ... }

  function exec(client) {
    return client ? client.query.bind(client) : query;
  }

  function qualified(brand) {
    if (!VALID_BRANDS.has(brand)) throw new Error(`Invalid brand: ${brand}`);
    return schema === "shared" ? `shared.${table}` : `${brand}.${table}`;
  }

  function placeholder(col, idx) {
    if (jsonbSet.has(col)) return `$${idx}::jsonb`;
    if (arraySet[col]) return `$${idx}::${arraySet[col]}`;
    return `$${idx}`;
  }
  function bind(col, value) {
    return jsonbSet.has(col) ? JSON.stringify(value) : value;
  }

  /** Build the WHERE clause (business scope for shared tables + filters). */
  function buildWhere(brand, filters) {
    const where = [];
    const params = [];
    let i = 1;
    if (schema === "shared") {
      where.push(`business = $${i++}`);
      params.push(brand);
    }
    if (softDeleteCol && filters.include_inactive !== "true") {
      where.push(`${softDeleteCol} = true`);
    }
    for (const col of filterCols) {
      if (filters[col] === undefined) continue;
      where.push(`${col} = $${i++}`);
      params.push(filters[col]);
    }
    const sql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return { sql, params, nextIndex: i };
  }

  async function findAll({
    client,
    brand,
    filters = {},
    page = 1,
    page_size = 50,
  }) {
    const t = qualified(brand);
    const { sql: whereSql, params, nextIndex } = buildWhere(brand, filters);
    const offset = (page - 1) * page_size;
    const run = exec(client);
    const { rows } = await run(
      `SELECT * FROM ${t} ${whereSql}
        ORDER BY ${orderBy}
        LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`,
      [...params, page_size, offset],
    );
    const { rows: countRows } = await run(
      `SELECT count(*)::int AS total FROM ${t} ${whereSql}`,
      params,
    );
    return { data: rows, page, page_size, total: countRows[0].total };
  }

  async function findById({ client, brand, id }) {
    const t = qualified(brand);
    const extra = schema === "shared" ? ` AND business = $2` : "";
    const params = schema === "shared" ? [id, brand] : [id];
    const { rows } = await exec(client)(
      `SELECT * FROM ${t} WHERE ${pk} = $1${extra} LIMIT 1`,
      params,
    );
    return rows[0] || null;
  }

  async function create({ client, brand, input }) {
    const t = qualified(brand);
    const cols = [];
    const vals = [];
    const params = [];
    let i = 1;
    if (schema === "shared") {
      cols.push("business");
      vals.push(`$${i++}`);
      params.push(brand);
    }
    for (const col of writeCols) {
      if (input[col] === undefined) continue;
      cols.push(col);
      vals.push(placeholder(col, i++));
      params.push(bind(col, input[col]));
    }
    const { rows } = await exec(client)(
      `INSERT INTO ${t} (${cols.join(", ")}) VALUES (${vals.join(", ")}) RETURNING *`,
      params,
    );
    return rows[0];
  }

  async function update({ client, brand, id, patch }) {
    const t = qualified(brand);
    const sets = [];
    const params = [];
    let i = 1;
    for (const col of writeCols) {
      if (patch[col] === undefined) continue;
      sets.push(`${col} = ${placeholder(col, i++)}`);
      params.push(bind(col, patch[col]));
    }
    if (sets.length === 0) return findById({ client, brand, id });
    const extra = schema === "shared" ? ` AND business = $${i + 1}` : "";
    params.push(id);
    if (schema === "shared") params.push(brand);
    const { rows } = await exec(client)(
      `UPDATE ${t} SET ${sets.join(", ")} WHERE ${pk} = $${i}${extra} RETURNING *`,
      params,
    );
    return rows[0] || null;
  }

  async function remove({ client, brand, id }) {
    const t = qualified(brand);
    const extra = schema === "shared" ? ` AND business = $2` : "";
    const params = schema === "shared" ? [id, brand] : [id];
    if (softDeleteCol) {
      const { rows } = await exec(client)(
        `UPDATE ${t} SET ${softDeleteCol} = false WHERE ${pk} = $1${extra} RETURNING *`,
        params,
      );
      return rows[0] || null;
    }
    await exec(client)(`DELETE FROM ${t} WHERE ${pk} = $1${extra}`, params);
    return null;
  }

  return { findAll, findById, create, update, remove, pk, table };
}

module.exports = { makeBrandRepo, VALID_BRANDS };
