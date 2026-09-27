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
jest.mock("../../../src/modules/stock/stock.subscribers", () => ({}));
jest.mock("../../../src/modules/stock/stock.events", () => ({ emit: jest.fn() }));
jest.mock("../../../src/modules/stock/stock.repo");
jest.mock("../../../src/modules/catalogue/cost_vault.service", () => ({ canSeeCost: jest.fn() }));

const repo = require("../../../src/modules/stock/stock.repo");
const vault = require("../../../src/modules/catalogue/cost_vault.service");
const gate = require("../../../src/modules/catalogue/care-accessories.gate");
// Flip the Catalogue → Config switch (the gate caches it, so drop the cache).
const setCare = (on) => { mockCareOn = on; gate.invalidate(); };
const service = require("../../../src/modules/stock/stock.service");
const user = { user_id: "u1", display_name: "Owner", email: "owner@example.com" };
const ctx = { brand: "pixiegirl", user, request_id: "req-1" };
const location = { location_id: "loc-1", display_name: "Store", is_active: true };
const retail = { variant_id: "v50", product_id: "oil", sku: "PXG-50", catalogue_role: "retail", is_deleted: false, is_active: true, track_stock: true };
const variants = [
  { variant_id: "v50", product_id: "oil", sku: "PXG-50", variant_name: "50 ml", product_name: "Oil", on_hand: 5, reserved: 1, has_operational_cost: true },
  { variant_id: "v100", product_id: "oil", sku: "PXG-100", variant_name: "100 ml", product_name: "Oil", on_hand: 8, reserved: 0, has_operational_cost: true },
];
const receipt = { destination_location_id: "loc-1", lines: [{ variant_id: "v50", quantity: 2, unit_cost_ngn: 900 }] };

beforeEach(() => {
  setCare(true);
  repo.variantForIntake.mockResolvedValue(retail);
  repo.locationsWithStock.mockResolvedValue([location]);
  repo.careVariantsAtLocation.mockResolvedValue(variants);
  repo.defaultVariantForProduct.mockResolvedValue(null);
  vault.canSeeCost.mockResolvedValue(true);
  repo.createAdjustment.mockResolvedValue({ adjustment_id: "adj1", adjustment_number: "PXG-ADJ-11" });
  repo.addAdjustmentLine.mockResolvedValue({});
  repo.getAdjustment.mockResolvedValue({ adjustment_id: "adj1", adjustment_number: "PXG-ADJ-11", status: "draft", lines: [] });
  repo.setAdjustmentStatus.mockResolvedValue({ status: "submitted" });
  repo.getCostBasisForVariants.mockResolvedValue(new Map([["v50", "900.00"]]));
});
afterEach(() => { setCare(false); });

test("read-only Care SKU template lists exact location and quantity without cost amounts", async () => {
  const result = await service.listCareSkus({ brand: "pixiegirl", location_id: "loc-1" });
  expect(result.rows).toEqual(variants);
  expect(result.location).toEqual({ location_id: "loc-1", display_name: "Store" });
  expect(repo.careVariantsAtLocation).toHaveBeenCalledWith({ brand: "pixiegirl", location_id: "loc-1" });
  await expect(service.listCareSkus({ brand: "faitlynhair", location_id: "loc-1" })).rejects.toThrow();
});

test("care count previews without writes; commit files and submits ONE count adjustment", async () => {
  const input = { location_id: "loc-1", rows: [{ SKU: "PXG-50", Units: "4" }], blank: "skip", unlisted: "skip" };
  const preview = await service.importCareCount({ ...ctx, input: { ...input, commit: false } });
  expect(preview.lines).toEqual([expect.objectContaining({ variant_id: "v50", system_count: 5, physical_count: 4 })]);
  expect(repo.createAdjustment).not.toHaveBeenCalled();
  expect(repo.recordMovement).not.toHaveBeenCalled();
  const commit = await service.importCareCount({ ...ctx, input: { ...input, commit: true } });
  expect(commit.adjustment).toEqual({ adjustment_id: "adj1", adjustment_number: "PXG-ADJ-11", status: "submitted" });
  expect(repo.createAdjustment).toHaveBeenCalledTimes(1);
  expect(repo.addAdjustmentLine).toHaveBeenCalledWith(expect.objectContaining({ line: expect.objectContaining({ variant_id: "v50", system_count: 5, physical_count: 4 }) }));
  expect(repo.setAdjustmentStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "adj1", status: "submitted" }));
  expect(repo.recordMovement).not.toHaveBeenCalled();
});

