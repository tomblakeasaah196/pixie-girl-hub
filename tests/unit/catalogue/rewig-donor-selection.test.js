"use strict";

/**
 * Unit tests for the rewig adjacency decision (000088) —
 * `rewig.service.pickRewigDonorProductId`.
 *
 * These cover the gate logic (master switch, brand mode, per-listing override)
 * and, critically, that the stock questions it asks are scoped to the ONE
 * location a sale reserves against. Availability reads sum every location; the
 * reserve only ever touches `stockRepo.getDefaultLocation`. When the donor
 * decision used the unscoped sum it could name a sibling whose units live
 * somewhere the reserve cannot reach, and the line pre-ordered anyway — the
 * exact failure this feature exists to prevent.
 *
 * Hermetic: the DB `query` fn and the styled-variants repo are mocked.
 */

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
}));
jest.mock("../../../src/modules/catalogue/styled_variants.repo", () => ({
  getConfig: jest.fn(),
  listRewigSiblings: jest.fn(),
}));
jest.mock("../../../src/modules/stock/stock.repo", () => ({
  variantWithStockForProduct: jest.fn(),
}));

const { query } = require("../../../src/config/database");
const repo = require("../../../src/modules/catalogue/styled_variants.repo");
const stockRepo = require("../../../src/modules/stock/stock.repo");
const rewig = require("../../../src/modules/catalogue/rewig.service");

const BRAND = "faitlynhair";
const ORIGIN = "d4ffef9e-db58-4c48-9e5e-775ad62b8091"; // Medium base
const SIB_LARGE = "6dce0a12-1bf4-4e58-9c85-b414c95fc7b7";
const SIB_SMALL = "806b79f0-26bb-4b3c-b211-27604d369e1b";
const LOC = "c384dbdc-65e5-4168-b219-f54241d7cb8a";

const CFG_ON = {
  rewig_enabled: true,
  rewig_mode: "automatic",
  rewig_direction: "down_first",
};

/** Origin has `available` units; siblings are returned as given. */
function fixture({ ownAvailable, siblings, cfg = CFG_ON }) {
  repo.getConfig.mockResolvedValue(cfg);
  query.mockResolvedValue({ rows: [{ available: ownAvailable }] });
  repo.listRewigSiblings.mockResolvedValue(siblings);
}

beforeEach(() => jest.clearAllMocks());

describe("pickRewigDonorProductId — gating", () => {
  test("returns null when the brand master switch is off", async () => {
    fixture({
      ownAvailable: 0,
      siblings: [{ product_id: SIB_LARGE, size_diff: 1, available: 7 }],
      cfg: { ...CFG_ON, rewig_enabled: false },
    });
    await expect(
      rewig.pickRewigDonorProductId({
        brand: BRAND,
        originProductId: ORIGIN,
        quantity: 1,
      }),
    ).resolves.toBeNull();
    expect(repo.listRewigSiblings).not.toHaveBeenCalled();
  });

  test("a listing set to 'disabled' beats the brand's automatic mode", async () => {
    fixture({
      ownAvailable: 0,
      siblings: [{ product_id: SIB_LARGE, size_diff: 1, available: 7 }],
    });
    await expect(
      rewig.pickRewigDonorProductId({
        brand: BRAND,
        styled: { rewig_override: "disabled" },
        originProductId: ORIGIN,
        quantity: 1,
      }),
    ).resolves.toBeNull();
  });

  test("a listing set to 'enabled' beats the brand's opt_in mode", async () => {
    fixture({
      ownAvailable: 0,
      siblings: [{ product_id: SIB_LARGE, size_diff: 1, available: 7 }],
      cfg: { ...CFG_ON, rewig_mode: "opt_in" },
    });
    await expect(
      rewig.pickRewigDonorProductId({
        brand: BRAND,
        styled: { rewig_override: "enabled" },
        originProductId: ORIGIN,
        quantity: 1,
      }),
    ).resolves.toBe(SIB_LARGE);
  });

  test("null override follows the brand mode (automatic → on)", async () => {
    fixture({
      ownAvailable: 0,
      siblings: [{ product_id: SIB_LARGE, size_diff: 1, available: 7 }],
    });
    await expect(
      rewig.pickRewigDonorProductId({
        brand: BRAND,
        styled: { rewig_override: null },
        originProductId: ORIGIN,
        quantity: 1,
      }),
    ).resolves.toBe(SIB_LARGE);
  });

  test("no substitution while the origin's own stock covers the order", async () => {
    fixture({
      ownAvailable: 5,
      siblings: [{ product_id: SIB_LARGE, size_diff: 1, available: 7 }],
    });
    await expect(
      rewig.pickRewigDonorProductId({
        brand: BRAND,
        originProductId: ORIGIN,
        quantity: 2,
      }),
    ).resolves.toBeNull();
    expect(repo.listRewigSiblings).not.toHaveBeenCalled();
  });

  test("a sibling that cannot cover the full quantity is not chosen", async () => {
    fixture({
      ownAvailable: 0,
      siblings: [{ product_id: SIB_SMALL, size_diff: -1, available: 2 }],
    });
    await expect(
      rewig.pickRewigDonorProductId({
        brand: BRAND,
        originProductId: ORIGIN,
        quantity: 3,
      }),
    ).resolves.toBeNull();
  });
});

