"use strict";

let mockCareOn = true;
jest.mock("../../../src/config/env", () => ({ config: {} }));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn((fn) => fn({ query: jest.fn() })),
  // The Catalogue → Config Care & Accessories switch the gate reads.
  query: jest.fn(async (sql) =>
    /care_accessories_enabled/.test(sql) ? { rows: [{ care_accessories_enabled: mockCareOn }] } : { rows: [] }),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/shared/outbox/outbox", () => ({ enqueue: jest.fn() }));
jest.mock("../../../src/services/numbering.service", () => ({ nextProductCode: jest.fn() }));
jest.mock("../../../src/modules/catalogue/catalogue.events", () => ({ emit: jest.fn() }));
jest.mock("../../../src/modules/catalogue/catalogue.repo");
jest.mock("../../../src/modules/catalogue/care-accessories.repo");
jest.mock("../../../src/modules/catalogue/cost_vault.service", () => ({
  redactVariants: jest.fn((rows) => rows.map(({ cost_price_ngn: _cost, ...v }) => v)),
  redactVariant: jest.fn((row) => row),
}));

const base = require("../../../src/modules/catalogue/catalogue.repo");
const repo = require("../../../src/modules/catalogue/care-accessories.repo");
const vault = require("../../../src/modules/catalogue/cost_vault.service");
const gate = require("../../../src/modules/catalogue/care-accessories.gate");
// Flip the Catalogue → Config switch (the gate caches it, so drop the cache).
const setCare = (on) => { mockCareOn = on; gate.invalidate(); };
const service = require("../../../src/modules/catalogue/care-accessories.service");
const user = { user_id: "u1" };
const cat = "11111111-1111-4111-8111-111111111111";
const source = { product_id: "oil", product_code: "PXG001N", name: "Care Oil",
  catalogue_role: "retail", category_id: cat, retail_status: "draft", published_at: null,
  is_visible_storefront: false, short_description: "Supplier approved", ingredients: "Oil",
  directions: "Apply gently", warnings: "For external use", taxable: false, vat_rate: null,
  search_keywords: ["oil"] };
const v50 = { variant_id: "v50", product_id: "oil", sku: "PXG-50", variant_name: "50 ml", is_active: true,
  price_storefront_ngn: "3500.00", price_pos_ngn: "3500.00", reorder_point: 2,
  cost_price_ngn: "9000.00", stock_available: 0 };
const v100 = { ...v50, variant_id: "v100", sku: "PXG-100", variant_name: "100 ml", price_storefront_ngn: "6000.00" };
const ctx = { brand: "pixiegirl", user, request_id: "req-1" };

beforeEach(() => {
  setCare(true);
  base.findProductById.mockResolvedValue(source);
  base.productSlugTaken.mockResolvedValue(false);
  base.productCodeTaken.mockResolvedValue(false);
  base.listVariants.mockResolvedValue([v50, v100]);
  base.listImages.mockResolvedValue([{ image_id: "img1" }]);
  base.createVariant.mockImplementation(async ({ input }) => ({ ...input, variant_id: input.sku }));
  repo.create.mockImplementation(async ({ input }) => ({ ...source, ...input, product_id: "new", retail_status: "draft" }));
  repo.categoryAllowed.mockResolvedValue(true);
  repo.costHealth.mockResolvedValue(new Map([["v50", true], ["v100", false]]));
  repo.priceAndMediaReady.mockResolvedValue({ active_skus: 2, invalid_skus: 0, images: 1 });
  repo.setStatus.mockImplementation(async ({ status }) => ({ ...source, retail_status: status }));
  repo.update.mockImplementation(async ({ patch }) => ({ ...source, ...patch, retail_status: "draft" }));
  repo.hasSkuHistory.mockResolvedValue(false);
  base.getVariant.mockResolvedValue(v50);
  base.updateVariant.mockResolvedValue(v50);
  require("../../../src/services/numbering.service").nextProductCode.mockResolvedValue("PXG002N");
});
afterEach(() => { setCare(false); });

test("PXG + Config switch required before any database mutation (including FLH forged IDs)", async () => {
  await expect(service.create({ ...ctx, brand: "faitlynhair", input: {} })).rejects.toThrow();
  expect(repo.create).not.toHaveBeenCalled();
  setCare(false);
  await expect(service.publish({ ...ctx, id: "oil" })).rejects.toThrow();
  expect(repo.setStatus).not.toHaveBeenCalled();
});

