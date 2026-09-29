"use strict";

/**
 * When stock arrives, the pre-orders waiting on it get fulfilled — paid orders
 * drawn, unpaid ones reserved, paid-first then oldest-first, and never more than
 * the arriving pool. And it must be idempotent: coverage is re-derived from the
 * ledger, so a re-run (or the deploy sweep on top of the live path) never
 * double-draws.
 */

jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) => fn({ __fakeClient: true })),
  query: jest.fn(),
}));
jest.mock("../../../src/modules/sales/sales.repo", () => ({
  openPreorderLinesForVariant: jest.fn(),
  openPreorderLinesForProducts: jest.fn(),
  repointLineVariant: jest.fn(),
  resolvePreorderLines: jest.fn(),
  recomputeOrderPreorderState: jest.fn(),
  clearShortfallForVariant: jest.fn(),
}));
jest.mock("../../../src/modules/stock/stock.repo", () => ({
  getDefaultLocation: jest.fn(),
  lockLevel: jest.fn(),
  netSoldForOrder: jest.fn(),
  outstandingReservationForOrder: jest.fn(),
  productIdForVariant: jest.fn(),
}));
jest.mock("../../../src/modules/stock/stock.service", () => ({
  deductForSale: jest.fn(),
  reserveForOrder: jest.fn(),
}));
jest.mock("../../../src/modules/sales/sales.events", () => ({
  on: jest.fn(),
  emit: jest.fn(),
}));
jest.mock("../../../src/modules/catalogue/styled_variants.repo", () => ({
  getConfig: jest.fn(),
  listRewigSiblings: jest.fn(),
}));
jest.mock("../../../src/modules/catalogue/rewig.service", () => ({
  pickRewigDonorProductId: jest.fn(),
}));

const salesRepo = require("../../../src/modules/sales/sales.repo");
const stockRepo = require("../../../src/modules/stock/stock.repo");
const stockService = require("../../../src/modules/stock/stock.service");
const events = require("../../../src/modules/sales/sales.events");
const styledVariantsRepo = require("../../../src/modules/catalogue/styled_variants.repo");
const rewigService = require("../../../src/modules/catalogue/rewig.service");
const {
  allocateForVariant,
} = require("../../../src/modules/sales/preorder-allocation.service");

const BRAND = "pixiegirl";
const VARIANT = "variant-1";
const LOC = "loc-1";

function line(order_id, line_id, quantity, extra = {}) {
  return {
    line_id,
    order_id,
    variant_id: VARIANT,
    quantity,
    product_name_snapshot: "Lorato Bloom 22\"",
    unit_cost_ngn: "1000",
    sales_channel: "storefront",
    order_number: order_id,
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  stockRepo.netSoldForOrder.mockResolvedValue(0);
  stockRepo.outstandingReservationForOrder.mockResolvedValue(0);
  salesRepo.resolvePreorderLines.mockResolvedValue();
  salesRepo.clearShortfallForVariant.mockResolvedValue();
  salesRepo.recomputeOrderPreorderState.mockResolvedValue({
    is_preorder: false,
    just_fulfilled: true,
  });
  // Rewig adjacency off by default — most of this suite predates 000393 and
  // asserts on the primary (exact-variant) pass only. Its own describe block
  // below switches this on to exercise the overflow pass specifically.
  styledVariantsRepo.getConfig.mockResolvedValue({ rewig_enabled: false });
  styledVariantsRepo.listRewigSiblings.mockResolvedValue([]);
  salesRepo.openPreorderLinesForProducts.mockResolvedValue([]);
});