describe("pickRewigDonorProductId — direction preference", () => {
  const both = [
    { product_id: SIB_LARGE, size_diff: 1, available: 7 },
    { product_id: SIB_SMALL, size_diff: -1, available: 2 },
  ];

  test("down_first prefers the smaller size", async () => {
    fixture({ ownAvailable: 0, siblings: both });
    await expect(
      rewig.pickRewigDonorProductId({
        brand: BRAND,
        originProductId: ORIGIN,
        quantity: 1,
      }),
    ).resolves.toBe(SIB_SMALL);
  });

  test("up_first prefers the larger size", async () => {
    fixture({
      ownAvailable: 0,
      siblings: both,
      cfg: { ...CFG_ON, rewig_direction: "up_first" },
    });
    await expect(
      rewig.pickRewigDonorProductId({
        brand: BRAND,
        originProductId: ORIGIN,
        quantity: 1,
      }),
    ).resolves.toBe(SIB_LARGE);
  });

  test("no_preference takes whichever sibling holds the most stock", async () => {
    fixture({
      ownAvailable: 0,
      siblings: both,
      cfg: { ...CFG_ON, rewig_direction: "no_preference" },
    });
    await expect(
      rewig.pickRewigDonorProductId({
        brand: BRAND,
        originProductId: ORIGIN,
        quantity: 1,
      }),
    ).resolves.toBe(SIB_LARGE);
  });
});

describe("pickRewigDonorProductId — location scoping", () => {
  test("threads location_id into BOTH stock questions it asks", async () => {
    fixture({
      ownAvailable: 0,
      siblings: [{ product_id: SIB_LARGE, size_diff: 1, available: 7 }],
    });
    await rewig.pickRewigDonorProductId({
      brand: BRAND,
      originProductId: ORIGIN,
      quantity: 1,
      location_id: LOC,
    });
    // Own-stock check is location-scoped...
    expect(query).toHaveBeenCalledWith(expect.any(String), [ORIGIN, LOC]);
    // ...and so is the sibling lookup. Summing every location here would name a
    // donor the reserve cannot reach.
    expect(repo.listRewigSiblings).toHaveBeenCalledWith(
      expect.objectContaining({ base_product_id: ORIGIN, location_id: LOC }),
    );
  });

  test("runs on the caller's transaction when a client is supplied", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ available: 0 }] }) };
    fixture({
      ownAvailable: 0,
      siblings: [{ product_id: SIB_LARGE, size_diff: 1, available: 7 }],
    });
    await rewig.pickRewigDonorProductId({
      client,
      brand: BRAND,
      originProductId: ORIGIN,
      quantity: 1,
      location_id: LOC,
    });
    // The own-stock read must see reservations already taken by earlier lines
    // of this same order, so it goes through the transaction, not the pool.
    expect(client.query).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(repo.getConfig).toHaveBeenCalledWith(
      expect.objectContaining({ client }),
    );
  });

  test("omitting location_id still works (display-only reads)", async () => {
    fixture({
      ownAvailable: 0,
      siblings: [{ product_id: SIB_LARGE, size_diff: 1, available: 7 }],
    });
    await expect(
      rewig.pickRewigDonorProductId({
        brand: BRAND,
        originProductId: ORIGIN,
        quantity: 1,
      }),
    ).resolves.toBe(SIB_LARGE);
    expect(query).toHaveBeenCalledWith(expect.any(String), [ORIGIN, null]);
  });
});

// ── resolveDonorVariant: product AND the concrete variant ────
//
// The donor decision above answers "which sibling base, if any". Both engines
// that move stock for an order line — placement (sales.service) and the Change
// Order reconciler (amendment.service) — then need the variant that actually
// holds the units, and that lookup has to be scoped to the SAME location the
// decision was. This wrapper is the one both call, so a Change Order can never
// substitute on looser terms than the sale that created the order.