test("create: two distinct stock-bearing SKUs with exact option prices; draft, no movement", async () => {
  const item = await service.create({ ...ctx, input: { name: "Care Oil", category_id: cat,
    taxable: false, variants: [
      { label: "50 ml", sku: "PXG-OIL-50", price_storefront_ngn: 3500 },
      { label: "100 ml", sku: "PXG-OIL-100", price_storefront_ngn: 6000 },
    ] } });
  expect(item.retail_status).toBe("draft");
  expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ taxable: false, vat_rate: null, product_code: "PXG002N" }) }));
  expect(base.createVariant.mock.calls.map(([arg]) => arg.input)).toEqual([
    expect.objectContaining({ sku: "PXG-OIL-50", variant_name: "50 ml", is_default: true, price_storefront_ngn: 3500 }),
    expect.objectContaining({ sku: "PXG-OIL-100", variant_name: "100 ml", is_default: false, price_storefront_ngn: 6000 }),
  ]);
  expect(require("../../../src/shared/outbox/outbox").enqueue).toHaveBeenCalledTimes(2);
});

test("list/get: dedicated retail filter; true cost redacted and no preorder", async () => {
  base.findAllProducts.mockResolvedValue({ data: [{ ...source, stock_available: 0 }], meta: {} });
  const list = await service.list({ brand: "pixiegirl", q: "PXG-50" });
  expect(base.findAllProducts).toHaveBeenCalledWith(expect.objectContaining({ filters: expect.objectContaining({ catalogue_role: "retail", q: "PXG-50" }) }));
  expect(list.data[0].availability.state).toBe("out_of_stock");
  const one = await service.getOne({ brand: "pixiegirl", id: "oil" });
  expect(vault.redactVariants).toHaveBeenCalledWith(expect.any(Array), false);
  expect(one.variants[0]).not.toHaveProperty("cost_price_ngn");
  expect(one.variants.map((v) => v.has_operational_cost)).toEqual([true, false]);
});

test("publish explicitly checks category, active SKU prices and image; remains off public storefront", async () => {
  repo.priceAndMediaReady.mockResolvedValueOnce({ active_skus: 2, invalid_skus: 0, images: 0 });
  await expect(service.publish({ ...ctx, id: "oil" })).rejects.toThrow(/requires a photo/);
  expect(repo.setStatus).not.toHaveBeenCalled();
  const live = await service.publish({ ...ctx, id: "oil" });
  expect(repo.setStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "oil", status: "live" }));
  expect(live.is_visible_storefront).toBe(false);
});

test("partial VAT updates validate resulting state and do not violate SQL constraint", async () => {
  await expect(service.update({ ...ctx, id: "oil", patch: { taxable: true } })).rejects.toThrow(/approved VAT rate/);
  await expect(service.update({ ...ctx, id: "oil", patch: { vat_rate: 0.075 } })).rejects.toThrow(/exempt/);
  await service.update({ ...ctx, id: "oil", patch: { taxable: true, vat_rate: 0.075 } });
  expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ taxable: true, vat_rate: 0.075 }) }));
});

test("SKU cannot be renamed after publishing, stocking, PO or prior movements", async () => {
  repo.hasSkuHistory.mockResolvedValueOnce(true);
  await expect(service.updateVariant({ ...ctx, id: "oil", variant_id: "v50", patch: { sku: "PXG-NEW" } })).rejects.toThrow(/previously moved SKU/);
  expect(base.updateVariant).not.toHaveBeenCalled();
  base.findProductById.mockResolvedValueOnce({ ...source, published_at: "2026-09-22" });
  await expect(service.updateVariant({ ...ctx, id: "oil", variant_id: "v50", patch: { sku: "PXG-NEW" } })).rejects.toThrow(/SKU/);
});

test("clone inherits source copy/tax/prices but requires new exact SKUs; never copies stock, cost, photos or barcode", async () => {
  const clone = await service.clone({ ...ctx, id: "oil", input: {
    name: "Care Oil New", variants: [{ sku: "NEW-50" }, { sku: "NEW-100" }],
  } });
  expect(clone.retail_status).toBe("draft");
  expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({
    name: "Care Oil New", ingredients: "Oil", taxable: false,
  }) }));
  expect(base.createVariant.mock.calls.map(([arg]) => arg.input)).toEqual([
    expect.objectContaining({ sku: "NEW-50", variant_name: "50 ml", barcode: null, price_storefront_ngn: "3500.00" }),
    expect.objectContaining({ sku: "NEW-100", variant_name: "100 ml", barcode: null, price_storefront_ngn: "6000.00" }),
  ]);
  await expect(service.clone({ ...ctx, id: "oil", input: { name: "x", variants: [{ sku: "PXG-50" }] } })).rejects.toThrow(/each active source option/);
});
