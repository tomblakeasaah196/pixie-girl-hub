"use strict";

/**
 * The stock SQL builders in catalogue/availability.js must only count stock a
 * sale can actually draw on.
 *
 * They used to SUM every stock_levels row regardless of location — including
 * in-transit and production rows, and any warehouse a merchant had explicitly
 * flagged `available_for_storefront = false` — while checkout reserves at the
 * single location `stockRepo.getDefaultLocation` resolves. The screen therefore
 * reported units the reserve could not reach, and the line fell through to
 * pre-order looking "in stock". Sales-campaigns already filtered this way
 * (campaigns.repo.js); these assertions keep the catalogue and storefront reads
 * on the same definition.
 *
 * Pure string builders — no DB, no mocks.
 */

const {
  rewigBonusSql,
  styledStockSql,
  styledVariantStockSql,
} = require("../../../src/modules/catalogue/availability");

const BRAND = "faitlynhair";

/** Every stock_levels sum in `sql` must be guarded by a sellable-location test. */
function sellableGuards(sql) {
  return (sql.match(/available_for_storefront\s*=\s*true/g) || []).length;
}

describe("availability SQL — location scoping", () => {
  test("rewigBonusSql only counts storefront-sellable locations", () => {
    const sql = rewigBonusSql(BRAND, "s.base_product_id", "s");
    expect(sql).toContain("stock_locations");
    expect(sellableGuards(sql)).toBeGreaterThanOrEqual(1);
    expect(sql).toContain("loc.is_active = true");
  });

  test("styledStockSql guards both the variant-aware and seed-base sums", () => {
    const { joins } = styledStockSql(BRAND, "s");
    // Two direct sums (vav + sav), each of which also embeds a rewig bonus —
    // every one of them needs its own guard.
    expect(sellableGuards(joins)).toBeGreaterThanOrEqual(4);
  });

  test("styledVariantStockSql guards its single-variant sum", () => {
    const sql = styledVariantStockSql(BRAND, "v", "sp");
    expect(sellableGuards(sql)).toBeGreaterThanOrEqual(2);
  });

  test("the guard is correlated to the row being summed, not a bare constant", () => {
    const sql = styledVariantStockSql(BRAND, "v", "sp");
    // It must join back on the stock_levels row's own location_id, otherwise
    // "any sellable location exists" would pass for stock sitting anywhere.
    expect(sql).toMatch(/loc\.location_id\s*=\s*sl\.location_id/);
  });

  test("brand schema is threaded into the location lookup", () => {
    const sql = rewigBonusSql(BRAND, "s.base_product_id", "s");
    expect(sql).toContain(`${BRAND}.stock_locations`);
  });
});
