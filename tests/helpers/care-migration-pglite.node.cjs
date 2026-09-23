"use strict";

/** Embedded PostgreSQL smoke for the upgrade/repair template. This is a small
 * representative pre-94 fixture, NOT an assertion about deployed schemas or
 * a substitute for applying all business templates to a real environment. */
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { PGlite } = require("@electric-sql/pglite");
const raw = fs.readFileSync(path.resolve(__dirname, "../../migrations/template/000094_business_care_accessories.sql.template"), "utf8");
const old43 = fs.readFileSync(path.resolve(__dirname, "../../migrations/template/000043_business_base_never_storefront.sql.template"), "utf8");
const before94 = `
CREATE TABLE %s.product_categories (
  category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text UNIQUE NOT NULL,
  description text, is_visible_storefront boolean NOT NULL DEFAULT true, is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE %s.products (
  product_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_code text UNIQUE NOT NULL, name text NOT NULL,
  category_id uuid REFERENCES %s.product_categories(category_id),
  product_type text NOT NULL DEFAULT 'physical', track_stock boolean NOT NULL DEFAULT true,
  is_custom boolean NOT NULL DEFAULT false, preorder_enabled boolean NOT NULL DEFAULT true,
  preorder_excluded boolean NOT NULL DEFAULT false, rewig_eligible boolean NOT NULL DEFAULT true,
  size_code text, base_family_id uuid, hair_length_inches smallint, texture_type text,
  lace_type text, density text, cap_size text, hair_origin text, required_deposit_pct numeric,
  payment_model text NOT NULL DEFAULT 'layaway', is_visible_storefront boolean NOT NULL DEFAULT true,
  visible_on_channels text[] NOT NULL DEFAULT '{storefront,pos}', taxable boolean NOT NULL DEFAULT true,
  vat_rate numeric, created_at timestamptz NOT NULL DEFAULT now(), is_deleted boolean NOT NULL DEFAULT false
);
CREATE TABLE %s.product_variants (
  variant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid REFERENCES %s.products(product_id),
  sku text UNIQUE NOT NULL
);
CREATE TABLE %s.styled_products (
  styled_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), base_product_id uuid REFERENCES %s.products(product_id),
  base_variant_id uuid REFERENCES %s.product_variants(variant_id)
);
CREATE TABLE %s.styled_product_variants (
  styled_variant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), base_product_id uuid REFERENCES %s.products(product_id)
);
CREATE TABLE %s.sales_order_lines (
  line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid REFERENCES %s.products(product_id),
  variant_id uuid REFERENCES %s.product_variants(variant_id)
);
CREATE TABLE %s.stock_movements (
  movement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), variant_id uuid REFERENCES %s.product_variants(variant_id),
  movement_type text NOT NULL, unit_cost_ngn numeric
);
`;
const wigId = "11111111-1111-4111-8111-111111111111";
const careId = "22222222-2222-4222-8222-222222222222";
const careSku = "33333333-3333-4333-8333-333333333333";