test("unknown/FLH SKU blockers, no preview write and no silent --allow-unmatched", async () => {
  const input = { location_id: "loc-1", rows: [{ SKU: "FLH-WIG", Units: 1 }], commit: false };
  const p = await service.importCareCount({ ...ctx, input });
  expect(p.blockers.join(" ")).toMatch(/not a PXG Care/);
  await expect(service.importCareCount({ ...ctx, input: { ...input, commit: true } })).rejects.toThrow(/not a PXG Care/);
  expect(repo.createAdjustment).not.toHaveBeenCalled();
  await expect(service.importCareCount({ ...ctx, brand: "faitlynhair", input })).rejects.toThrow();
});

test("no receiving by a guessed default/uncosted SKU, and Cost Vault grant is enforced", async () => {
  await expect(service.createGoodsReceipt({ ...ctx, input: { ...receipt, lines: [{ product_id: "oil", quantity: 1 }] } })).rejects.toThrow(/Active stock-bearing SKU/);
  await expect(service.createGoodsReceipt({ ...ctx, input: { ...receipt, lines: [{ variant_id: "v50", quantity: 1 }] } })).rejects.toThrow(/positive operational cost/);
  vault.canSeeCost.mockResolvedValue(false);
  await expect(service.createGoodsReceipt({ ...ctx, input: receipt })).rejects.toThrow(/Cost Vault access/);
  expect(repo.createShipment).not.toHaveBeenCalled();
  expect(repo.recordMovement).not.toHaveBeenCalled();
});

test("PO receipts verify exact variant and outstanding units before any stock movement", async () => {
  repo.poLineForReceipt.mockResolvedValue({ variant_id: "v100", qty_outstanding: 4 });
  await expect(service.createGoodsReceipt({ ...ctx, input: { ...receipt, purchase_order_id: "po1", lines: [{ ...receipt.lines[0], po_line_id: "po-line-1" }] } })).rejects.toThrow(/exact SKU/);
  repo.poLineForReceipt.mockResolvedValue({ variant_id: "v50", qty_outstanding: 1 });
  await expect(service.createGoodsReceipt({ ...ctx, input: { ...receipt, purchase_order_id: "po1", lines: [{ ...receipt.lines[0], po_line_id: "po-line-1" }] } })).rejects.toThrow(/outstanding quantity/);
  expect(repo.recordMovement).not.toHaveBeenCalled();
});

test("retail direct stock movements and advanced shipments cannot bypass costed workflows", async () => {
  await expect(service.recordMovement({ ...ctx, input: { variant_id: "v50", location_id: "loc-1", quantity: -1, movement_type: "adjustment_out" } })).rejects.toThrow(/Goods Reception/);
  await expect(service.createShipment({ ...ctx, input: { lines: [{ variant_id: "v50", qty_expected: 2 }] } })).rejects.toThrow(/positive operational cost/);
  repo.getShipment.mockResolvedValue({ shipment_id: "s1", status: "draft", lines: [{ line_id: "l1", variant_id: "v50", qty_expected: 2, unit_cost_ngn: null }] });
  repo.getDefaultLocation.mockResolvedValue(location);
  await expect(service.receiveShipment({ ...ctx, id: "s1" })).rejects.toThrow(/stock-bearing and costed/);
  expect(repo.recordMovement).not.toHaveBeenCalled();
});

test("even surplus count corrections require approval; stale or under-reserved snapshots are rejected", async () => {
  const adj = { adjustment_id: "adj1", location_id: "loc-1", adjustment_type: "count", status: "submitted",
    lines: [{ variant_id: "v50", system_count: 5, physical_count: 6 }] };
  repo.getAdjustment.mockResolvedValue(adj);
  await expect(service.postAdjustment({ ...ctx, id: "adj1" })).rejects.toThrow(/require approval/);
  repo.getAdjustment.mockResolvedValue({ ...adj, status: "approved" });
  repo.lockLevel.mockResolvedValue({ on_hand: 6, reserved: 0 });
  await expect(service.postAdjustment({ ...ctx, id: "adj1" })).rejects.toThrow(/recount/);
  repo.lockLevel.mockResolvedValue({ on_hand: 5, reserved: 7 });
  await expect(service.postAdjustment({ ...ctx, id: "adj1" })).rejects.toThrow(/recount/);
  expect(repo.recordMovement).not.toHaveBeenCalled();
});
