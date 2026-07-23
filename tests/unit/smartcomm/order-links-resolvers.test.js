"use strict";

/**
 * Unit tests for the shared-catalogue order-link ITEM RESOLVER — specifically
 * `resolveBundleItem`, which turns a bundle_id on an order-link row into
 * sellable base-variant lines. The root cause of "The Baddie" (and every
 * other bundle made of styled products) rendering "Unavailable right now"
 * on the /o/<slug> checkout was this resolver's bundle branch handling
 * `variant_id` + `product_id` on a component but silently dropping
 * `styled_id` — the ONLY reference the styled sub-components carry.
 *
 * Hermetic: the DB `query` function, `bundle.service.getBundle` and
 * `styled.repo.getById` are mocked, so we assert only the resolver's
 * branching logic.
 */

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
}));
jest.mock("../../../src/modules/retention/bundle.service", () => ({
  getBundle: jest.fn(),
}));
jest.mock("../../../src/modules/catalogue/styled.repo", () => ({
  getById: jest.fn(),
}));
// Rewig adjacency (000088) is a separate concern from bundle/styled item
// resolution — stub it to "no substitution" so these tests aren't coupled to
// its own DB queries (catalogue_config / sibling lookups), unfixtured here.
jest.mock("../../../src/modules/catalogue/rewig.service", () => ({
  pickRewigDonorProductId: jest.fn().mockResolvedValue(null),
}));

const { query } = require("../../../src/config/database");
const bundleService = require("../../../src/modules/retention/bundle.service");
const styledRepo = require("../../../src/modules/catalogue/styled.repo");
const resolvers = require("../../../src/modules/smartcomm/smartcomm.order-links.resolvers");

const BRAND = "faitlynhair";
const BUNDLE_ID = "b0000000-0000-0000-0000-000000000000";