describe("resolveDonorVariant", () => {
  const ORIGIN_VARIANT = "var-origin";
  const LINE = { product_id: ORIGIN, variant_id: ORIGIN_VARIANT, styled_id: null };

  const donorVariant = (extra = {}) => ({
    variant_id: "var-large",
    sku: "PXG-STY-001-L",
    variant_name: "Large",
    available: 7,
    ...extra,
  });

  test("returns the donor product, its variant and the display name", async () => {
    fixture({
      ownAvailable: 0,
      siblings: [{ product_id: SIB_LARGE, size_diff: 1, available: 7 }],
    });
    stockRepo.variantWithStockForProduct.mockResolvedValue(donorVariant());
    query.mockResolvedValueOnce({ rows: [{ available: 0 }] }); // own stock
    query.mockResolvedValueOnce({ rows: [{ name: "Nala — Large" }] }); // donor name

    await expect(
      rewig.resolveDonorVariant({
        brand: BRAND,
        line: LINE,
        quantity: 1,
        location_id: LOC,
      }),
    ).resolves.toEqual({
      product_id: SIB_LARGE,
      product_name: "Nala — Large",
      variant_id: "var-large",
      sku: "PXG-STY-001-L",
      available: 7,
      origin_variant_id: ORIGIN_VARIANT,
    });
  });

  test("asks for the variant at the SAME location the decision was scoped to", async () => {
    fixture({
      ownAvailable: 0,
      siblings: [{ product_id: SIB_LARGE, size_diff: 1, available: 7 }],
    });
    stockRepo.variantWithStockForProduct.mockResolvedValue(donorVariant());

    await rewig.resolveDonorVariant({
      brand: BRAND,
      line: LINE,
      quantity: 2,
      location_id: LOC,
    });

    expect(stockRepo.variantWithStockForProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: SIB_LARGE,
        location_id: LOC,
        quantity: 2,
      }),
    );
  });

  test("null when the sibling product has no single variant with enough units", async () => {
    fixture({
      ownAvailable: 0,
      siblings: [{ product_id: SIB_LARGE, size_diff: 1, available: 7 }],
    });
    // The sibling base looks stocked in aggregate but its active variants don't
    // add up to the order — the reserve would fail, so there is no donor.
    stockRepo.variantWithStockForProduct.mockResolvedValue(null);

    await expect(
      rewig.resolveDonorVariant({
        brand: BRAND,
        line: LINE,
        quantity: 3,
        location_id: LOC,
      }),
    ).resolves.toBeNull();
  });

  test("reads the listing's own override before deciding", async () => {
    fixture({
      ownAvailable: 0,
      siblings: [{ product_id: SIB_LARGE, size_diff: 1, available: 7 }],
    });
    // styled_id is present → the listing's override row is fetched, and a
    // disabled listing stops it there.
    query.mockResolvedValueOnce({ rows: [{ rewig_override: "disabled" }] });

    await expect(
      rewig.resolveDonorVariant({
        brand: BRAND,
        line: { ...LINE, styled_id: "styl-1" },
        quantity: 1,
        location_id: LOC,
      }),
    ).resolves.toBeNull();
    expect(repo.listRewigSiblings).not.toHaveBeenCalled();
  });

  test("returns null rather than throwing when the lookup itself fails", async () => {
    fixture({
      ownAvailable: 0,
      siblings: [{ product_id: SIB_LARGE, size_diff: 1, available: 7 }],
    });
    repo.getConfig.mockRejectedValue(new Error("connection reset"));

    // A donor lookup must never cost an order: the caller falls through to the
    // pre-order path it would have taken without adjacency at all.
    await expect(
      rewig.resolveDonorVariant({
        brand: BRAND,
        line: LINE,
        quantity: 1,
        location_id: LOC,
      }),
    ).resolves.toBeNull();
  });

  test("no location, no substitution — the reserve has to be able to reach the units", async () => {
    fixture({
      ownAvailable: 0,
      siblings: [{ product_id: SIB_LARGE, size_diff: 1, available: 7 }],
    });
    await expect(
      rewig.resolveDonorVariant({
        brand: BRAND,
        line: LINE,
        quantity: 1,
        location_id: null,
      }),
    ).resolves.toBeNull();
    expect(repo.getConfig).not.toHaveBeenCalled();
  });
});
