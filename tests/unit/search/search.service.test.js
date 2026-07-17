"use strict";

/**
 * Unit tests for the search service — the parts that don't need the DB.
 * Ranking + entity gating are pure and easy to check; the actual resolvers
 * are integration-tested elsewhere via the fan-out endpoint.
 */

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
  ex: () => async () => ({ rows: [] }),
  getPool: () => ({ connect: async () => ({ release: () => {} }) }),
}));

jest.mock("../../../src/shared/cache/identity-cache", () => ({
  getGrants: jest.fn(async () => []),
}));

const svc = require("../../../src/modules/search/search.service");
const { ENTITIES } = require("../../../src/modules/search/search.registry");

describe("search.service.scoreHits", () => {
  test("ranks starts-with above substring, tiebreaks by shorter title", () => {
    const out = svc.scoreHits(
      [
        { title: "irrelevant", subtitle: "test hidden" },
        { title: "Order XYZ", subtitle: "test" },
        { title: "test order", subtitle: "other" },
        { title: "TESTING framework", subtitle: "" },
      ],
      "test",
    );
    expect(out[0].title).toBe("test order"); // starts-with wins
    expect(out[1].title).toBe("TESTING framework"); // starts-with, longer title
    expect(out[2].title).toBe("Order XYZ"); // subtitle-only substring, next
    expect(out[3].title).toBe("irrelevant"); // subtitle-only, longer
  });

  test("empty query returns rows in stable order (no crash)", () => {
    const rows = [{ title: "a" }, { title: "b" }];
    const out = svc.scoreHits(rows, "");
    expect(out).toHaveLength(2);
  });
});

describe("search.service.pickEntities", () => {
  test("null permittedModules (CEO) returns every entity", () => {
    const picked = svc.pickEntities({
      typesFilter: null,
      permittedModules: null,
    });
    expect(picked.length).toBe(ENTITIES.length);
  });

  test("permittedModules Set filters to matching + universal (module=null) entities", () => {
    const picked = svc.pickEntities({
      typesFilter: null,
      permittedModules: new Set(["sales"]),
    });
    const keys = picked.map((e) => e.key).sort();
    // sales.view unlocks sale_order and payment. Universal (contact, help,
    // document) always show up.
    expect(keys).toEqual(
      ["contact", "document", "help_article", "payment", "sale_order"].sort(),
    );
  });

  test("typesFilter narrows even for CEO", () => {
    const picked = svc.pickEntities({
      typesFilter: ["contact", "employee"],
      permittedModules: null,
    });
    expect(picked.map((e) => e.key).sort()).toEqual(["contact", "employee"]);
  });

  test("typesFilter + permission both apply", () => {
    const picked = svc.pickEntities({
      typesFilter: ["employee", "sale_order"],
      permittedModules: new Set(["sales"]),
    });
    // employee requires hr_payroll; the sales-only user can't see it.
    expect(picked.map((e) => e.key)).toEqual(["sale_order"]);
  });
});

describe("search.registry", () => {
  test("every entity has a resolver + label + group", () => {
    for (const e of ENTITIES) {
      expect(typeof e.resolve).toBe("function");
      expect(typeof e.label).toBe("string");
      expect(e.label.length).toBeGreaterThan(0);
      expect(["run", "operate", "finance", "people", "grow", "system"]).toContain(
        e.group,
      );
    }
  });

  test("registry keys are unique", () => {
    const keys = ENTITIES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("every RBAC module is a real access-catalog key", () => {
    // The permission gate (search.service.permittedModulesFor) looks each
    // entity's `module` up in the access catalog. A typo / stale key (e.g. the
    // old "hr" instead of "hr_payroll") silently fails closed and hides the
    // entity from everyone but the CEO — so pin it to the catalog.
    const { MODULES } = require("../../../src/shared/access/access.catalog");
    const valid = new Set(MODULES);
    for (const e of ENTITIES) {
      if (e.module === null) continue; // universal (contacts, help, docs)
      expect(valid.has(e.module)).toBe(true);
    }
  });
});

describe("search.registry routes lead to real pages", () => {
  // The router (apps/admin/src/router.tsx) mounts each detail page at a
  // specific path shape. A result whose route doesn't match one of these
  // falls through to the not-found placeholder — a dead search hit. These
  // patterns mirror the real routes, so reverting a fix (e.g. back to
  // /sales/:id, which doesn't exist) fails this test.
  const ALLOWED_ROUTE_PATTERNS = [
    /^\/sales\/orders\/[^/?]+$/, // order / payment detail
    /^\/crm\/deals\/[^/?]+$/,
    /^\/smartcomm\?channel=[^/&]+$/,
    /^\/catalogue\/base\/[^/?]+$/, // product / stock variant
    /^\/logistics(\?tab=[^/&]+)?$/,
    /^\/invoicing\?tab=invoices&invoice=[^/&]+$/,
    /^\/contacts\/[^/?]+$/,
    /^\/hr\/employees\/[^/?]+$/,
    /^\/sales-campaigns\/[^/?]+$/,
    /^\/help\/[^/?]+$/,
    /^\/expenses$/,
    /^\/cash-requests$/,
    /^\/documents$/,
  ];

  // A synthetic row carrying every id field the resolvers read for their
  // routes. `ex` ignores the SQL and just hands this back.
  const ROW = {
    id: "11111111-1111-1111-1111-111111111111",
    order_id: "22222222-2222-2222-2222-222222222222",
    product_id: "33333333-3333-3333-3333-333333333333",
    slug: "getting-started",
  };
  const ex = async () => ({ rows: [ROW] });

  test("every entity produces a route matching a real router path", async () => {
    for (const e of ENTITIES) {
      const results = await e.resolve({
        ex,
        brand: "pixiegirl",
        q: "x",
        limit: 5,
      });
      for (const r of results) {
        const ok = ALLOWED_ROUTE_PATTERNS.some((re) => re.test(r.route));
        // Surface the offending route in the failure message.
        expect(ok ? "" : `${e.key} → ${r.route}`).toBe("");
      }
    }
  });
});
