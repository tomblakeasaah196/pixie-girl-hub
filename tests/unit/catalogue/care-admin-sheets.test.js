"use strict";

// Run the exact admin TS sheet parsers (not a reimplementation). The helpers
// import only types, so esbuild erases those imports and runs their real logic.
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("../../../apps/admin/node_modules/esbuild");
const entry = path.resolve(__dirname, "../../../apps/admin/src/lib/care-sheets.ts");
const { text } = buildSync({ entryPoints: [entry], platform: "node", format: "cjs", bundle: true, write: false }).outputFiles[0];
const moduleForTest = new Module(entry, module);
moduleForTest._compile(text, entry);
const { catalogueDrafts, careReceiptLines, assertNoLotColumns } = moduleForTest.exports;
const cat = { category_id: "care-id", name: "Care & Accessories", slug: "care-and-accessories" };
const sku50 = { variant_id: "v50", product_id: "oil", sku: "PXG-OIL-50", product_name: "Oil", variant_name: "50 ml", is_active: true, on_hand: 0 };
const sku100 = { ...sku50, variant_id: "v100", sku: "PXG-OIL-100", variant_name: "100 ml" };
const sheetRow = (extras = {}) => ({ Name: "Oil", Category: cat.name, "Tax Treatment": "exempt", SKU: "PXG-OIL-50", "Option Label": "50 ml", "Product Code": "PXG-OIL", "Storefront NGN": "2,500", "Staff POS NGN": "2400", ...extras });

test("catalogue sheet makes NEW drafts with two labelled exact SKUs, prices and supplier copy; never stock/cost", () => {
  const result = catalogueDrafts([sheetRow({ Ingredients: "Supplier-approved oil", Directions: "Apply lightly", Warnings: "External use" }),
    sheetRow({ SKU: "PXG-OIL-100", "Option Label": "100 ml", "Storefront NGN": "4,000" })], [cat]);
  expect(result.errors).toEqual([]);
  expect(result.items).toHaveLength(1);
  const [item] = result.items;
  expect(item).toMatchObject({ name: "Oil", product_code: "PXG-OIL", category_id: "care-id", taxable: false, ingredients: "Supplier-approved oil", directions: "Apply lightly" });
  expect(item.variants.map((v) => [v.sku, v.label, v.price_storefront_ngn])).toEqual([
    ["PXG-OIL-50", "50 ml", 2500], ["PXG-OIL-100", "100 ml", 4000],
  ]);
  for (const field of ["stock", "cost", "batch", "expiry", "retail_status", "is_visible_storefront", "preorder_enabled"])
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`"${field}"`));
});

test("simple comb with blank SKU remains one simple draft; explicit tax and category required", () => {
  const simple = catalogueDrafts([sheetRow({ Name: "Comb", "Product Code": "", SKU: "", "Option Label": "", "Tax Treatment": "taxable", "VAT Fraction": "0.075" })], [cat]);
  expect(simple.errors).toEqual([]);
  expect(simple.items[0].variants).toEqual([expect.objectContaining({ price_storefront_ngn: 2500 })]);
  expect(simple.items[0].variants[0]).not.toHaveProperty("sku"); // generated from product code by the server
  expect(simple.items[0].vat_rate).toBe(0.075);
  expect(catalogueDrafts([sheetRow({ "VAT Fraction": "0.075" })], [cat]).errors.join(" ")).toMatch(/Exempt item cannot have a VAT rate/);
});

test("catalogue rejects duplicate option SKUs, inconsistent groups, price errors and ambiguous multiple blank SKUs", () => {
  const dup = catalogueDrafts([sheetRow(), sheetRow({ "Option Label": "100 ml" })], [cat]);
  expect(dup.errors.join(" ")).toMatch(/Duplicate SKU/);
  expect(catalogueDrafts([sheetRow(), sheetRow({ Name: "Other", SKU: "PXG-100" })], [cat]).errors.join(" ")).toMatch(/inconsistent product fields/);
  expect(catalogueDrafts([sheetRow({ "Storefront NGN": "-100" })], [cat]).errors.join(" ")).toMatch(/must be nonnegative/);
  expect(catalogueDrafts([sheetRow({ SKU: "" }), sheetRow({ SKU: "PXG-100" })], [cat]).errors.join(" ")).toMatch(/all labelled options must have exact SKUs/);
});

test("receipt sheet resolves exact active SKU only; blank templates do not create stock", () => {
  const result = careReceiptLines([{ SKU: "PXG-OIL-50", Units: "2", "Operational unit cost NGN": "1,200" },
    { SKU: "PXG-OIL-100", Units: "", "Operational unit cost NGN": "" }], [sku50, sku100]);
  expect(result.errors).toEqual([]);
  expect(result.lines).toEqual([expect.objectContaining({ sku: "PXG-OIL-50", variant_id: "v50", quantity: 2, unit_cost_ngn: 1200 })]);
  for (const row of [
    { SKU: "PXG-OIL-50", Units: "2", "Operational unit cost NGN": "0" },
    { SKU: "PXG-OIL-50", Units: "1.5", "Operational unit cost NGN": "300" },
  ]) expect(careReceiptLines([row], [sku50]).errors.join(" ")).toMatch(/positive whole Units value/);
});

test("receipt rejects unknown/FLH/case-mismatch/inactive and duplicate SKU", () => {
  const row = (sku) => ({ SKU: sku, Units: "1", "Operational unit cost NGN": "400" });
  const result = careReceiptLines([row("PXG-OIL-50"), row("PXG-OIL-50"), row("pxg-oil-50"), row("FLH-WIG")], [sku50, sku100]);
  expect(result.lines).toHaveLength(1);
  expect(result.errors).toHaveLength(3);
  expect(careReceiptLines([row("PXG-OIL-100")], [{ ...sku100, is_active: false }]).errors.join(" ")).toMatch(/not an active Care SKU/);
  expect(careReceiptLines([{ SKU: "", Product: "Oil", Units: "", "Operational unit cost NGN": "" }], [sku50]).errors.join(" ")).toMatch(/SKU required/);
});

test("all Care spreadsheets explicitly reject batch and expiry columns", () => {
  for (const h of ["Batch number", "Lot", "Expiry Date", "Best Before"]) {
    expect(() => assertNoLotColumns([{ [h]: "" }])).toThrow(/not supported/);
    expect(() => catalogueDrafts([sheetRow({ [h]: "2027" })], [cat])).toThrow(/not supported/);
    expect(() => careReceiptLines([{ SKU: "PXG-OIL-50", Units: 1, [h]: "2027" }], [sku50])).toThrow(/not supported/);
  }
});
