"use strict";

/**
 * Change Order × rewig adjacency (000088).
 *
 * The bug these tests exist for: an order was taken for size S, which was out
 * of stock, so it went in as a pre-order. The operator then changed the order
 * to size M — one size away from the L that was sitting on the shelf — expecting
 * the size-adjacency rule to fill it, exactly as the same swap would have at
 * the counter. It didn't. The amendment reconciler only ever tried the ordered
 * variant, so the change was written as ANOTHER pre-order even though the
 * sibling base was in stock.
 *
 * Two engines move stock for an order line, and they have to answer "what do we
 * do when the size she wants isn't on the shelf?" the same way:
 *
 *   • createOrder (sales.service) — tried the line, then an adjacent sibling,
 *     then pre-ordered;
 *   • amendOrder (amendment.service) — tried the line, then pre-ordered.
 *
 * These tests hold the amendment engine to the placement engine's chain, and to
 * the two consequences of it: the line is re-pointed at the unit actually taken
 * (so the picklist, payment-time deduction and a later cancellation all follow
 * the real SKU), and the made-to-order flag finally goes DOWN for a line the
 * change has put on the shelf.
 *
 * Hermetic: every repo/service the reconciler touches is mocked; the world is a
 * small in-memory stock ledger so reservations, releases and deductions behave
 * like the DB trigger would.
 */

jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) => fn(mockClient)),
  withSavepoint: jest.fn(async (_client, fn) => fn()),
  query: jest.fn(),
  ex: () => mockClient.query,
}));

jest.mock("../../../src/modules/business_setup/business-config.repo", () => ({
  findByKey: jest.fn(async () => ({ vat_rate: "0" })),
}));

jest.mock("../../../src/modules/sales/sales.repo", () => ({
  variantContexts: jest.fn(),
  serviceOfferingContext: jest.fn(async () => null),
  listDiscounts: jest.fn(async () => []),
  findById: jest.fn(),
  insertLine: jest.fn(),
  repointLineVariant: jest.fn(async () => ({})),
  getPreorderPolicy: jest.fn(async () => ({
    enabled: true,
    min_weeks: 4,
    max_weeks: 8,
  })),
  excludedPreorderProductIds: jest.fn(async () => new Set()),
  markOrderPreorder: jest.fn(async () => {}),
  markLinesPreorder: jest.fn(async () => {}),
  setLinesPreorder: jest.fn(async () => {}),
  setStatus: jest.fn(),
}));

jest.mock("../../../src/modules/sales/amendment.repo", () => ({
  lockOrder: jest.fn(async () => ({})),
  nextAmendmentNumber: jest.fn(async () => 1),
  updateLine: jest.fn(async () => ({})),
  setLineDiscountAmount: jest.fn(async () => {}),
  setDiscountAmount: jest.fn(async () => {}),
  listOrderLevelDiscounts: jest.fn(async () => []),
  deleteLines: jest.fn(async () => 1),
  setOrderTotals: jest.fn(async () => ({})),
  setDeliveryDetails: jest.fn(async () => ({})),
  setLinesPreorder: jest.fn(async () => {}),
  insertAmendment: jest.fn(async () => ({
    amendment_id: "amend-1",
    amendment_number: 1,
  })),
  bumpAmendmentCounters: jest.fn(async () => {}),
  refreshPreorderFlag: jest.fn(async () => false),
}));

jest.mock("../../../src/modules/stock/stock.service", () => ({
  reserveForOrder: jest.fn(),
  deductForSale: jest.fn(),
  releaseOrderReservation: jest.fn(),
  returnFromSale: jest.fn(),
  setServiceJobStatus: jest.fn(),
}));

jest.mock("../../../src/modules/stock/stock.repo", () => ({
  getDefaultLocation: jest.fn(async () => ({
    location_id: LOC,
    display_name: "Lekki shop",
  })),
  levelFor: jest.fn(),
  outstandingReservationForOrder: jest.fn(),
  netSoldForOrder: jest.fn(),
  variantWithStockForProduct: jest.fn(),
}));