async function fixture(brand) {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA ${brand}`);
  await db.exec(before94.replace(/%s/g, brand));
  await db.query(`INSERT INTO ${brand}.products(product_id, product_code, name)
    VALUES ($1, 'WIG-1', 'Classic Wig - Small')`, [wigId]);
  return db;
}
const sql = (brand) => raw.replace(/\{\{BUSINESS\}\}/g, brand);
const retail = (brand) => `INSERT INTO ${brand}.products
  (product_id, product_code, name, catalogue_role, retail_status, product_type, track_stock,
    is_custom, preorder_enabled, preorder_excluded, rewig_eligible, payment_model,
    is_visible_storefront, visible_on_channels, taxable, vat_rate)
  VALUES ($1, 'PXG-OIL', 'Care Oil', 'retail', 'draft', 'physical', true,
    false, false, true, false, 'full_payment_only', false, '{}', false, NULL)`;

let db;
afterEach(async () => { if (db) { await db.close(); db = null; } });

test("PXG pre-94 upgrade and replay: existing wig stays base, Care seed stays singular", async () => {
  db = await fixture("pixiegirl");
  // Legacy storefront lockdown must work before catalogue_role even exists.
  await db.exec(old43.replace(/\{\{BUSINESS\}\}/g, "pixiegirl"));
  let wig = (await db.query("SELECT is_visible_storefront, visible_on_channels FROM pixiegirl.products WHERE product_id = $1", [wigId])).rows[0];
  assert.deepEqual(wig, { is_visible_storefront: false, visible_on_channels: ["pos"] });
  await db.exec(sql("pixiegirl"));
  assert.equal((await db.query("SELECT catalogue_role FROM pixiegirl.products WHERE product_id = $1", [wigId])).rows[0].catalogue_role, "base");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pixiegirl.product_categories WHERE slug = 'care-and-accessories'")).rows[0].n, 1);
  await db.query(retail("pixiegirl"), [careId]);
  await db.query("INSERT INTO pixiegirl.product_variants (variant_id, product_id, sku) VALUES ($1,$2,'PXG-OIL-50')", [careSku, careId]);
  // Idempotent repair, including base lockdown replay after Care exists.
  await db.exec(old43.replace(/\{\{BUSINESS\}\}/g, "pixiegirl"));
  await db.exec(sql("pixiegirl"));
  assert.deepEqual((await db.query("SELECT catalogue_role, is_visible_storefront, visible_on_channels FROM pixiegirl.products WHERE product_id = $1", [careId])).rows[0], { catalogue_role: "retail", is_visible_storefront: false, visible_on_channels: [] });
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pixiegirl.product_categories WHERE slug = 'care-and-accessories'")).rows[0].n, 1);
  assert.equal((await db.query("SELECT catalogue_role FROM pixiegirl.products WHERE product_id = $1", [wigId])).rows[0].catalogue_role, "base");
});

test("FLH upgrade/repair: structural compatibility but retail constraint forbids forged row", async () => {
  db = await fixture("faitlynhair");
  await db.exec(sql("faitlynhair"));
  await db.exec(sql("faitlynhair"));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM faitlynhair.product_categories WHERE slug = 'care-and-accessories'")).rows[0].n, 0);
  await assert.rejects(db.query(retail("faitlynhair"), [careId]), /chk_care_accessories_role/);
  assert.equal((await db.query("SELECT catalogue_role FROM faitlynhair.products WHERE product_id = $1", [wigId])).rows[0].catalogue_role, "base");
});

test("Care catalogue cannot gain wig attributes, payment plans, web/DM channel flags or role rewrites", async () => {
  db = await fixture("pixiegirl");
  await db.exec(sql("pixiegirl"));
  await db.query(retail("pixiegirl"), [careId]);
  for (const patch of [
    "hair_length_inches = 14", "preorder_enabled = true", "rewig_eligible = true",
    "payment_model = 'layaway'", "visible_on_channels = '{instagram}'",
    "visible_on_channels = '{storefront}'", "is_visible_storefront = true",
    "taxable = true", "vat_rate = 1.5", "required_deposit_pct = 50",
  ]) await assert.rejects(db.exec(`UPDATE pixiegirl.products SET ${patch} WHERE product_id = '${careId}'`), /chk_care_accessories_role/);
  await assert.rejects(db.exec(`UPDATE pixiegirl.products SET catalogue_role = 'base' WHERE product_id = '${careId}'`), /immutable/);
  await assert.rejects(db.exec(`UPDATE pixiegirl.products SET catalogue_role = 'retail' WHERE product_id = '${wigId}'`), /immutable/);
});

test("Care item cannot serve as styled base or variant donor, and cannot be sold through order line", async () => {
  db = await fixture("pixiegirl");
  await db.exec(sql("pixiegirl"));
  await db.query(retail("pixiegirl"), [careId]);
  await db.query("INSERT INTO pixiegirl.product_variants (variant_id, product_id, sku) VALUES ($1,$2,'PXG-OIL-50')", [careSku, careId]);
  await assert.rejects(db.exec(`INSERT INTO pixiegirl.styled_products(base_product_id) VALUES ('${careId}')`), /hair base/);
  await assert.rejects(db.exec(`INSERT INTO pixiegirl.styled_product_variants(base_product_id) VALUES ('${careId}')`), /hair base/);
  await assert.rejects(db.exec(`INSERT INTO pixiegirl.styled_products(base_product_id,base_variant_id) VALUES ('${wigId}','${careSku}')`), /hair base variant/);
  await assert.rejects(db.exec(`INSERT INTO pixiegirl.sales_order_lines(product_id) VALUES ('${careId}')`), /sales are disabled/);
  await assert.rejects(db.exec(`INSERT INTO pixiegirl.sales_order_lines(variant_id) VALUES ('${careSku}')`), /sales are disabled/);
});

test("Care stock ledger permits costed receipts/counts/transfers but never uncosted intake, reserve or sale", async () => {
  db = await fixture("pixiegirl");
  await db.exec(sql("pixiegirl"));
  await db.query(retail("pixiegirl"), [careId]);
  await db.query("INSERT INTO pixiegirl.product_variants (variant_id, product_id, sku) VALUES ($1,$2,'PXG-OIL-50')", [careSku, careId]);
  const move = (type, cost) => db.query("INSERT INTO pixiegirl.stock_movements(variant_id,movement_type,unit_cost_ngn) VALUES ($1,$2,$3)", [careSku, type, cost]);
  for (const type of ["reserve", "release_reserve", "sale", "return", "production_in", "consignment_out"])
    await assert.rejects(move(type, 500), /inventory-only/);
  await assert.rejects(move("receive", null), /positive operational cost/);
  await assert.rejects(move("receive", 0), /positive operational cost/);
  await move("receive", 500);
  await move("adjustment_in", null); // Requires approval at service layer.
  await move("transfer_in", null);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pixiegirl.stock_movements")).rows[0].n, 3);
});
