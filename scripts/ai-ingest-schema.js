#!/usr/bin/env node
"use strict";

/**
 * Ingest the LIVE database schema into shared.ai_knowledge_chunks so Praxis
 * knows the exact data model — every table, its columns/types, keys and
 * relationships — grounded in the running database rather than hand-written
 * docs that drift. One chunk per table.
 *
 * Because it introspects information_schema, it is ALWAYS current and scales
 * automatically: add a feature/table and the next reindex picks it up. Pair
 * this with the SQL agent (sql_schema/sql_query) — this makes the model map
 * business language → the right tables; the agent reads the live values.
 *
 * Idempotent: replaces the `schema/%` slice each run.
 *
 *   npm run ai:ingest-schema     # (re)build schema knowledge chunks
 *   npm run ai:reindex           # docs + schema + embed the whole corpus
 *
 * The two per-business schemas (pixiegirl / faitlynhair) are structurally
 * identical, so only one is introspected and its tables are described as
 * "per-business" to avoid doubling the corpus.
 */

require("dotenv").config();

const crypto = require("crypto");
const {
  initDatabase,
  query,
  closeDatabase,
} = require("../src/config/database");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const tokenEstimate = (s) => Math.max(1, Math.ceil(s.length / 4));

/** Compact, readable type name. */
function typeOf(c) {
  if (c.data_type === "USER-DEFINED") return c.udt_name; // enum/domain
  if (c.data_type === "character varying")
    return c.character_maximum_length
      ? `varchar(${c.character_maximum_length})`
      : "varchar";
  if (c.data_type === "timestamp with time zone") return "timestamptz";
  if (c.data_type === "timestamp without time zone") return "timestamp";
  if (c.data_type === "numeric" && c.numeric_precision)
    return `numeric(${c.numeric_precision},${c.numeric_scale || 0})`;
  if (c.data_type === "ARRAY") return `${c.udt_name.replace(/^_/, "")}[]`;
  return c.data_type;
}

async function upsertChunk({ source_ref, title, content, business }) {
  await query(
    `INSERT INTO shared.ai_knowledge_chunks
       (source_type, source_ref, business, title, content, token_count,
        required_permissions, sensitivity, content_hash)
     VALUES ('schema_doc',$1,$2,$3,$4,$5,'{}','normal',$6)`,
    [
      source_ref,
      business,
      title.slice(0, 240),
      content,
      tokenEstimate(content),
      sha256(content),
    ],
  );
}

async function main() {
  await initDatabase();

  // Which per-business schema to introspect (both are identical in structure).
  const { rows: brandRows } = await query(
    `SELECT schema_name FROM information_schema.schemata
      WHERE schema_name IN ('pixiegirl','faitlynhair')
      ORDER BY schema_name LIMIT 1`,
  );
  const brandSchema = brandRows[0]?.schema_name || "pixiegirl";
  const schemas = ["shared", brandSchema];

  // Bulk-fetch everything, then group in JS (fast — a handful of queries).
  const { rows: tables } = await query(
    `SELECT t.table_schema, t.table_name,
            obj_description(format('%I.%I', t.table_schema, t.table_name)::regclass) AS comment
       FROM information_schema.tables t
      WHERE t.table_schema = ANY($1) AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_schema, t.table_name`,
    [schemas],
  );
  const { rows: cols } = await query(
    `SELECT table_schema, table_name, column_name, data_type, udt_name,
            is_nullable, character_maximum_length, numeric_precision, numeric_scale,
            ordinal_position
       FROM information_schema.columns
      WHERE table_schema = ANY($1)
      ORDER BY table_schema, table_name, ordinal_position`,
    [schemas],
  );
  const { rows: pks } = await query(
    `SELECT tc.table_schema, tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = ANY($1)`,
    [schemas],
  );
  const { rows: fks } = await query(
    `SELECT tc.table_schema, tc.table_name, kcu.column_name,
            ccu.table_schema AS ref_schema, ccu.table_name AS ref_table,
            ccu.column_name AS ref_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = ANY($1)`,
    [schemas],
  );

  const key = (s, t) => `${s}.${t}`;
  const colsBy = new Map();
  for (const c of cols) {
    const k = key(c.table_schema, c.table_name);
    (colsBy.get(k) || colsBy.set(k, []).get(k)).push(c);
  }
  const pkBy = new Map();
  for (const p of pks) {
    const k = key(p.table_schema, p.table_name);
    (pkBy.get(k) || pkBy.set(k, new Set()).get(k)).add(p.column_name);
  }
  const fkBy = new Map();
  for (const f of fks) {
    const k = key(f.table_schema, f.table_name);
    (fkBy.get(k) || fkBy.set(k, new Map()).get(k)).set(
      f.column_name,
      `${f.ref_schema === brandSchema ? "{business}" : f.ref_schema}.${f.ref_table}.${f.ref_column}`,
    );
  }

  const del = await query(
    `DELETE FROM shared.ai_knowledge_chunks WHERE source_ref LIKE 'schema/%'`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `Cleared ${del.rowCount} previous schema chunks. Base schema: ${brandSchema}.`,
  );

  let n = 0;
  for (const tbl of tables) {
    const isBrand = tbl.table_schema === brandSchema;
    const logical = isBrand ? "business" : "shared";
    const k = key(tbl.table_schema, tbl.table_name);
    const tableCols = colsBy.get(k) || [];
    const pkSet = pkBy.get(k) || new Set();
    const fkMap = fkBy.get(k) || new Map();

    const header = isBrand
      ? `Table {business}.${tbl.table_name} — exists once per business (pixiegirl.${tbl.table_name}, faitlynhair.${tbl.table_name}).`
      : `Table shared.${tbl.table_name} — shared across both businesses.`;
    const purpose = tbl.comment ? `Purpose: ${tbl.comment}` : null;
    const pkLine = pkSet.size ? `Primary key: ${[...pkSet].join(", ")}` : null;
    const colLines = tableCols.map((c) => {
      const bits = [c.column_name, typeOf(c)];
      if (c.is_nullable === "NO") bits.push("NOT NULL");
      if (pkSet.has(c.column_name)) bits.push("PK");
      const fk = fkMap.get(c.column_name);
      if (fk) bits.push(`→ ${fk}`);
      return `- ${bits.join(" ")}`;
    });

    const content = [header, purpose, pkLine, "Columns:", ...colLines]
      .filter(Boolean)
      .join("\n");

    await upsertChunk({
      source_ref: `schema/${logical}.${tbl.table_name}`,
      title: `${logical}.${tbl.table_name} (schema)`,
      content,
      business: null, // structure applies to both brands
    });
    n += 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    `\nIngested ${n} table schema chunks. Run "npm run rag:reembed" to vectorise.`,
  );
}

main()
  .catch((err) => {
    /// eslint-disable-next-line no-console
    console.error("ai-ingest-schema failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeDatabase();
    } catch {
      /* ignore */
    }
  });