jest.mock("../../../src/modules/catalogue/styled_variants.repo", () => ({
  getConfig: jest.fn(),
  listRewigSiblings: jest.fn(),
}));

jest.mock("../../../src/modules/sales/sales.events", () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));

jest.mock("../../../src/shared/outbox/outbox", () => ({ enqueue: jest.fn() }));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/sales/timeline.repo", () => ({
  insert: jest.fn(),
}));
jest.mock("../../../src/modules/invoicing/invoicing.service", () => ({
  resyncFromOrder: jest.fn(async () => null),
}));
jest.mock("../../../src/modules/logistics/logistics.repo", () => ({
  liveDeliveryForOrder: jest.fn(async () => null),
  replaceDeliveryItems: jest.fn(),
  setDeliveryAddress: jest.fn(),
}));
jest.mock("../../../src/modules/service_jobs/service-jobs.repo", () => ({
  jobsForLines: jest.fn(async () => []),
  setServiceJobStatus: jest.fn(),
}));
jest.mock("../../../src/modules/accounting/accounting.repo", () => ({
  findEntryBySource: jest.fn(async () => null),
}));
jest.mock("../../../src/modules/accounting/accounting.service", () => ({
  postEntry: jest.fn(async () => ({ entry_id: "je-1" })),
}));

const mockClient = { query: jest.fn() };

const repo = require("../../../src/modules/sales/sales.repo");
const amendRepo = require("../../../src/modules/sales/amendment.repo");
const stockService = require("../../../src/modules/stock/stock.service");
const stockRepo = require("../../../src/modules/stock/stock.repo");
const rewigRepo = require("../../../src/modules/catalogue/styled_variants.repo");
const accountingRepo = require("../../../src/modules/accounting/accounting.repo");
const service = require("../../../src/modules/sales/amendment.service");

const BRAND = "pixiegirl";
const LOC = "loc-1";
const STYLED = "styl-1";

// The three sizes of one styling job. Small is what she ordered; Medium is what
// the operator changes it to; Large is the sibling sitting in stock.
const PROD_S = "prod-S";
const PROD_M = "prod-M";
const PROD_L = "prod-L";
const VAR_S = "var-S";
const VAR_M = "var-M";
const VAR_L = "var-L";

const VARIANT_S = {
  variant_id: VAR_S,
  sku: "PXG-S",
  variant_name: "Bodywave · Small",
  product_id: PROD_S,
  product_name: "Nala Sleek Bangs — Small",
  price_storefront_ngn: "395000.00",
  price_pos_ngn: "395000.00",
  cost_price_ngn: "150000.00",
  min_price_ngn: "300000.00",
  taxable: false,
  product_vat: null,
  category_id: null,
};

const VARIANT_M = {
  variant_id: VAR_M,
  sku: "PXG-M",
  variant_name: "Bodywave · Medium",
  product_id: PROD_M,
  product_name: "Nala Sleek Bangs — Medium",
  price_storefront_ngn: "395000.00",
  price_pos_ngn: "395000.00",
  cost_price_ngn: "150000.00",
  min_price_ngn: "300000.00",
  taxable: false,
  product_vat: null,
  category_id: null,
};

