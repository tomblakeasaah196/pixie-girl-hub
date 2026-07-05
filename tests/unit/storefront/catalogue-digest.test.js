"use strict";

// Repo helpers that ground Shop AI Search — mocks the pg pool exactly like
// tests/unit/storefront/products-filters.test.js.
jest.mock("../../../src/config/database", () => {
  const query = jest.fn(async () => ({ rows: [] }));
  return { query, ex: (c) => (c ? c.query.bind(c) : query) };
});

const db = require("../../../src/config/database");
const repo = require("../../../src/modules/storefront/storefront.repo");

const lastCall = () => db.query.mock.calls[db.query.mock.calls.length - 1] || [];

beforeEach(() => {
  db.query.mockClear();
});

describe("storefront.repo.listCatalogueDigestForAI", () => {
  test("scopes to the live/visible/not-deleted catalogue and caps with LIMIT", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ slug: "wig-a" }] });
    const rows = await repo.listCatalogueDigestForAI({ brand: "pixiegirl", limit: 300 });
    const [sql, params] = lastCall();
    expect(sql).toContain("s.status = 'live'");
    expect(sql).toContain("s.is_visible_storefront = true");
    expect(sql).toContain("s.is_deleted = false");
    expect(sql).toMatch(/LIMIT \$1/);
    expect(sql).toContain("styled_product_colours");
    expect(params).toEqual([300]);
    expect(rows).toEqual([{ slug: "wig-a" }]);
  });

  test("defaults the cap to 300 when no limit is given", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await repo.listCatalogueDigestForAI({ brand: "pixiegirl" });
    expect(lastCall()[1]).toEqual([300]);
  });
});

describe("storefront.repo.getProductCardsBySlugs", () => {
  test("short-circuits to [] without querying when slugs is empty", async () => {
    const rows = await repo.getProductCardsBySlugs({ brand: "pixiegirl", slugs: [] });
    expect(rows).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  test("matches slugs via ANY() and re-applies the live/visible/not-deleted gate", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ slug: "wig-a" }, { slug: "wig-b" }] });
    const rows = await repo.getProductCardsBySlugs({
      brand: "pixiegirl",
      slugs: ["wig-a", "wig-b"],
    });
    const [sql, params] = lastCall();
    expect(sql).toMatch(/s\.slug = ANY\(\$1\)/);
    expect(sql).toContain("s.status = 'live'");
    expect(sql).toContain("s.is_visible_storefront = true");
    expect(sql).toContain("s.is_deleted = false");
    expect(params).toEqual([["wig-a", "wig-b"]]);
    expect(rows).toEqual([{ slug: "wig-a" }, { slug: "wig-b" }]);
  });
});