describe("allocateForVariant — draw paid, reserve unpaid, paid-first", () => {
  it("draws for the paid order first, then reserves the rest for the unpaid one", async () => {
    // 10 units arrive; paid order wants 6, unpaid wants 6.
    stockRepo.lockLevel.mockResolvedValue({
      on_hand: 10,
      reserved: 0,
      available: 10,
    });
    salesRepo.openPreorderLinesForVariant.mockResolvedValue([
      { ...line("A", "a1", 6), is_paid: true },
      { ...line("B", "b1", 6), is_paid: false },
    ]);
    salesRepo.recomputeOrderPreorderState
      .mockResolvedValueOnce({ is_preorder: false, just_fulfilled: true }) // A
      .mockResolvedValueOnce({ is_preorder: true, just_fulfilled: false }); // B

    const r = await allocateForVariant({
      brand: BRAND,
      variant_id: VARIANT,
      location_id: LOC,
    });

    // Paid order drawn in full (6), unpaid gets what's left (4) — held, not drawn.
    expect(stockService.deductForSale).toHaveBeenCalledTimes(1);
    expect(stockService.deductForSale).toHaveBeenCalledWith(
      expect.objectContaining({ reference_id: "A", quantity: 6 }),
    );
    expect(stockService.reserveForOrder).toHaveBeenCalledTimes(1);
    expect(stockService.reserveForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ reference_id: "B", quantity: 4 }),
    );
    expect(r.units_deducted).toBe(6);
    expect(r.units_reserved).toBe(4);

    // Paid line fully covered → flag cleared; unpaid line only partly → left.
    expect(salesRepo.resolvePreorderLines).toHaveBeenCalledWith(
      expect.objectContaining({ line_ids: ["a1"] }),
    );
    expect(salesRepo.resolvePreorderLines).not.toHaveBeenCalledWith(
      expect.objectContaining({ line_ids: ["b1"] }),
    );

    // Ops/sales notification fires for a real allocation.
    expect(events.emit).toHaveBeenCalledWith(
      "preorder.allocated",
      expect.objectContaining({ brand: BRAND, variant_id: VARIANT }),
    );
  });

  it("never draws a unit twice — a line already drawn is a clean no-op", async () => {
    // 5 available, but the paid order's 3 were already drawn (ledger says so).
    stockRepo.lockLevel.mockResolvedValue({
      on_hand: 5,
      reserved: 0,
      available: 5,
    });
    salesRepo.openPreorderLinesForVariant.mockResolvedValue([
      { ...line("A", "a1", 3), is_paid: true },
    ]);
    stockRepo.netSoldForOrder.mockResolvedValue(3);

    const r = await allocateForVariant({
      brand: BRAND,
      variant_id: VARIANT,
      location_id: LOC,
    });

    expect(stockService.deductForSale).not.toHaveBeenCalled();
    expect(stockService.reserveForOrder).not.toHaveBeenCalled();
    expect(r.units_deducted).toBe(0);
    expect(r.allocated).toBe(false);
    // …but the stale pre-order flag on a line that's really covered is cleared.
    expect(salesRepo.resolvePreorderLines).toHaveBeenCalledWith(
      expect.objectContaining({ line_ids: ["a1"] }),
    );
    // Nothing allocated → no ops storm.
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("respects an existing partial reservation and only tops it up", async () => {
    // Unpaid order wants 5, already holds 2; 10 available → reserve 3 more.
    stockRepo.lockLevel.mockResolvedValue({
      on_hand: 10,
      reserved: 2,
      available: 8,
    });
    salesRepo.openPreorderLinesForVariant.mockResolvedValue([
      { ...line("B", "b1", 5), is_paid: false },
    ]);
    stockRepo.outstandingReservationForOrder.mockResolvedValue(2);

    const r = await allocateForVariant({
      brand: BRAND,
      variant_id: VARIANT,
      location_id: LOC,
    });

    expect(stockService.reserveForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ reference_id: "B", quantity: 3 }),
    );
    expect(r.units_reserved).toBe(3);
  });

  it("does nothing when there is no arriving pool", async () => {
    stockRepo.lockLevel.mockResolvedValue({
      on_hand: 4,
      reserved: 4,
      available: 0,
    });
    salesRepo.openPreorderLinesForVariant.mockResolvedValue([
      { ...line("A", "a1", 1), is_paid: true },
    ]);

    const r = await allocateForVariant({
      brand: BRAND,
      variant_id: VARIANT,
      location_id: LOC,
    });

    expect(r.allocated).toBe(false);
    expect(stockService.deductForSale).not.toHaveBeenCalled();
    expect(salesRepo.openPreorderLinesForVariant).not.toHaveBeenCalled();
  });

  it("falls back to the default location and no-ops when there is none", async () => {
    stockRepo.getDefaultLocation.mockResolvedValue(null);

    const r = await allocateForVariant({ brand: BRAND, variant_id: VARIANT });

    expect(r.allocated).toBe(false);
    expect(stockRepo.lockLevel).not.toHaveBeenCalled();
  });

  it("ignores a call with no brand or variant", async () => {
    const r = await allocateForVariant({ brand: BRAND, variant_id: null });
    expect(r.allocated).toBe(false);
    expect(stockRepo.lockLevel).not.toHaveBeenCalled();
  });
});

/**
 * Rewig adjacency overflow (000393) — owner directive: "the new preorder
 * fulfilment engine... does not consider the rewig adjacency rule. Meaning if
 * a preorder is large and we add [stock of an adjacent size] it should still
 * deduct." Once THIS variant's own pre-orders are covered, whatever pool is
 * left should be offered to a size-adjacent sibling's waiting pre-order,
 * through the same shared donor decision every other rewig path uses.
 */