/** The order as it was placed: one line, size S, back-ordered. */
function orderWithSThatPreordered(extra = {}) {
  return {
    order_id: "ord-1",
    order_number: "PXG-SO-0101",
    contact_id: "contact-1",
    sales_channel: "pos",
    order_type: "walk_in",
    status: "pending_payment",
    subtotal_ngn: "395000.00",
    discount_amount_ngn: "0.00",
    tax_amount_ngn: "0.00",
    shipping_fee_ngn: "0.00",
    total_ngn: "395000.00",
    amount_paid_ngn: "0.00",
    fully_paid_at: null,
    delivery_address_snapshot: null,
    lines: [
      {
        line_id: "line-S",
        product_id: PROD_S,
        variant_id: VAR_S,
        product_name_snapshot: "Nala Sleek Bangs",
        variant_label_snapshot: "Small",
        sku_snapshot: "PXG-S",
        quantity: 1,
        unit_price_ngn: "395000.00",
        unit_cost_ngn: "150000.00",
        line_discount_ngn: "0.00",
        tax_rate: "0.0000",
        tax_amount_ngn: "0.00",
        line_total_ngn: "395000.00",
        display_order: 0,
        line_kind: "styled",
        styled_id: STYLED,
        service_offering_id: null,
        notes: null,
        is_preorder: true,
      },
    ],
    ...extra,
  };
}

/** Swap the S line for the M one — exactly what the Change Order modal sends. */
const SWAP_TO_M = {
  lines: [
    {
      variant_id: VAR_M,
      quantity: 1,
      unit_price_ngn: 395000,
      product_name_snapshot: "Nala Sleek Bangs",
      variant_label_snapshot: "Medium",
      sku_snapshot: "PXG-M",
      styled_id: STYLED,
      line_kind: "styled",
    },
  ],
  order_type: "walk_in",
  reason: "She was sold the Small; the Medium is the size that fits",
  reason_category: "stock_substitution",
  acknowledge_warnings: true,
  notify_customer: false,
};

// ── The world ────────────────────────────────────────────────
// on_hand per variant (availability is on_hand − reserved, as the DB trigger
// maintains it), plus the movement ledger the reconciler reads back.
let onHand;
let held; // this order's own holds
let sold; // this order's own draws
let rewigCfg;
let rewigOverride;
let siblings;
let donorVariant;

function world({
  onHand: stock = { [VAR_S]: 0, [VAR_M]: 0, [VAR_L]: 3 },
  cfg = { rewig_enabled: true, rewig_mode: "automatic", rewig_direction: "down_first" },
  override = null,
  siblingList = [{ product_id: PROD_L, size_diff: 1, available: 3 }],
  donor = { variant_id: VAR_L, sku: "PXG-L", variant_name: "Large", available: 3 },
} = {}) {
  onHand = stock;
  held = {};
  sold = {};
  rewigCfg = cfg;
  rewigOverride = override;
  siblings = siblingList;
  donorVariant = donor;
}

const available = (variant_id) =>
  (onHand[variant_id] || 0) - (held[variant_id] || 0);

