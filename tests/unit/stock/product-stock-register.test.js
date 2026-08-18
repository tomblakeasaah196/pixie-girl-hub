"use strict";

/**
 * `listProductStock` — the Stock → Available Products register.
 *
 * It is the one stock read that takes free-text and enum input straight off
 * the query string, and schema/column names can't be bound as parameters, so
 * the tests below pin the two things that keep it safe and correct:
 *   1. `q` is always a BOUND parameter; `sort`/`stock_state` are resolved
 *      through allow-lists and never interpolated.
 *   2. It counts what is physically on the shelf — deleted products are out,
 *      a non-tracking product only appears when it is actually holding units,
 *      and a location filter scopes the quantities rather than the product list.
 */

jest.mock("../../../src/config/database", () => ({
  ex: (client) => client.query.bind(client),
  query: jest.fn(),
}));

const repo = require("../../../src/modules/stock/stock.repo");

const BRAND = "pixiegirl";
const LOC = "c384dbdc-65e5-4168-b219-f54241d7cb8a";

/** Mock client: first call returns rows, second the summary aggregate. */
function mockClient(rows = [], summary = {}) {
  const query = jest
    .fn()
    .mockResolvedValueOnce({ rows })
    .mockResolvedValueOnce({ rows: [summary] });
  return { query };
}

const call = (client, args = {}) =>
  repo.listProductStock({
    client,
    brand: BRAND,
    page: 1,
    page_size: 25,
    offset: 0,
    ...args,
  });

describe("listProductStock — input safety", () => {
  test("search text is bound, never interpolated", async () => {
    const client = mockClient();
    await call(client, { filters: { q: "'; DROP TABLE products; --" } });
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).not.toContain("DROP TABLE products");
    expect(params).toContain("%'; DROP TABLE products; --%");
  });

  test("search spans name, product code, slug and SKU", async () => {
    const client = mockClient();
    await call(client, { filters: { q: "wave" } });
    const sql = client.query.mock.calls[0][0];
    expect(sql).toMatch(/p\.name ILIKE/);
    expect(sql).toMatch(/p\.product_code ILIKE/);
    expect(sql).toMatch(/p\.slug ILIKE/);
    expect(sql).toMatch(/pvq\.sku ILIKE/);
  });

  test("an unknown sort falls back to the default ordering", async () => {
    const client = mockClient();
    await call(client, { filters: { sort: "name; DROP TABLE products" } });
    const sql = client.query.mock.calls[0][0];
    expect(sql).not.toContain("DROP TABLE products");
    expect(sql).toMatch(/ORDER BY available > 0 DESC, available DESC/);
  });

  test("a known sort is honoured", async () => {
    const client = mockClient();
    await call(client, { filters: { sort: "recent" } });
    expect(client.query.mock.calls[0][0]).toMatch(
      /ORDER BY last_movement_at DESC NULLS LAST/,
    );
  });

  test("an unknown stock_state filters nothing", async () => {
    const client = mockClient();
    await call(client, { filters: { stock_state: "'; DELETE FROM products" } });
    const sql = client.query.mock.calls[0][0];
    expect(sql).not.toContain("DELETE FROM products");
    expect(sql).not.toMatch(/FROM scoped s\s+WHERE/);
  });

  test("a known stock_state filters on the computed state", async () => {
    const client = mockClient();
    await call(client, { filters: { stock_state: "low_stock" } });
    expect(client.query.mock.calls[0][0]).toMatch(
      /WHERE stock_state = 'low_stock'/,
    );
  });
});

