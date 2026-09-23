"use strict";

jest.mock("../../../src/config/env", () => ({
  config: { FEATURE_PXG_CARE_ACCESSORIES_ENABLED: false },
}));
const { config } = require("../../../src/config/env");
const gate = require("../../../src/modules/catalogue/care-accessories.gate");
const { product, variant } = require("../../../src/modules/catalogue/care-accessories.validator");

const id = "11111111-1111-4111-8111-111111111111";
const input = {
  name: "Comb",
  category_id: id,
  taxable: false,
  variants: [{}], // simple item derives SKU from its generated code
};

afterEach(() => { config.FEATURE_PXG_CARE_ACCESSORIES_ENABLED = false; });

test("flag defaults off; FLH/other brands never gain access even with flag on", () => {
  expect(gate.enabled("pixiegirl")).toBe(false);
  expect(() => gate.requireEnabled("pixiegirl")).toThrow();
  config.FEATURE_PXG_CARE_ACCESSORIES_ENABLED = true;
  expect(gate.enabled("pixiegirl")).toBe(true);
  for (const brand of ["faitlynhair", "flh", "PIXIEGIRL", "unknown", null]) {
    expect(gate.enabled(brand)).toBe(false);
    expect(() => gate.requireEnabled(brand)).toThrow();
  }
});

test("simple default SKU or independently priced labelled options, no wig attributes", () => {
  expect(product.parse(input).variants).toEqual([{}]);
  const parsed = product.parse({ ...input,
    variants: [
      { sku: "PXG-OIL-50", label: "50 ml", barcode: "0123456789", price_storefront_ngn: 2500, price_pos_ngn: 2500 },
      { sku: "PXG-OIL-100", label: "100 ml", price_storefront_ngn: 4200, price_pos_ngn: 4200 },
    ],
  });
  expect(parsed.variants.map((v) => v.sku)).toEqual(["PXG-OIL-50", "PXG-OIL-100"]);
  expect(variant.safeParse({ sku: "PXG-X", label: "Medium", barcode: null }).success).toBe(true);
});

test("explicit taxable fraction; duplicate/missing SKUs and invalid format rejected", () => {
  expect(product.safeParse({ ...input, taxable: true }).success).toBe(false);
  expect(product.safeParse({ ...input, taxable: true, vat_rate: 0.075 }).success).toBe(true);
  expect(product.safeParse({ ...input, taxable: false, vat_rate: 0.075 }).success).toBe(false);
  expect(product.safeParse({ ...input, variants: [{ sku: "PXG-A" }, { sku: "PXG-A", label: "100 ml" }] }).success).toBe(false);
  expect(product.safeParse({ ...input, variants: [{ sku: "PXG-A", label: "50 ml" }, { label: "100 ml" }] }).success).toBe(false);
  expect(product.safeParse({ ...input, variants: [{ sku: "spaces not allowed" }] }).success).toBe(false);
});

test("batch/expiry and public-channel authoring are not accepted in PR1", () => {
  for (const extra of [
    { batch_number: "B001" }, { expiry_date: "2027-01-01" },
    { is_visible_storefront: true }, { preorder_enabled: true },
    { weight_g: 15 }, { hair_length_inches: 18 },
  ]) expect(product.safeParse({ ...input, ...extra }).success).toBe(false);
  expect(variant.safeParse({ sku: "PXG-A", lot_number: "B001" }).success).toBe(false);
});