beforeEach(() => {
  jest.clearAllMocks();
  world();

  repo.findById.mockImplementation(async () => orderWithSThatPreordered());
  const catalogue = {
    [VAR_S]: VARIANT_S,
    [VAR_M]: VARIANT_M,
    // The sibling base, in case a later amendment reads the re-pointed row.
    [VAR_L]: { ...VARIANT_M, variant_id: VAR_L, sku: "PXG-L", product_id: PROD_L },
  };
  repo.variantContexts.mockImplementation(async ({ variant_ids }) => {
    const m = new Map();
    for (const id of variant_ids) if (catalogue[id]) m.set(id, { ...catalogue[id] });
    return m;
  });
  let inserted = 0;
  repo.insertLine.mockImplementation(async ({ line }) => ({
    ...line,
    line_id: `line-new-${++inserted}`,
  }));

  // The stock trigger, in miniature: a reserve/deduct only lands when the
  // units are genuinely there, and it moves the counters the reconciler reads.
  stockService.reserveForOrder.mockImplementation(async ({ variant_id, quantity }) => {
    if (available(variant_id) < quantity) {
      const err = new Error(`insufficient stock for ${variant_id}`);
      err.code = "INSUFFICIENT_STOCK";
      throw err;
    }
    held[variant_id] = (held[variant_id] || 0) + quantity;
    return {};
  });
  stockService.deductForSale.mockImplementation(async ({ variant_id, quantity }) => {
    if (available(variant_id) < quantity) {
      const err = new Error(`insufficient stock for ${variant_id}`);
      err.code = "INSUFFICIENT_STOCK";
      throw err;
    }
    sold[variant_id] = (sold[variant_id] || 0) + quantity;
    onHand[variant_id] -= quantity;
    return {};
  });
  stockService.releaseOrderReservation.mockImplementation(
    async ({ variant_id, quantity }) => {
      const give = Math.min(quantity, held[variant_id] || 0);
      held[variant_id] = (held[variant_id] || 0) - give;
      return give > 0;
    },
  );
  stockService.returnFromSale.mockImplementation(async ({ variant_id, quantity }) => {
    const give = Math.min(quantity, sold[variant_id] || 0);
    sold[variant_id] = (sold[variant_id] || 0) - give;
    onHand[variant_id] += give;
    return {};
  });

  stockRepo.levelFor.mockImplementation(async ({ variant_id }) => ({
    available: available(variant_id),
  }));
  stockRepo.outstandingReservationForOrder.mockImplementation(
    async ({ variant_id }) => held[variant_id] || 0,
  );
  stockRepo.netSoldForOrder.mockImplementation(
    async ({ variant_id }) => sold[variant_id] || 0,
  );
  stockRepo.variantWithStockForProduct.mockImplementation(
    async ({ product_id, quantity }) =>
      product_id === PROD_L && donorVariant && donorVariant.available >= quantity
        ? { ...donorVariant }
        : null,
  );

  rewigRepo.getConfig.mockImplementation(async () => rewigCfg);
  rewigRepo.listRewigSiblings.mockImplementation(async () => siblings);
  accountingRepo.findEntryBySource.mockResolvedValue(null);

  mockClient.query.mockImplementation(async (sql, params) => {
    // rewig.service: the listing's own override…
    if (/rewig_override/.test(sql)) return { rows: [{ rewig_override: rewigOverride }] };
    // …the donor's display name…
    if (/SELECT name FROM/.test(sql)) {
      return { rows: [{ name: "Nala Sleek Bangs — Large" }] };
    }
    // …and the origin base's own sellable stock (that is what makes the line
    // "short" in the first place).
    if (/SUM\(sl\.available\)/.test(sql)) {
      const product_id = params[0];
      const variantFor = { [PROD_S]: VAR_S, [PROD_M]: VAR_M, [PROD_L]: VAR_L };
      return { rows: [{ available: available(variantFor[product_id] || "") }] };
    }
    return { rows: [] };
  });
});

const amend = (input = SWAP_TO_M) =>
  service.amendOrder({
    brand: BRAND,
    user: { user_id: "user-1", display_name: "Ada" },
    request_id: "req-1",
    id: "ord-1",
    input,
  });

const preview = (input = SWAP_TO_M) =>
  service.previewAmendment({ brand: BRAND, id: "ord-1", input });

const reservedVariants = () =>
  stockService.reserveForOrder.mock.calls.map((c) => c[0].variant_id);

// ── The reported bug ─────────────────────────────────────────