// Handy variant ids used across cases.
const V_BASE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const V_BASE_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const V_BASE_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// The resolver runs several `SELECT` shapes against `config/database.query`:
//   • isVariantSellable   → SELECT 1 FROM …product_variants WHERE variant_id = $1
//   • defaultVariant      → SELECT variant_id … WHERE product_id = $1
// A simple dispatcher routes them by SQL shape → the fixture we set up.
function makeQueryDispatcher({ sellableVariants = new Set(), defaultByProduct = {} }) {
  return jest.fn(async (sql, params) => {
    if (/FROM\s+"?\w+"?\.product_variants\s+WHERE\s+variant_id/i.test(sql)) {
      const vid = params[0];
      return { rows: sellableVariants.has(vid) ? [{ ok: 1 }] : [] };
    }
    if (/FROM\s+"?\w+"?\.product_variants\s+WHERE\s+product_id/i.test(sql)) {
      const pid = params[0];
      const v = defaultByProduct[pid];
      return { rows: v ? [{ variant_id: v }] : [] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("resolveBundleItem — styled-component branch (root cause)", () => {
  test("bundle whose components are STYLED products resolves via base_variant_id", async () => {
    // "The Baddie": three styled components, each with a live base_variant_id.
    // Before the fix this returned lines:[] because the loop skipped styled_id
    // and both variant_id and product_id are null on styled components.
    bundleService.getBundle.mockResolvedValueOnce({
      bundle_id: BUNDLE_ID,
      display_name: "The Baddie",
      bundle_code: "BADDIE",
      is_active: true,
      effective_price_ngn: "1131000.00",
      components: [
        { styled_id: "s-1", quantity: 1 },
        { styled_id: "s-2", quantity: 1 },
        { styled_id: "s-3", quantity: 1 },
      ],
    });
    styledRepo.getById
      .mockResolvedValueOnce({ styled_id: "s-1", base_variant_id: V_BASE_A, base_product_id: "p-1" })
      .mockResolvedValueOnce({ styled_id: "s-2", base_variant_id: V_BASE_B, base_product_id: "p-2" })
      .mockResolvedValueOnce({ styled_id: "s-3", base_variant_id: V_BASE_C, base_product_id: "p-3" });
    query.mockImplementation(
      makeQueryDispatcher({
        sellableVariants: new Set([V_BASE_A, V_BASE_B, V_BASE_C]),
      }),
    );

    const [out] = await resolvers.resolveItems(BRAND, [
      { kind: "bundle", bundle_id: BUNDLE_ID, qty: 1 },
    ]);

    expect(out.unresolved_reason).toBeNull();
    expect(out.lines).toEqual([
      { variant_id: V_BASE_A, quantity: 1 },
      { variant_id: V_BASE_B, quantity: 1 },
      { variant_id: V_BASE_C, quantity: 1 },
    ]);
  });

  test("stale styled base_variant_id falls back to the base product's default variant", async () => {
    // The pin has been deactivated in POS; the base product still has an
    // active default variant. Bundle must still sell.
    bundleService.getBundle.mockResolvedValueOnce({
      bundle_id: BUNDLE_ID,
      display_name: "Mini Baddie",
      is_active: true,
      components: [{ styled_id: "s-1", quantity: 2 }],
    });
    styledRepo.getById.mockResolvedValueOnce({
      styled_id: "s-1",
      base_variant_id: V_BASE_A, // stale
      base_product_id: "p-1",
    });
    query.mockImplementation(
      makeQueryDispatcher({
        sellableVariants: new Set(), // V_BASE_A no longer sellable
        defaultByProduct: { "p-1": V_BASE_B },
      }),
    );

    const [out] = await resolvers.resolveItems(BRAND, [
      { kind: "bundle", bundle_id: BUNDLE_ID, qty: 3 },
    ]);

    expect(out.unresolved_reason).toBeNull();
    // quantity = comp.quantity (2) × order qty (3) = 6.
    expect(out.lines).toEqual([{ variant_id: V_BASE_B, quantity: 6 }]);
  });

  test("styled component whose parent record is deleted → whole bundle unresolvable", async () => {
    // A bundle is all-or-nothing: one broken component blocks the order
    // rather than shipping a partial one silently.
    bundleService.getBundle.mockResolvedValueOnce({
      bundle_id: BUNDLE_ID,
      display_name: "Ghost Trio",
      is_active: true,
      components: [
        { styled_id: "s-1", quantity: 1 },
        { styled_id: "s-gone", quantity: 1 },
      ],
    });
    styledRepo.getById
      .mockResolvedValueOnce({ styled_id: "s-1", base_variant_id: V_BASE_A, base_product_id: "p-1" })
      .mockResolvedValueOnce(null); // deleted styled record
    query.mockImplementation(
      makeQueryDispatcher({ sellableVariants: new Set([V_BASE_A]) }),
    );

    const [out] = await resolvers.resolveItems(BRAND, [
      { kind: "bundle", bundle_id: BUNDLE_ID, qty: 1 },
    ]);

    expect(out.lines).toEqual([]);
    expect(out.unresolved_reason).toBe(
      "A bundle component has no sellable variant",
    );
  });

  test("mixed component types (variant + styled + base) all resolve together", async () => {
    bundleService.getBundle.mockResolvedValueOnce({
      bundle_id: BUNDLE_ID,
      display_name: "Mixed Trio",
      is_active: true,
      components: [
        { variant_id: V_BASE_A, quantity: 1 }, // pinned variant, still sellable
        { styled_id: "s-2", quantity: 1 }, // styled → base_variant
        { product_id: "p-3", quantity: 1 }, // base product → default variant
      ],
    });
    styledRepo.getById.mockResolvedValueOnce({
      styled_id: "s-2",
      base_variant_id: V_BASE_B,
      base_product_id: "p-2",
    });
    query.mockImplementation(
      makeQueryDispatcher({
        sellableVariants: new Set([V_BASE_A, V_BASE_B]),
        defaultByProduct: { "p-3": V_BASE_C },
      }),
    );

    const [out] = await resolvers.resolveItems(BRAND, [
      { kind: "bundle", bundle_id: BUNDLE_ID, qty: 1 },
    ]);

    expect(out.unresolved_reason).toBeNull();
    expect(out.lines).toEqual([
      { variant_id: V_BASE_A, quantity: 1 },
      { variant_id: V_BASE_B, quantity: 1 },
      { variant_id: V_BASE_C, quantity: 1 },
    ]);
  });
});

describe("resolveBundleItem — pre-existing branches (regression guards)", () => {
  test("pure product_id bundle still resolves via defaultVariant", async () => {
    bundleService.getBundle.mockResolvedValueOnce({
      bundle_id: BUNDLE_ID,
      display_name: "Base Trio",
      is_active: true,
      components: [
        { product_id: "p-1", quantity: 1 },
        { product_id: "p-2", quantity: 2 },
      ],
    });
    query.mockImplementation(
      makeQueryDispatcher({
        defaultByProduct: { "p-1": V_BASE_A, "p-2": V_BASE_B },
      }),
    );

    const [out] = await resolvers.resolveItems(BRAND, [
      { kind: "bundle", bundle_id: BUNDLE_ID, qty: 1 },
    ]);

    expect(out.unresolved_reason).toBeNull();
    expect(out.lines).toEqual([
      { variant_id: V_BASE_A, quantity: 1 },
      { variant_id: V_BASE_B, quantity: 2 },
    ]);
  });

  test("inactive bundle stays lines:[] with the existing reason", async () => {
    bundleService.getBundle.mockResolvedValueOnce({
      bundle_id: BUNDLE_ID,
      display_name: "Retired",
      is_active: false,
      components: [],
    });
    const [out] = await resolvers.resolveItems(BRAND, [
      { kind: "bundle", bundle_id: BUNDLE_ID, qty: 1 },
    ]);
    expect(out.lines).toEqual([]);
    expect(out.unresolved_reason).toBe("Bundle is inactive");
  });
});
