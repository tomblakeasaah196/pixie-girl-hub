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

const {
  initDatabase,
  query,
  closeDatabase,
} = require("../src/config/database");
const { syncSlice } = require("./lib/incremental-chunks");

/** Compact, readable type name. format_type() already produces the canonical
 *  form (e.g. "character varying(255)", "timestamp with time zone", "uuid",
 *  "numeric(12,2)", "text[]"); tidy the two verbose timestamp spellings. */
function typeOf(c) {
  return String(c.full_type || "")
    .replace(/timestamp with time zone/g, "timestamptz")
    .replace(/timestamp without time zone/g, "timestamp");
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
  // NOTE: information_schema.columns / key_column_usage / constraint_column_usage
  // are catastrophically slow at this table count — the `_pg_expandarray` behind
  // key_column_usage times out over 425 tables. We query pg_catalog directly:
  // same data, orders of magnitude faster, and format_type() yields a clean,
  // ready-to-print type string (so we don't need the old typeOf() mapping).
  const { rows: cols } = await query(
    `SELECT n.nspname AS table_schema, c.relname AS table_name,
            a.attname AS column_name,
            format_type(a.atttypid, a.atttypmod) AS full_type,
            CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
            a.attnum AS ordinal_position
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p')
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY n.nspname, c.relname, a.attnum`,
    [schemas],
  );
  const { rows: pks } = await query(
    `SELECT n.nspname AS table_schema, c.relname AS table_name,
            a.attname AS column_name
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
      WHERE con.contype = 'p' AND n.nspname = ANY($1)`,
    [schemas],
  );
  const { rows: fks } = await query(
    `SELECT n.nspname AS table_schema, c.relname AS table_name,
            att.attname AS column_name,
            fn.nspname AS ref_schema, fc.relname AS ref_table,
            fatt.attname AS ref_column
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_class fc ON fc.oid = con.confrelid
       JOIN pg_namespace fn ON fn.oid = fc.relnamespace
       JOIN generate_subscripts(con.conkey, 1) AS s(i) ON true
       JOIN pg_attribute att
         ON att.attrelid = c.oid AND att.attnum = con.conkey[s.i]
       JOIN pg_attribute fatt
         ON fatt.attrelid = fc.oid AND fatt.attnum = con.confkey[s.i]
      WHERE con.contype = 'f' AND n.nspname = ANY($1)`,
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

  // Build the desired schema slice, then sync incrementally: only tables whose
  // structure changed (or new tables) are rewritten + re-embedded; unchanged
  // tables keep their row and embedding, dropped tables are pruned.
  const desired = tables.map((tbl) => {
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

    return {
      source_type: "schema_doc",
      source_ref: `schema/${logical}.${tbl.table_name}`,
      title: `${logical}.${tbl.table_name} (schema)`,
      content,
      business: null, // structure applies to both brands
    };
  });

  const res = await syncSlice({ query, prefixes: ["schema/%"], chunks: desired });

  // eslint-disable-next-line no-console
  console.log(
    `Schema synced (base: ${brandSchema}): ${res.inserted} new, ${res.updated} changed, ` +
      `${res.unchanged} unchanged, ${res.deleted} removed. ` +
      `Run "npm run rag:reembed -- --missing" to embed only new/changed chunks.`,
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
