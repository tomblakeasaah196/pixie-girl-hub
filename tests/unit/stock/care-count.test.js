"use strict";

const { plan } = require("../../../src/modules/stock/stock.care-count");

const variants = [
  { sku: "PXG-OIL-50", variant_id: "v50", product_id: "oil", product_name: "Care Oil", variant_name: "50 ml", on_hand: 5, reserved: 1, has_operational_cost: true },
  { sku: "PXG-OIL-100", variant_id: "v100", product_id: "oil", product_name: "Care Oil", variant_name: "100 ml", on_hand: 8, reserved: 0, has_operational_cost: true },
  { sku: "PXG-COMB", variant_id: "comb", product_id: "comb", product_name: "Comb", variant_name: "Standard", on_hand: 2, reserved: 0, has_operational_cost: true },
];
const count = (rows, options = {}) => plan({ rows, variants, ...options });

test("counting 50 ml never guesses or changes 100 ml or the comb", () => {
  const p = count([{ SKU: "PXG-OIL-50", Units: "2", Name: "Wrong name" }]);
  expect(p.blockers).toEqual([]);
  expect(p.lines).toEqual([expect.objectContaining({ sku: "PXG-OIL-50", system_count: 5, physical_count: 2, delta: -3 })]);
  expect(p.summary).toMatchObject({ corrections: 1, zeroed: 0, ends_at: 12 });
});

test("only explicit unlisted=zero sweeps other Care SKUs, never a base wig", () => {
  const p = count([{ SKU: "PXG-OIL-50", Units: "5" }], { unlisted: "zero" });
  expect(p.lines.map((l) => l.sku)).toEqual(["PXG-OIL-100", "PXG-COMB"]);
  expect(p.lines.every((l) => l.kind === "unlisted" && l.delta < 0)).toBe(true);
  expect(p.summary.ends_at).toBe(5);
});

test("unknown/FLH SKU, missing identity, case-mismatch and duplicate are hard blockers", () => {
  const p = count([{ SKU: "FLH-50", Units: 3 }, { Name: "Care Oil", Units: 1 },
    { SKU: "pxg-oil-50", Units: 2 }, { SKU: "PXG-COMB", Units: 2 }, { SKU: "PXG-COMB", Units: 1 }]);
  expect(p.blockers).toHaveLength(4);
  expect(p.blockers.join(" ")).toMatch(/not a PXG Care & Accessories SKU/);
  expect(p.blockers.join(" ")).toMatch(/exact SKU is required/);
  expect(p.blockers.join(" ")).toMatch(/duplicate SKU/);
  expect(p.lines).toEqual([]);
});

test("blank=skip leaves untouched even with unlisted=zero; blank=zero is explicit", () => {
  expect(count([{ SKU: "PXG-OIL-50", Units: "" }], { unlisted: "zero" }).lines.map((l) => l.sku))
    .toEqual(["PXG-OIL-100", "PXG-COMB"]);
  const p = count([{ SKU: "PXG-OIL-50", Units: "" }], { blank: "zero" });
  expect(p.blockers.join(" ")).toMatch(/reserved/);
  expect(p.lines[0].physical_count).toBe(0);
});

test("fractional/negative/non-numeric quantities, reservation violations and missing cost block", () => {
  const bad = count([{ SKU: "PXG-OIL-50", Units: "1.5" }, { SKU: "PXG-OIL-100", Units: "-2" }, { SKU: "PXG-COMB", Units: "free" }]);
  expect(bad.blockers).toHaveLength(3);
  expect(count([{ SKU: "PXG-OIL-50", Units: "0" }]).blockers.join(" ")).toMatch(/reserved/);
  const p = plan({ rows: [{ SKU: "PXG-COMB", Units: "3" }], variants: [{ ...variants[2], has_operational_cost: false }] });
  expect(p.blockers.join(" ")).toMatch(/positive operational cost/);
});

test("a name-only sheet row (even with blank Units) blocks instead of guessing or silently skipping", () => {
  expect(count([{ Product: "Oil", Units: "" }]).blockers.join(" ")).toMatch(/exact SKU is required/);
});

test("batch/expiry columns cannot be silently dropped from a Care count sheet", () => {
  const p = count([{ SKU: "PXG-COMB", Units: 2, "Expiry Date": "2027-01-01" }]);
  expect(p.blockers.join(" ")).toMatch(/batch\/lot and expiry columns are not supported/);
  expect(p.lines).toEqual([]);
});

test("omitted zero with reserved stock or no operational cost cannot be filed", () => {
  const p = plan({ rows: [], variants: [{ ...variants[0], has_operational_cost: false }], unlisted: "zero" });
  expect(p.blockers).toHaveLength(2);
  expect(p.summary.zeroed).toBe(1);
});
