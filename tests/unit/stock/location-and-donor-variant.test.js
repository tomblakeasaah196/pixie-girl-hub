"use strict";

/**
 * Two stock-repo reads that decide whether a sale reserves successfully or
 * silently becomes a pre-order.
 *
 * `getDefaultLocation` — 000017 indexes stock_locations.is_default UNIQUE per
 * `location_type`, NOT globally, so a brand can carry a default warehouse and a
 * default production/in_transit row simultaneously. The original
 * `ORDER BY is_default DESC, created_at` then tiebroke on whichever default was
 * created first, which could hand every reservation to a location holding no
 * sellable stock — and was not even deterministic when two rows shared a
 * created_at.
 *
 * `variantWithStockForProduct` — picks a rewig donor's variant by what is
 * actually on the shelf AT the reservation location, rather than by ordering
 * alone. Its stock-blind sibling `defaultVariantForProduct` can hand back an
 * inactive variant, or an active one with nothing on it, which then fails to
 * reserve and lands as a pre-order.
 */

jest.mock("../../../src/config/database", () => ({
  ex: (client) => client.query.bind(client),
  query: jest.fn(),
}));

const repo = require("../../../src/modules/stock/stock.repo");

const BRAND = "faitlynhair";
const LOC = "c384dbdc-65e5-4168-b219-f54241d7cb8a";
const PRODUCT = "6dce0a12-1bf4-4e58-9c85-b414c95fc7b7";

/** Mock client capturing the SQL and params of the last call. */
function mockClient(rows = []) {
  return { query: jest.fn().mockResolvedValue({ rows }) };
}

describe("getDefaultLocation", () => {
  test("prefers a sellable location type over transit/production", async () => {
    const client = mockClient([{ location_id: LOC }]);
    await repo.getDefaultLocation({ client, brand: BRAND });
    const sql = client.query.mock.calls[0][0];
    expect(sql).toMatch(/location_type IN \('warehouse','showroom'\)/);
    // is_default still leads — an explicit default is the merchant's choice.
    expect(sql.indexOf("is_default DESC")).toBeLessThan(
      sql.indexOf("location_type IN"),
    );
  });

  test("prefers storefront- then POS-sellable locations", async () => {
    const client = mockClient([{ location_id: LOC }]);
    await repo.getDefaultLocation({ client, brand: BRAND });
    const sql = client.query.mock.calls[0][0];
    expect(sql).toMatch(/available_for_storefront DESC/);
    expect(sql).toMatch(/available_for_pos DESC/);
  });

  test("breaks ties deterministically on location_id", async () => {
    const client = mockClient([{ location_id: LOC }]);
    await repo.getDefaultLocation({ client, brand: BRAND });
    const sql = client.query.mock.calls[0][0];
    // Without this a shared created_at leaves the winner up to the planner.
    expect(sql).toMatch(/created_at ASC,\s*\n?\s*location_id ASC/);
  });

  test("filters on is_active only — never excludes by type", async () => {
    const client = mockClient([{ location_id: LOC }]);
    await repo.getDefaultLocation({ client, brand: BRAND });
    const sql = client.query.mock.calls[0][0];
    const where = sql.slice(sql.indexOf("WHERE"), sql.indexOf("ORDER BY"));
    // A brand whose only location is an odd type must still resolve, otherwise
    // every line pre-orders for want of a location.
    expect(where).toContain("is_active = true");
    expect(where).not.toContain("location_type");
  });

  test("returns null when the brand has no active location", async () => {
    const client = mockClient([]);
    await expect(
      repo.getDefaultLocation({ client, brand: BRAND }),
    ).resolves.toBeNull();
  });
});

describe("variantWithStockForProduct", () => {
  test("scopes to the reservation location and requires enough stock", async () => {
    const client = mockClient([{ variant_id: "v1", sku: "FLH104N", available: 7 }]);
    await repo.variantWithStockForProduct({
      client,
      brand: BRAND,
      product_id: PRODUCT,
      location_id: LOC,
      quantity: 2,
    });
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/sl\.location_id = \$2/);
    expect(sql).toMatch(/sl\.available >= \$3/);
    expect(params).toEqual([PRODUCT, LOC, 2]);
  });

  test("only considers active variants", async () => {
    const client = mockClient([]);
    await repo.variantWithStockForProduct({
      client,
      brand: BRAND,
      product_id: PRODUCT,
      location_id: LOC,
      quantity: 1,
    });
    expect(client.query.mock.calls[0][0]).toMatch(/pv\.is_active = true/);
  });

  test("takes the deepest-stocked variant first", async () => {
    const client = mockClient([]);
    await repo.variantWithStockForProduct({
      client,
      brand: BRAND,
      product_id: PRODUCT,
      location_id: LOC,
      quantity: 1,
    });
    expect(client.query.mock.calls[0][0]).toMatch(/ORDER BY sl\.available DESC/);
  });

  test("returns null when nothing there can cover the quantity", async () => {
    const client = mockClient([]);
    await expect(
      repo.variantWithStockForProduct({
        client,
        brand: BRAND,
        product_id: PRODUCT,
        location_id: LOC,
        quantity: 99,
      }),
    ).resolves.toBeNull();
  });
});
