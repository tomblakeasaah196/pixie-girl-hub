/**
 * Messaging Smartcomm (V2.2 §6.17)
 * Repository — parameterised SQL only. No business logic, no HTTP.
 *
 * Conventions:
 *   - Every function takes a { client?, brand, ... } options object.
 *   - If `client` is provided, run within that transaction; else use the
 *     pool (via `query`).
 *   - All values bound with $1..$N placeholders. NEVER string-interpolate.
 *   - Schema names are switched by brand: pixiegirl.* or faitlynhair.*.
 *   - For shared tables (audit_log, contacts, etc.), use the `shared.` schema
 *     and filter by `business` column.
 */

"use strict";

const { query } = require("../../config/database");

const { VALID_BRANDS } = require("../../config/brands");

function tableFor(brand) {
  if (!VALID_BRANDS.has(brand)) throw new Error(`Invalid brand: ${brand}`);
  return `${brand}.comms_threads`;
}

async function findAll({
  client,
  brand,
  scope,
  user_id,
  filters = {},
  page = 1,
  page_size = 25,
}) {
  // TODO: build dynamic WHERE based on filters + scope ('all' | 'team' | 'own')
  const offset = (page - 1) * page_size;
  const sql = `
    SELECT *
      FROM ${tableFor(brand)}
     WHERE COALESCE(is_deleted, false) = false
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2
  `;
  const exec = client ? client.query.bind(client) : query;
  const { rows } = await exec(sql, [page_size, offset]);
  return { data: rows, page, page_size, total: rows.length }; // TODO: real count query
}

async function findById({ client, brand, id }) {
  const sql = `SELECT * FROM ${tableFor(brand)} WHERE comms_threads_id = $1 LIMIT 1`;
  // NOTE: replace `comms_threads_id` with the actual PK name for this table
  const exec = client ? client.query.bind(client) : query;
  const { rows } = await exec(sql, [id]);
  return rows[0] || null;
}

async function create({ client, brand, input, user_id }) {
  // TODO: build INSERT with parameterised columns from `input`
  throw new Error("TODO: implement smartcomm.create");
}

async function update({ client, brand, id, patch }) {
  // TODO: build UPDATE with parameterised columns from `patch`
  throw new Error("TODO: implement smartcomm.update");
}

async function archive({ client, brand, id }) {
  const sql = `UPDATE ${tableFor(brand)}
                  SET is_deleted = true, deleted_at = now()
                WHERE comms_threads_id = $1`;
  const exec = client ? client.query.bind(client) : query;
  await exec(sql, [id]);
}

module.exports = { findAll, findById, create, update, archive };
