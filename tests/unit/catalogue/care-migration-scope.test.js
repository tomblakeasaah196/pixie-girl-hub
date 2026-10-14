"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../../..");
const template = (name) => fs.readFileSync(path.join(root, "migrations/template", name), "utf8");
const sql = template("000094_business_care_accessories.sql.template");
const old43 = template("000043_business_base_never_storefront.sql.template");
const rewig = template("000088_business_catalogue_rewig_adjacency.sql.template");

test("fresh/upgrade: FLH cannot store a retail row, no legacy rows reclassified", () => {
  expect(sql).toContain("ADD COLUMN IF NOT EXISTS catalogue_role TEXT NOT NULL DEFAULT 'base'");
  expect(sql).toContain("AND (catalogue_role = 'base' OR '{{BUSINESS}}' = 'pixiegirl')");
  expect(sql).toContain("fn_care_role_immutable");
  expect(sql).not.toMatch(/UPDATE \{\{BUSINESS\}\}\.products\s+SET catalogue_role/);
  expect(sql).toContain("WHERE '{{BUSINESS}}' = 'pixiegirl'");
});

test("repeat repair: base storefront lockdown and rewig backfill exclude classified retail", () => {
  expect(old43.match(/\(to_jsonb\(p\)->>'catalogue_role'\) IS DISTINCT FROM 'retail'/g)).toHaveLength(2);
  // 4 occurrences in 000088: 4a, 4b's unassigned + existing-family reads,
  // and 4c's split-family merge — every products read there excludes retail.
  expect(rewig.match(/\(to_jsonb\(p\)->>'catalogue_role'\) IS DISTINCT FROM 'retail'/g)).toHaveLength(4);
  expect(old43).not.toMatch(/ALTER COLUMN catalogue_role/);
  expect(sql).toContain("DROP TRIGGER IF EXISTS trg_care_role_immutable");
  expect(sql).toContain("DROP TRIGGER IF EXISTS trg_care_no_sales_before_pr2");
  expect(sql).toContain("DROP TRIGGER IF EXISTS trg_care_stock_only_before_pr2");
});

test("fail-closed public sales, styled wig linking and prohibited stock movements", () => {
  expect(sql).toContain("ON {{BUSINESS}}.sales_order_lines");
  expect(sql).toContain("ON {{BUSINESS}}.stock_movements");
  expect(sql).toContain("NEW.unit_cost_ngn, 0) <= 0");
  expect(sql).toContain("NEW.movement_type NOT IN (");
  expect(sql).toContain("'receive', 'transfer_in', 'transfer_out', 'adjustment_in', 'adjustment_out'");
  for (const blocked of ["'reserve'", "'sale'", "'production_in'", "'return'"])
    expect(sql.slice(sql.indexOf("fn_care_stock_only_before_pr2()"))).not.toContain(blocked);
  expect(sql).toContain("trg_styled_variant_hair_base_only");
  expect(sql).toContain("trg_styled_hair_base_only");
  expect(sql).toContain("AND visible_on_channels = '{}'::text[]");
  expect(sql).not.toMatch(/(batch_id|lot_number|expiry_date)/i);
});

test("PXG and FLH render one schema each; no unresolved placeholder after rendering", () => {
  for (const brand of ["pixiegirl", "faitlynhair"]) {
    const rendered = sql.replace(/\{\{BUSINESS\}\}/g, brand);
    expect(rendered).not.toContain("{{BUSINESS}}");
    expect(rendered).toContain(`${brand}.products`);
    expect(rendered).toContain(`idx_${brand}_products_care_role`);
  }
});
