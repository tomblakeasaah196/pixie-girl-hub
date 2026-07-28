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

const { query } = require("../../../src/config/database");
const repo = require("../../../src/modules/catalogue/styled_variants.repo");
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
