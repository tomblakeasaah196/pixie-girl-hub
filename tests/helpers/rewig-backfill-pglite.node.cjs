"use strict";

/**
 * Real-SQL check for migration 000088's replay behaviour (node:test — run
 * outside Jest because PGlite's Wasm needs a plain Node process; see
 * care-migration-db.test.js for the wrapper pattern).
 *
 * Scenario (the reported Light Blonde XL case): S/M/L bases exist when
 * 000088 first applies; afterwards "Create other sizes" adds XL bases
 * carrying NULL size_code/base_family_id (as the creation code used to
 * leave them), and one XL is even given a family of its own — as a pre-fix
 * repair replay would. A repair replay of the CURRENT template must unify
 * every name group into ONE family with every size_code set, or rewig
 * counts 0 sibling stock and the variant reads "out of stock".
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const TEMPLATE = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../migrations/template/000088_business_catalogue_rewig_adjacency.sql.template",
  ),
  "utf8",
);
const SQL = TEMPLATE.replace(/\{\{BUSINESS\}\}/g, "faitlynhair");

test("000088 repair replay unifies late-added and split bases into one family per size run", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE SCHEMA faitlynhair;
      CREATE TABLE faitlynhair.styled_size_tiers (
        size_code text PRIMARY KEY, label text, display_order int, is_active boolean DEFAULT true);
      INSERT INTO faitlynhair.styled_size_tiers VALUES
        ('S','Small',1,true),('M','Medium',2,true),('L','Large',3,true),('XL','Extra Large',4,true);
      CREATE TABLE faitlynhair.products (
        product_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text, is_deleted boolean DEFAULT false);
      CREATE TABLE faitlynhair.styled_products (styled_id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE faitlynhair.catalogue_config (singleton boolean PRIMARY KEY DEFAULT true);
      INSERT INTO faitlynhair.catalogue_config (singleton) VALUES (true);
      INSERT INTO faitlynhair.products (name) VALUES
        ('T3/12 Straight HD13x6 Pixie - Small'),
        ('T3/12 Straight HD13x6 Pixie - Medium'),
        ('T3/12 Straight HD13x6 Pixie - Large'),
        ('T3/12 Straight HD13x4 Pixie - Large');
    `);
    await db.exec(SQL); // original migration-time application

    // "Create other sizes" adds the XL bases afterwards (NULL size/family,
    // as pre-fix creation left them); a pre-fix repair replay then strands
    // one of them in a family of its own.
    await db.exec(`
      INSERT INTO faitlynhair.products (name) VALUES
        ('T3/12 Straight HD13x6 Pixie - Extra Large'),
        ('T3/12 Straight HD13x4 Pixie - Extra Large');
      UPDATE faitlynhair.products
         SET size_code = 'XL', base_family_id = gen_random_uuid()
       WHERE name = 'T3/12 Straight HD13x4 Pixie - Extra Large';
    `);
    await db.exec(SQL); // repair replay

    const { rows } = await db.query(
      `SELECT name, size_code, base_family_id FROM faitlynhair.products ORDER BY name`,
    );
    assert.equal(rows.length, 6);
    for (const r of rows) assert.ok(r.size_code, `${r.name} must carry a size_code`);

    const byKey = new Map();
    for (const r of rows) {
      const key = r.name.replace(/\s*-\s*(Small|Medium|Large|Extra Large)\s*$/i, "");
      if (!byKey.has(key)) byKey.set(key, new Set());
      byKey.get(key).add(r.base_family_id);
    }
    assert.deepEqual(
      [...byKey.values()].map((s) => s.size),
      [1, 1],
      "13x6 run (S/M/L/XL) and 13x4 run (L/XL) must each share exactly one family",
    );
  } finally {
    await db.close();
  }
});
