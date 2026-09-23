"use strict";

jest.mock("../../../src/config/env", () => ({ config: { FEATURE_PXG_CARE_ACCESSORIES_ENABLED: true } }));
jest.mock("../../../src/config/database", () => ({ transaction: jest.fn((fn) => fn({ query: jest.fn() })) }));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/purchasing/purchasing.repo");
jest.mock("../../../src/modules/purchasing/purchasing.events", () => ({ emit: jest.fn() }));
jest.mock("../../../src/modules/stock/stock.repo");
jest.mock("../../../src/modules/stock/stock.service", () => ({ receiveStock: jest.fn() }));
jest.mock("../../../src/modules/catalogue/catalogue.repo");
jest.mock("../../../src/modules/catalogue/cost_vault.service", () => ({ canSeeCost: jest.fn() }));
jest.mock("../../../src/modules/accounting/accounting.service", () => ({ postEntry: jest.fn() }));
jest.mock("../../../src/services/pdf.service", () => ({}));

const repo = require("../../../src/modules/purchasing/purchasing.repo");
const stockRepo = require("../../../src/modules/stock/stock.repo");
const catalogue = require("../../../src/modules/catalogue/catalogue.repo");
const vault = require("../../../src/modules/catalogue/cost_vault.service");
const stock = require("../../../src/modules/stock/stock.service");
const { config } = require("../../../src/config/env");
const purchasing = require("../../../src/modules/purchasing/purchasing.service");
const payables = require("../../../src/modules/purchasing/purchasing.payables.service");
const ctx = { brand: "pixiegirl", user: { user_id: "buyer" }, request_id: "req1" };
const care = { variant_id: "v100", product_id: "oil", is_deleted: false, is_active: true, track_stock: true, catalogue_role: "retail" };
const poInput = (line) => ({ supplier_id: "supplier", title: "Care order", po_currency: "NGN",
  lines: [{ description: "Oil 100 ml", qty_ordered: 2, unit_price: 500, ...line }] });
const grnLine = (patch = {}) => ({ po_line_id: "po-line", variant_id: "v100", qty_expected: 2,
  qty_received: 2, qty_rejected: 0, unit_cost_ngn: 500, ...patch });

beforeEach(() => {
  config.FEATURE_PXG_CARE_ACCESSORIES_ENABLED = true;
  repo.nextNumber.mockResolvedValue("PXG-PO-1");
  repo.createPo.mockResolvedValue({ po_id: "po1" });
  repo.getPo.mockResolvedValue({ po_id: "po1", supplier_id: "supplier" });
  repo.setPoTotals.mockResolvedValue({});
  repo.addPoLine.mockResolvedValue({});
  stockRepo.variantForIntake.mockImplementation(async ({ variant_id }) => ({ ...care, variant_id }));
  stockRepo.poLineForReceipt.mockResolvedValue({ variant_id: "v100", qty_outstanding: 2 });
  catalogue.findProductById.mockResolvedValue({ product_id: "oil", catalogue_role: "retail" });
  vault.canSeeCost.mockResolvedValue(true);
  repo.createGrn.mockResolvedValue({ grn_id: "grn1" });
  repo.getGrn.mockResolvedValue({ grn_id: "grn1", status: "draft", po_id: "po1", received_at_location_id: "loc1", lines: [grnLine()] });
});
afterEach(() => { config.FEATURE_PXG_CARE_ACCESSORIES_ENABLED = false; });

test("PO must name exact active SKU; no fallback default for PXG retail", async () => {
  await expect(purchasing.createPo({ ...ctx, input: poInput({ product_id: "oil" }) })).rejects.toThrow(/exact SKU/);
  expect(stockRepo.defaultVariantForProduct).not.toHaveBeenCalled();
  expect(repo.addPoLine).not.toHaveBeenCalled();
  await purchasing.createPo({ ...ctx, input: poInput({ variant_id: "v100" }) });
  expect(repo.addPoLine).toHaveBeenCalledWith(expect.objectContaining({ line: expect.objectContaining({ variant_id: "v100" }) }));
});

test("FLH/flag-off cannot purchase or link PXG Care via forged variant IDs", async () => {
  await expect(purchasing.createPo({ ...ctx, brand: "faitlynhair", input: poInput({ variant_id: "v100" }) })).rejects.toThrow();
  config.FEATURE_PXG_CARE_ACCESSORIES_ENABLED = false;
  await expect(purchasing.createPo({ ...ctx, input: poInput({ variant_id: "v100" }) })).rejects.toThrow();
  expect(repo.addPoLine).not.toHaveBeenCalled();
});

test("a GRN cannot substitute a different option, omit its SKU or exceed outstanding quantity", async () => {
  const create = (line) => payables.createGrn({ ...ctx, input: { po_id: "po1", received_at_location_id: "loc1", lines: [line] } });
  await expect(create(grnLine({ variant_id: "v50" }))).rejects.toThrow(/SKU ordered/);
  await expect(create(grnLine({ variant_id: undefined }))).rejects.toThrow(/SKU ordered/);
  await expect(create(grnLine({ qty_received: 3 }))).rejects.toThrow(/outstanding/);
  await expect(create(grnLine({ unit_cost_ngn: undefined }))).rejects.toThrow(/positive operational cost/);
  expect(repo.createGrn).not.toHaveBeenCalled();
  await create(grnLine());
  expect(repo.addGrnLine).toHaveBeenCalledWith(expect.objectContaining({ line: expect.objectContaining({ variant_id: "v100", unit_cost_ngn: 500 }) }));
});

test("Cost Vault permission checked at both draft creation and posting, before any stock movement", async () => {
  vault.canSeeCost.mockResolvedValue(false);
  await expect(payables.createGrn({ ...ctx, input: { po_id: "po1", received_at_location_id: "loc1", lines: [grnLine()] } })).rejects.toThrow(/Cost Vault/);
  await expect(payables.postGrn({ ...ctx, id: "grn1" })).rejects.toThrow(/Cost Vault/);
  expect(stock.receiveStock).not.toHaveBeenCalled();
});

test("post rechecks exact SKU after draft; cannot post a forged pre-migration GRN", async () => {
  repo.getGrn.mockResolvedValue({ grn_id: "grn1", status: "draft", po_id: "po1", received_at_location_id: "loc1", lines: [grnLine({ variant_id: "v50" })] });
  await expect(payables.postGrn({ ...ctx, id: "grn1" })).rejects.toThrow(/SKU ordered/);
  expect(stock.receiveStock).not.toHaveBeenCalled();
});