describe("a change that swaps an out-of-stock size for one an adjacent base can fill", () => {
  test("the preview says 'resized from the adjacent size', not 'pre-order'", async () => {
    const plan = await preview();

    const codes = plan.warnings.map((w) => w.code);
    expect(codes).toContain("REWIG_SUBSTITUTION");
    expect(codes).not.toContain("STOCK_SHORT");

    const warning = plan.warnings.find((w) => w.code === "REWIG_SUBSTITUTION");
    expect(warning.message).toContain("Nala Sleek Bangs — Medium");
    expect(warning.message).toContain("PXG-L");
    expect(warning.details[0]).toMatchObject({
      sku: "PXG-L",
      product_name: "Nala Sleek Bangs — Large",
      quantity: 1,
    });
  });

  test("the commit takes the units from the sibling base", async () => {
    const res = await amend();

    // Ordered variant first, then the one size away — the placement chain.
    expect(reservedVariants()).toEqual([VAR_M, VAR_L]);
    expect(res.stock.substituted).toHaveLength(1);
    expect(res.stock.substituted[0]).toMatchObject({
      variant_id: VAR_L,
      ordered_variant_id: VAR_M,
      sku: "PXG-L",
      quantity: 1,
    });
    // The units are held; nothing was sent to production.
    expect(res.stock.preorder).toEqual([]);
    expect(held[VAR_L]).toBe(1);
  });

  test("the line is re-pointed at the unit actually taken, with the resize note", async () => {
    await amend();

    expect(repo.repointLineVariant).toHaveBeenCalledTimes(1);
    const arg = repo.repointLineVariant.mock.calls[0][0];
    expect(arg.line_id).toBe("line-new-1");
    expect(arg.product_id).toBe(PROD_L);
    expect(arg.variant_id).toBe(VAR_L);
    // The note is what the Studio reads to know a unit needs resizing — and it
    // must name the size the CUSTOMER ordered, not the one on the shelf.
    expect(arg.note).toContain("PXG-L");
    expect(arg.note).toContain("resize to Medium");
    // The snapshot the customer sees is untouched by the substitution.
    const inserted = repo.insertLine.mock.calls[0][0].line;
    expect(inserted.variant_label_snapshot).toBe("Medium");
  });

  test("the new line is not flagged as a pre-order", async () => {
    await amend();

    const flags = amendRepo.setLinesPreorder.mock.calls;
    const raised = flags.filter((c) => c[0].is_preorder === true);
    expect(raised).toEqual([]);
    expect(amendRepo.refreshPreorderFlag).toHaveBeenCalled();
  });
});

// ── The gates that must still hold ───────────────────────────

describe("the gates the placement engine honours are honoured here too", () => {
  test("no eligible sibling — the line pre-orders, as it always did", async () => {
    world({ siblingList: [] });

    await amend();

    expect(reservedVariants()).toEqual([VAR_M]);
    const raised = amendRepo.setLinesPreorder.mock.calls.filter(
      (c) => c[0].is_preorder === true,
    );
    expect(raised).toHaveLength(1);
    expect(raised[0][0].line_ids).toEqual(["line-new-1"]);
  });

  test("the brand's rewig master switch is off — no substitution", async () => {
    world({ cfg: { rewig_enabled: false, rewig_mode: "automatic" } });

    await amend();

    expect(reservedVariants()).toEqual([VAR_M]);
    expect(repo.repointLineVariant).not.toHaveBeenCalled();
    expect(
      amendRepo.setLinesPreorder.mock.calls.some(
        (c) => c[0].is_preorder === true,
      ),
    ).toBe(true);
  });

  test("the listing opted out — no substitution, even with the brand mode on", async () => {
    world({ override: "disabled" });

    await amend();

    expect(reservedVariants()).toEqual([VAR_M]);
    expect(repo.repointLineVariant).not.toHaveBeenCalled();
  });

  test("the order already holds units of the ordered size — no partial repoint", async () => {
    // She has one Medium in hand; the change asks for a second and the shelf is
    // empty. Half the line sits on the ordered SKU and half would come from the
    // sibling, and one line cannot honestly name two SKUs — so the extra unit
    // is left to production instead of repointing the whole line.
    const order = orderWithSThatPreordered();
    order.lines[0] = {
      ...order.lines[0],
      variant_id: VAR_M,
      product_id: PROD_M,
      quantity: 1,
      is_preorder: false,
    };
    repo.findById.mockImplementation(async () => order);
    world({ onHand: { [VAR_M]: 1, [VAR_L]: 2 } });
    held[VAR_M] = 1; // the unit the order already holds for her

    await amend({
      lines: [{ line_id: "line-S", quantity: 2, unit_price_ngn: 395000 }],
      reason: "She wants a second one",
      reason_category: "customer_change",
      acknowledge_warnings: true,
    });

    expect(reservedVariants()).toEqual([VAR_M]);
    expect(repo.repointLineVariant).not.toHaveBeenCalled();
    // Partly held is still made-to-order, and the flag says so.
    const raised = amendRepo.setLinesPreorder.mock.calls.filter(
      (c) => c[0].is_preorder === true,
    );
    expect(raised).toHaveLength(1);
    expect(raised[0][0].line_ids).toEqual(["line-S"]);
  });
});

