"use strict";

/**
 * Public storefront catalogue filtering (shop page search + Collection /
 * Bundle / Shade dropdowns). Mocks the pg pool so we can assert on the SQL
 * + bound params the repo emits without needing a real connection.
 */

jest.mock("../../../src/config/database", () => {
  const query = jest.fn(async () => ({ rows: [{ total: 0 }] }));
  return { query, ex: (c) => (c ? c.query.bind(c) : query) };
});

const db = require("../../../src/config/database");
const repo = require("../../../src/modules/storefront/storefront.repo");

const countCall = () => db.query.mock.calls[0] || [];
const selectCall = () => db.query.mock.calls[1] || [];

beforeEach(() => {
  db.query.mockClear();
  db.query
    .mockResolvedValueOnce({ rows: [{ total: 0 }] }) // count
    .mockResolvedValueOnce({ rows: [] }); // rows
});

describe("storefront.repo.listProducts filters", () => {
  test("no filters: only the base live/visible/not-deleted predicate", async () => {
    await repo.listProducts({ brand: "pixiegirl", filters: {} });
    expect(countCall()[0]).toContain("s.status = 'live'");
    expect(countCall()[0]).not.toContain("EXISTS");
    expect(countCall()[1]).toEqual([]);
  });

  test("collection filter joins product_collection_members via EXISTS", async () => {
    await repo.listProducts({
      brand: "pixiegirl",
      filters: { collection_slug: "bridal-edit" },
    });
    expect(countCall()[0]).toMatch(
      /EXISTS \(\s*SELECT 1 FROM pixiegirl\.product_collection_members pcm\s*JOIN pixiegirl\.product_collections pc ON pc\.collection_id = pcm\.collection_id\s*WHERE pcm\.styled_id = s\.styled_id AND pc\.slug = \$1/,
    );
    expect(countCall()[1]).toEqual(["bridal-edit"]);
  });

  test("bundle filter joins bundle_offer_products via EXISTS, keyed by bundle_code", async () => {
    await repo.listProducts({
      brand: "pixiegirl",
      filters: { bundle_code: "GLOW-3PC" },
    });
    expect(countCall()[0]).toMatch(
      /EXISTS \(\s*SELECT 1 FROM pixiegirl\.bundle_offer_products bop\s*JOIN pixiegirl\.bundle_offers bo ON bo\.bundle_id = bop\.bundle_id\s*WHERE bop\.styled_id = s\.styled_id AND bo\.bundle_code = \$1/,
    );
    expect(countCall()[1]).toEqual(["GLOW-3PC"]);
  });

  test("shade filter matches styled_shades.slug against the product's shade_id", async () => {
    await repo.listProducts({
      brand: "pixiegirl",
      filters: { shade_slug: "honey-blonde" },
    });
    expect(countCall()[0]).toMatch(
      /EXISTS \(\s*SELECT 1 FROM pixiegirl\.styled_shades sh\s*WHERE sh\.shade_id = s\.shade_id AND sh\.slug = \$1/,
    );
    expect(countCall()[1]).toEqual(["honey-blonde"]);
  });

  test("free-text search tokenizes on whitespace and ANDs each token as name/code/colour", async () => {
    await repo.listProducts({ brand: "pixiegirl", filters: { q: "burgundy bob" } });
    const [sql, params] = countCall();
    // Two independent token clauses, each OR-ing name/code/colour.
    expect(sql.match(/s\.name ILIKE/g)).toHaveLength(2);
    expect(sql).toContain("styled_product_colours");
    expect(params).toEqual(["%burgundy%", "%bob%"]);
  });

  test("search is order-independent: token order in the query doesn't change the match shape", async () => {
    await repo.listProducts({ brand: "pixiegirl", filters: { q: "bob burgundy" } });
    expect(countCall()[1]).toEqual(["%bob%", "%burgundy%"]);
  });

  test("caps free-text search at 8 tokens", async () => {
    const q = Array.from({ length: 12 }, (_, i) => `w${i}`).join(" ");
    await repo.listProducts({ brand: "pixiegirl", filters: { q } });
    expect(countCall()[1]).toHaveLength(8);
  });

  test("combined filters bind params in the same order as their placeholders", async () => {
    await repo.listProducts({
      brand: "pixiegirl",
      filters: {
        category_slug: "wigs",
        collection_slug: "bridal-edit",
        bundle_code: "GLOW-3PC",
        shade_slug: "honey-blonde",
        q: "burgundy bob",
      },
    });
    const [sql, params] = countCall();
    expect(params).toEqual([
      "wigs",
      "bridal-edit",
      "GLOW-3PC",
      "honey-blonde",
      "%burgundy%",
      "%bob%",
    ]);
    // Positional integrity — a mis-incremented counter would duplicate/skip a
    // number. $1-$4 (category/collection/bundle/shade) each appear once; $5
    // and $6 (the two search tokens) are each reused 3x (name/code/colour).
    for (const n of [1, 2, 3, 4]) {
      expect(sql.match(new RegExp(`\\$${n}\\b`, "g"))).toHaveLength(1);
    }
    for (const n of [5, 6]) {
      expect(sql.match(new RegExp(`\\$${n}\\b`, "g"))).toHaveLength(3);
    }

    // The paginated SELECT reuses the same filter params, then appends
    // LIMIT/OFFSET at $7/$8.
    const [selectSql, selectParams] = selectCall();
    expect(selectParams).toEqual([...params, 24, 0]);
    expect(selectSql).toMatch(/LIMIT \$7 OFFSET \$8/);
  });
});