describe("allocateForVariant — rewig adjacency overflow", () => {
  const SIBLING_PRODUCT = "product-M";
  const ORIGIN_PRODUCT = "product-L";

  beforeEach(() => {
    // No demand of its own on the arriving variant — the whole pool is free
    // to spend on a sibling.
    salesRepo.openPreorderLinesForVariant.mockResolvedValue([]);
    stockRepo.productIdForVariant.mockResolvedValue(ORIGIN_PRODUCT);
    styledVariantsRepo.getConfig.mockResolvedValue({
      rewig_enabled: true,
      rewig_mode: "automatic",
      rewig_direction: "down_first",
    });
    styledVariantsRepo.listRewigSiblings.mockResolvedValue([
      { product_id: SIBLING_PRODUCT, name: "Sibling M", size_diff: -1, available: 0 },
    ]);
    rewigService.pickRewigDonorProductId.mockResolvedValue(ORIGIN_PRODUCT);
  });

  function siblingLine(order_id, line_id, quantity, extra = {}) {
    return {
      line_id,
      order_id,
      variant_id: "sibling-variant-1",
      product_id: SIBLING_PRODUCT,
      styled_id: null,
      quantity,
      product_name_snapshot: "Lorato Bloom 20\" (M)",
      unit_cost_ngn: "1000",
      sales_channel: "storefront",
      order_number: order_id,
      ordered_at: new Date().toISOString(),
      ...extra,
    };
  }

  it("fulfils a sibling's pre-order from stock that just arrived for a different size", async () => {
    stockRepo.lockLevel.mockResolvedValue({ on_hand: 10, reserved: 0, available: 10 });
    salesRepo.openPreorderLinesForProducts.mockResolvedValue([
      { ...siblingLine("C", "c1", 4), is_paid: true },
    ]);

    const r = await allocateForVariant({ brand: BRAND, variant_id: VARIANT, location_id: LOC });

    expect(salesRepo.openPreorderLinesForProducts).toHaveBeenCalledWith(
      expect.objectContaining({ product_ids: [SIBLING_PRODUCT] }),
    );
    // Drawn against the variant that actually arrived, not the sibling's own.
    expect(stockService.deductForSale).toHaveBeenCalledWith(
      expect.objectContaining({ variant_id: VARIANT, quantity: 4, reference_id: "C" }),
    );
    expect(salesRepo.repointLineVariant).toHaveBeenCalledWith(
      expect.objectContaining({ line_id: "c1", product_id: ORIGIN_PRODUCT, variant_id: VARIANT }),
    );
    expect(salesRepo.resolvePreorderLines).toHaveBeenCalledWith(
      expect.objectContaining({ line_ids: ["c1"] }),
    );
    expect(r.units_deducted).toBe(4);
    expect(r.allocated).toBe(true);
  });

  it("never splits a line — a sibling pre-order bigger than the leftover pool stays a pre-order", async () => {
    stockRepo.lockLevel.mockResolvedValue({ on_hand: 3, reserved: 0, available: 3 });
    salesRepo.openPreorderLinesForProducts.mockResolvedValue([
      { ...siblingLine("D", "d1", 4), is_paid: true },
    ]);

    const r = await allocateForVariant({ brand: BRAND, variant_id: VARIANT, location_id: LOC });

    expect(stockService.deductForSale).not.toHaveBeenCalled();
    expect(salesRepo.repointLineVariant).not.toHaveBeenCalled();
    expect(r.allocated).toBe(false);
  });

  it("leaves a line alone once it has already drawn against its own variant", async () => {
    stockRepo.lockLevel.mockResolvedValue({ on_hand: 10, reserved: 0, available: 10 });
    salesRepo.openPreorderLinesForProducts.mockResolvedValue([
      { ...siblingLine("E", "e1", 2), is_paid: true },
    ]);
    stockRepo.netSoldForOrder.mockImplementation(async ({ variant_id }) =>
      variant_id === "sibling-variant-1" ? 1 : 0,
    );

    const r = await allocateForVariant({ brand: BRAND, variant_id: VARIANT, location_id: LOC });

    expect(stockService.deductForSale).not.toHaveBeenCalled();
    expect(r.allocated).toBe(false);
  });

  it("respects the brand's rewig config — never substitutes when the shared decision says no", async () => {
    stockRepo.lockLevel.mockResolvedValue({ on_hand: 10, reserved: 0, available: 10 });
    salesRepo.openPreorderLinesForProducts.mockResolvedValue([
      { ...siblingLine("F", "f1", 2), is_paid: true },
    ]);
    // The shared decision picked a DIFFERENT donor (or none) — this arrival
    // is not it, so the line must be left exactly as it was.
    rewigService.pickRewigDonorProductId.mockResolvedValue(null);

    const r = await allocateForVariant({ brand: BRAND, variant_id: VARIANT, location_id: LOC });

    expect(stockService.deductForSale).not.toHaveBeenCalled();
    expect(salesRepo.repointLineVariant).not.toHaveBeenCalled();
    expect(r.allocated).toBe(false);
  });

  it("skips the whole pass when the brand has rewig switched off", async () => {
    styledVariantsRepo.getConfig.mockResolvedValue({ rewig_enabled: false });
    stockRepo.lockLevel.mockResolvedValue({ on_hand: 10, reserved: 0, available: 10 });

    const r = await allocateForVariant({ brand: BRAND, variant_id: VARIANT, location_id: LOC });

    expect(salesRepo.openPreorderLinesForProducts).not.toHaveBeenCalled();
    expect(r.allocated).toBe(false);
  });
});