describe("listProductStock — what counts as on the shelf", () => {
  test("deleted products are excluded", async () => {
    const client = mockClient();
    await call(client);
    expect(client.query.mock.calls[0][0]).toMatch(/p\.is_deleted = false/);
  });

  test("a non-tracking product appears only while it holds units", async () => {
    const client = mockClient();
    await call(client);
    expect(client.query.mock.calls[0][0]).toMatch(
      /p\.track_stock = true OR COALESCE\(lv\.on_hand, 0\) > 0/,
    );
  });

  test("quantities sum every variant — inactive ones included", async () => {
    const client = mockClient();
    await call(client);
    const sql = client.query.mock.calls[0][0];
    const levels = sql.slice(sql.indexOf("WITH lv"), sql.indexOf("va AS"));
    // The physical count must not be narrowed to sellable variants; that is
    // catalogue availability's job, not the stocktake's.
    expect(levels).not.toMatch(/pv\.is_active/);
    expect(levels).toMatch(/SUM\(sl\.on_hand\)/);
    expect(levels).toMatch(/SUM\(sl\.reserved\)/);
    expect(levels).toMatch(/SUM\(sl\.available\)/);
  });

  test("a location filter scopes the level aggregate, bound as a param", async () => {
    const client = mockClient();
    await call(client, { filters: { location_id: LOC } });
    const [sql, params] = client.query.mock.calls[0];
    const levels = sql.slice(sql.indexOf("WITH lv"), sql.indexOf("va AS"));
    expect(levels).toMatch(/WHERE sl\.location_id = \$1/);
    expect(params[0]).toBe(LOC);
  });

  test("low stock is measured against the reorder point", async () => {
    const client = mockClient();
    await call(client);
    const sql = client.query.mock.calls[0][0];
    expect(sql).toMatch(/THEN 'out_of_stock'/);
    expect(sql).toMatch(/COALESCE\(va\.reorder_point, 0\) > 0/);
    expect(sql).toMatch(/THEN 'low_stock'/);
  });
});

describe("listProductStock — response shape", () => {
  test("returns rows, pagination meta and a summary", async () => {
    const row = {
      product_id: "p1",
      name: "Body Wave 22in",
      on_hand: 4,
      available: 4,
      total_count: 40,
    };
    const summary = { products: 40, in_stock: 30, total_on_hand: 900 };
    const client = mockClient([row], summary);
    const res = await call(client, { page: 2, page_size: 25, offset: 25 });

    // total_count is a windowed count, not a product field — it must not leak.
    expect(res.data).toEqual([
      { product_id: "p1", name: "Body Wave 22in", on_hand: 4, available: 4 },
    ]);
    expect(res.meta).toEqual({
      page: 2,
      page_size: 25,
      total: 40,
      has_more: true,
    });
    expect(res.summary).toBe(summary);
  });

  test("an empty page reports a zero total rather than throwing", async () => {
    const client = mockClient([], { products: 0 });
    const res = await call(client);
    expect(res.data).toEqual([]);
    expect(res.meta.total).toBe(0);
    expect(res.meta.has_more).toBe(false);
  });

  test("the summary ignores the state filter so chips can show counts", async () => {
    const client = mockClient([], {});
    await call(client, { filters: { stock_state: "in_stock" } });
    const summarySql = client.query.mock.calls[1][0];
    // No state predicate of its own — only the per-state FILTER counts.
    expect(summarySql).not.toMatch(/FROM scoped\s+WHERE/);
    expect(summarySql).toMatch(/FILTER \(WHERE stock_state = 'in_stock'\)/);
    expect(summarySql).toMatch(/FILTER \(WHERE stock_state = 'low_stock'\)/);
    // …while the row query does carry it.
    expect(client.query.mock.calls[0][0]).toMatch(
      /FROM scoped s\s+WHERE stock_state = 'in_stock'/,
    );
  });

  test("paging is applied to the row query only", async () => {
    const client = mockClient();
    await call(client, { page: 3, page_size: 10, offset: 20 });
    const [rowSql, rowParams] = client.query.mock.calls[0];
    const [, sumParams] = client.query.mock.calls[1];
    expect(rowSql).toMatch(/LIMIT \$1 OFFSET \$2/);
    expect(rowParams).toEqual([10, 20]);
    expect(sumParams).toEqual([]);
  });
});
