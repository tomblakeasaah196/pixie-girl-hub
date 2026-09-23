"use strict";

jest.mock("../../../src/config/database", () => ({ transaction: jest.fn(), query: jest.fn(), ex: jest.fn() }));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/intercompany/intercompany.repo", () => ({ findById: jest.fn(), create: jest.fn(), setStatus: jest.fn() }));
jest.mock("../../../src/modules/intercompany/intercompany.events", () => ({ emit: jest.fn() }));
jest.mock("../../../src/modules/stock/stock.repo", () => ({ variantForIntake: jest.fn() }));
jest.mock("../../../src/modules/stock/stock.service", () => ({ receiveStock: jest.fn(), deductForSale: jest.fn() }));
jest.mock("../../../src/modules/invoicing/invoicing.repo", () => ({ findById: jest.fn() }));
jest.mock("../../../src/modules/accounting/accounting.service", () => ({ postEntry: jest.fn() }));
jest.mock("../../../src/modules/catalogue/cost_vault.repo", () => ({ getVault: jest.fn() }));
jest.mock("../../../src/modules/pricing/pricing.service", () => ({ marginPct: jest.fn() }));
jest.mock("../../../src/workflows/engine", () => ({ findOpenInstance: jest.fn() }));
const repo = require("../../../src/modules/intercompany/intercompany.repo");
const stockRepo = require("../../../src/modules/stock/stock.repo");
const stock = require("../../../src/modules/stock/stock.service");
const accounting = require("../../../src/modules/accounting/accounting.service");
const invoice = require("../../../src/modules/invoicing/invoicing.repo");
const service = require("../../../src/modules/intercompany/intercompany.service");
const user = { user_id: "u1" };
const ref = { flow_type: "wholesale", seller_brand: "pixiegirl", buyer_brand: "faitlynhair",
  reference_type: "product_variant", reference_id: "care-variant-uuid" };

beforeEach(() => {
  stockRepo.variantForIntake.mockImplementation(async ({ brand }) =>
    brand === "pixiegirl" ? { catalogue_role: "retail" } : null);
  invoice.findById.mockResolvedValue(null);
});

test("a Care wholesale trade is rejected before invoice, workflow, GL or stock work", async () => {
  await expect(service.recordTransaction({ user, request_id: "req", input: { ...ref,
    seller_doc_id: "invoice-uuid", amount: 1000, min_margin_floor_pct: 0,
  } })).rejects.toMatchObject({ code: "CARE_SALES_DISABLED" });
  expect(invoice.findById).not.toHaveBeenCalled();
  expect(repo.create).not.toHaveBeenCalled();
  expect(accounting.postEntry).not.toHaveBeenCalled();
});

test("old or forged pending Care trades cannot be approved before the sale ledger rejects them", async () => {
  repo.findById.mockResolvedValue({ ...ref, status: "pending_approval" });
  await expect(service.approveTransaction({ user, id: "ic1" })).rejects.toMatchObject({ code: "CARE_SALES_DISABLED" });
  expect(accounting.postEntry).not.toHaveBeenCalled();
  expect(stock.deductForSale).not.toHaveBeenCalled();
});

test("a forged pending Care trade cannot restock PXG through a buyer match", async () => {
  repo.findById.mockResolvedValue({ ...ref, seller_brand: "faitlynhair", buyer_brand: "pixiegirl", status: "pending_buyer" });
  await expect(service.matchTransaction({ user, id: "ic1" })).rejects.toMatchObject({ code: "CARE_SALES_DISABLED" });
  expect(repo.setStatus).not.toHaveBeenCalled();
  expect(stock.receiveStock).not.toHaveBeenCalled();
});

test("non-Care wig variant remains on the ordinary intercompany path", async () => {
  stockRepo.variantForIntake.mockResolvedValue({ catalogue_role: "base" });
  await expect(service.recordTransaction({ user, input: { ...ref, seller_doc_id: "missing", amount: 1000, min_margin_floor_pct: 0 } })).rejects.toMatchObject({ code: "SELLER_DOC_NOT_FOUND" });
  expect(invoice.findById).toHaveBeenCalled();
});
