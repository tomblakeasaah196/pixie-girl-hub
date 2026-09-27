"use strict";

// The switch lives in pixiegirl.catalogue_config (Catalogue → Config), not the
// environment. `mockSwitchRows` is what that read returns.
let mockSwitchRows = [];
jest.mock("../../../src/config/env", () => ({ config: {} }));
jest.mock("../../../src/config/database", () => ({
  query: jest.fn(async () => ({ rows: mockSwitchRows })),
}));
const db = require("../../../src/config/database");
const gate = require("../../../src/modules/catalogue/care-accessories.gate");
const { product, variant } = require("../../../src/modules/catalogue/care-accessories.validator");

const id = "11111111-1111-4111-8111-111111111111";
const input = {
  name: "Comb",
  category_id: id,
  taxable: false,
  variants: [{}], // simple item derives SKU from its generated code
};

const setSwitch = (rows) => { mockSwitchRows = rows; gate.invalidate(); };
afterEach(() => setSwitch([]));

test("the Config switch defaults ON; OFF blocks PXG; FLH/other brands never gain access", async () => {
  // No config row yet → the column default (ON). No env variable involved.
  setSwitch([]);
  await expect(gate.enabled("pixiegirl")).resolves.toBe(true);
  setSwitch([{ care_accessories_enabled: false }]);
  await expect(gate.enabled("pixiegirl")).resolves.toBe(false);
  await expect(gate.requireEnabled("pixiegirl")).rejects.toThrow();
  setSwitch([{ care_accessories_enabled: true }]);
  await expect(gate.requireEnabled("pixiegirl")).resolves.toBeUndefined();
  for (const brand of ["faitlynhair", "flh", "PIXIEGIRL", "unknown", null]) {
    await expect(gate.enabled(brand)).resolves.toBe(false);
    await expect(gate.requireEnabled(brand)).rejects.toThrow();
  }
});

test("the switch is read for pixiegirl only, cached, and re-read after a Config save", async () => {
  setSwitch([{ care_accessories_enabled: true }]);
  db.query.mockClear();
  await gate.enabled("faitlynhair");
  expect(db.query).not.toHaveBeenCalled(); // brand allowlist before any read
  await gate.enabled("pixiegirl");
  await gate.enabled("pixiegirl");
  expect(db.query).toHaveBeenCalledTimes(1);
  expect(db.query.mock.calls[0][0]).toMatch(/FROM pixiegirl\.catalogue_config/);
  mockSwitchRows = [{ care_accessories_enabled: false }];
  await expect(gate.enabled("pixiegirl")).resolves.toBe(true); // still cached
  gate.invalidate();
  await expect(gate.enabled("pixiegirl")).resolves.toBe(false);
});

test("a failed read keeps the last known value instead of flipping the switch", async () => {
  const now = jest.spyOn(Date, "now");
  try {
    now.mockReturnValue(1_000_000);
    setSwitch([{ care_accessories_enabled: false }]);
    await expect(gate.enabled("pixiegirl")).resolves.toBe(false);
    // Cache expired, and the re-read fails → still OFF (not the default ON).
    now.mockReturnValue(1_000_000 + 60_000);
    db.query.mockRejectedValueOnce(new Error("connection reset"));
    await expect(gate.enabled("pixiegirl")).resolves.toBe(false);
    // Never read successfully (e.g. before the migration ran) → default ON.
    gate.invalidate();
    db.query.mockRejectedValueOnce(new Error('column "care_accessories_enabled" does not exist'));
    await expect(gate.enabled("pixiegirl")).resolves.toBe(true);
  } finally {
    now.mockRestore();
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