// ── The other half: pre-order → in stock ─────────────────────

describe("a line the change puts on the shelf stops being made to order", () => {
  test("a kept pre-order line is re-flagged once the units are really held", async () => {
    // She was back-ordered on Medium, holding nothing. The shelf has been
    // restocked and the operator changes the quantity — the amendment must
    // hold what the line promises and drop the made-to-order flag.
    const order = orderWithSThatPreordered();
    order.lines[0] = {
      ...order.lines[0],
      variant_id: VAR_M,
      product_id: PROD_M,
      variant_label_snapshot: "Medium",
      sku_snapshot: "PXG-M",
      quantity: 1,
      is_preorder: true,
    };
    repo.findById.mockImplementation(async () => order);
    world({ onHand: { [VAR_M]: 2, [VAR_L]: 0 } });

    const res = await amend({
      lines: [{ line_id: "line-S", quantity: 2, unit_price_ngn: 395000 }],
      reason: "She wants two now that the Medium is back in stock",
      reason_category: "customer_change",
      acknowledge_warnings: true,
    });

    // +1 for the change, +1 to cover the unit she was never actually holding.
    expect(reservedVariants()).toEqual([VAR_M, VAR_M]);
    expect(held[VAR_M]).toBe(2);
    expect(res.stock.preorder).toEqual([]);
    expect(res.stock.preorder_cleared).toEqual(["line-S"]);

    const cleared = amendRepo.setLinesPreorder.mock.calls.filter(
      (c) => c[0].is_preorder === false,
    );
    expect(cleared).toHaveLength(1);
    expect(cleared[0][0].line_ids).toEqual(["line-S"]);
  });

  test("a line that is still short stays a pre-order", async () => {
    // Back-ordered on Medium, and only one Medium has arrived for the three she
    // now wants: the flag does not come off on hope — and the reconciler does
    // not half-promise by holding the odd unit out of a delta it can't fill.
    const order = orderWithSThatPreordered();
    order.lines[0] = { ...order.lines[0], variant_id: VAR_M, product_id: PROD_M };
    repo.findById.mockImplementation(async () => order);
    world({ onHand: { [VAR_M]: 1, [VAR_L]: 0 }, siblingList: [] });

    const res = await amend({
      lines: [{ line_id: "line-S", quantity: 3, unit_price_ngn: 395000 }],
      reason: "She wants three",
      reason_category: "customer_change",
      acknowledge_warnings: true,
    });

    expect(reservedVariants()).toEqual([VAR_M]);
    expect(res.stock.reserved).toEqual([]);
    expect(res.stock.preorder).toHaveLength(1);
    expect(res.stock.preorder[0].variant_id).toBe(VAR_M);
    expect(
      amendRepo.setLinesPreorder.mock.calls.filter(
        (c) => c[0].is_preorder === false,
      ),
    ).toEqual([]);
  });

  test("a change that never touches the item reserves nothing", async () => {
    // The order is still back-ordered on its own size and the operator only
    // fixes the delivery fee. A pre-order line is not silently put on hold
    // because someone corrected a courier charge.
    const res = await amend({
      lines: [{ line_id: "line-S", quantity: 1, unit_price_ngn: 395000 }],
      shipping_fee_ngn: 3000,
      reason: "Delivery fee was under-recorded",
      reason_category: "delivery_change",
      acknowledge_warnings: true,
    });

    expect(stockService.reserveForOrder).not.toHaveBeenCalled();
    expect(amendRepo.setLinesPreorder).not.toHaveBeenCalled();
    expect(res.stock.preorder).toEqual([]);
  });
});

// ── The recognised world ─────────────────────────────────────

describe("on an already-paid order the units have left, so they are deducted", () => {
  test("the deduction follows the adjacent base and the line follows it too", async () => {
    accountingRepo.findEntryBySource.mockResolvedValue({ entry_id: "je-sale" });
    repo.findById.mockImplementation(async () =>
      orderWithSThatPreordered({
        status: "paid",
        amount_paid_ngn: "395000.00",
        fully_paid_at: "2026-09-01T10:00:00Z",
      }),
    );

    const res = await amend();

    expect(
      stockService.deductForSale.mock.calls.map((c) => c[0].variant_id),
    ).toEqual([VAR_M, VAR_L]);
    expect(stockService.reserveForOrder).not.toHaveBeenCalled();
    expect(res.stock.substituted[0].sku).toBe("PXG-L");
    expect(repo.repointLineVariant).toHaveBeenCalledTimes(1);
  });
});

// ── After the substitution, the ledger and the line agree ────

describe("a line already fulfilled from a sibling base stays coherent", () => {
  /** The order as the FIRST amendment left it: the row points at the Large. */
  const donorPointedOrder = () => {
    const order = orderWithSThatPreordered();
    order.lines = [
      {
        ...order.lines[0],
        variant_id: VAR_L,
        product_id: PROD_L,
        variant_label_snapshot: "Medium",
        sku_snapshot: "PXG-M",
        quantity: 1,
        is_preorder: false,
        notes:
          "Rewig substitution: fulfil from Nala Sleek Bangs — Large (PXG-L) — resize to Medium.",
      },
    ];
    return order;
  };

  test("the next change moves the sibling variant, not the ordered one", async () => {
    // The customer asked for Medium; the row (and the unit in her parcel) is the
    // Large. A second amendment reads that row, so its delta must land on the
    // Large — and must not try to substitute again on top of a substitution.
    repo.findById.mockImplementation(async () => donorPointedOrder());
    world({ onHand: { [VAR_L]: 2 } });
    held[VAR_L] = 1; // the unit the first substitution reserved

    const res = await amend({
      lines: [{ line_id: "line-S", quantity: 2, unit_price_ngn: 395000 }],
      reason: "She wants a second one",
      reason_category: "customer_change",
      acknowledge_warnings: true,
    });

    expect(reservedVariants()).toEqual([VAR_L]);
    expect(repo.repointLineVariant).not.toHaveBeenCalled();
    expect(res.stock.substituted).toEqual([]);
    expect(held[VAR_L]).toBe(2);
  });

  test("taking the line off gives the sibling unit back, not the ordered one", async () => {
    // Two lines: the substituted one and an ordinary one that stays. Removing
    // the substituted line releases the Large — the SKU the order really holds —
    // so the shelf and the ledger never drift.
    const order = donorPointedOrder();
    order.lines.push({
      ...order.lines[0],
      line_id: "line-2",
      variant_id: VAR_S,
      product_id: PROD_S,
      variant_label_snapshot: "Small",
      sku_snapshot: "PXG-S",
      notes: null,
    });
    repo.findById.mockImplementation(async () => order);
    world({ onHand: { [VAR_L]: 1, [VAR_S]: 1 } });
    held[VAR_L] = 1;
    held[VAR_S] = 1;

    const res = await amend({
      lines: [{ line_id: "line-2", quantity: 1, unit_price_ngn: 395000 }],
      reason: "She is keeping only the Small",
      reason_category: "customer_change",
      acknowledge_warnings: true,
    });

    expect(
      stockService.releaseOrderReservation.mock.calls.map((c) => c[0].variant_id),
    ).toEqual([VAR_L]);
    expect(held[VAR_L]).toBe(0);
    expect(res.stock.released).toEqual([{ variant_id: VAR_L, quantity: 1 }]);
  });
});
