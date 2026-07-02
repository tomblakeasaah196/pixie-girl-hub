"use strict";

/**
 * Domain registry + period maths (§6.20). The registry is a frontend/export
 * contract — these tests pin its integrity: every detail table has both a
 * query function and a column manifest, every in-payload table has columns,
 * gates only reference real module keys, tile keys stay unique per domain.
 * Pure — no database.
 */

process.env.DB_HOST = process.env.DB_HOST || "localhost";
process.env.DB_NAME = process.env.DB_NAME || "test";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";
process.env.REDIS_HOST = process.env.REDIS_HOST || "localhost";
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(40);
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "y".repeat(40);
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "z".repeat(64);

const registry = require("../../../src/modules/dashboards/dashboards.domains");
const {
  DETAIL_COLUMNS,
  TABLE_COLUMNS,
} = require("../../../src/modules/dashboards/dashboards.columns");
const { DETAILS } = require("../../../src/modules/dashboards/dashboards.details.repo");
const {
  resolvePeriod,
  deltaPct,
  SNAPSHOT_KEYS,
} = require("../../../src/modules/dashboards/dashboards.metrics.service");

const SPEC_DOMAINS = [
  "overview",
  "sales",
  "customers",
  "finance",
  "stock",
  "logistics",
  "marketing",
  "ecommerce",
  "retention",
  "hr",
];

describe("domain registry", () => {
  test("covers overview + the 9 spec domains, in order", () => {
    expect(registry.DOMAIN_KEYS).toEqual(SPEC_DOMAINS);
  });

  test("every registry detail has a query fn and a column manifest", () => {
    for (const d of registry.DOMAINS) {
      for (const key of Object.keys(d.details || {})) {
        expect(DETAILS[d.key] && DETAILS[d.key][key]).toBeInstanceOf(Function);
        expect(Array.isArray(DETAIL_COLUMNS[d.key][key])).toBe(true);
        expect(DETAIL_COLUMNS[d.key][key].length).toBeGreaterThan(0);
      }
    }
  });

  test("every detail query fn is declared in the registry", () => {
    for (const [domainKey, fns] of Object.entries(DETAILS)) {
      const d = registry.getDomain(domainKey);
      for (const key of Object.keys(fns)) {
        expect(d.details[key]).toBeDefined();
      }
    }
  });

  test("every in-payload table has a column manifest", () => {
    for (const d of registry.DOMAINS) {
      for (const tb of d.tables || []) {
        expect(TABLE_COLUMNS[`${d.key}.${tb.key}`]).toBeDefined();
      }
    }
  });

  test("gates only reference enforced module keys", () => {
    for (const d of registry.DOMAINS) {
      expect([null, "accounting", "hr_payroll"]).toContain(d.gate);
    }
  });

  test("tile keys are unique within each domain and section", () => {
    for (const d of registry.DOMAINS) {
      for (const list of [d.kpis, d.charts, d.tables || []]) {
        const keys = list.map((x) => x.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });

  test("snapshot KPI keys all exist in their domain manifests", () => {
    for (const [domainKey, keys] of Object.entries(SNAPSHOT_KEYS)) {
      const d = registry.getDomain(domainKey);
      const kpiKeys = new Set(d.kpis.map((k) => k.key));
      for (const key of keys) expect(kpiKeys.has(key)).toBe(true);
    }
  });

  test("finance and hr are gated; cost tile needs cost visibility", () => {
    const noCaps = {
      can_finance: false,
      can_hr: false,
      can_cost: false,
      can_export: false,
      all_entities: false,
    };
    const visible = registry.visibleDomains(noCaps).map((d) => d.key);
    expect(visible).not.toContain("finance");
    expect(visible).not.toContain("hr");

    const stock = registry.getDomain("stock");
    const withoutCost = registry.permittedTiles(stock, noCaps);
    expect(withoutCost.kpis.map((k) => k.key)).not.toContain("value_at_cost");
    const withCost = registry.permittedTiles(stock, { ...noCaps, can_cost: true });
    expect(withCost.kpis.map((k) => k.key)).toContain("value_at_cost");
  });
});

describe("resolvePeriod", () => {
  test("defaults to the last 30 days, daily buckets", () => {
    const p = resolvePeriod({});
    const span = new Date(p.to) - new Date(p.from);
    expect(Math.round(span / 86400000)).toBe(30);
    expect(p.granularity).toBe("day");
  });

  test("previous window is the equivalent length immediately before", () => {
    const p = resolvePeriod({ from: "2026-06-01T00:00:00Z", to: "2026-07-01T00:00:00Z" });
    expect(new Date(p.prev_to) < new Date(p.from)).toBe(true);
    const span = new Date(p.to) - new Date(p.from);
    const prevSpan = new Date(p.from) - new Date(p.prev_from);
    expect(prevSpan).toBe(span);
  });

  test("granularity widens with the range", () => {
    expect(
      resolvePeriod({ from: "2026-01-01", to: "2026-03-01" }).granularity,
    ).toBe("week");
    expect(
      resolvePeriod({ from: "2025-01-01", to: "2026-01-01" }).granularity,
    ).toBe("month");
  });

  test("rejects inverted and malformed ranges", () => {
    expect(() =>
      resolvePeriod({ from: "2026-07-01", to: "2026-06-01" }),
    ).toThrow(/before/);
    expect(() => resolvePeriod({ from: "not-a-date" })).toThrow(/Invalid date/);
  });
});

describe("deltaPct", () => {
  test("computes signed percentage against the previous value", () => {
    expect(deltaPct(120, 100)).toBe(20);
    expect(deltaPct(80, 100)).toBe(-20);
    expect(deltaPct("150.00", "100.00")).toBe(50);
  });

  test("null when previous is zero or non-numeric", () => {
    expect(deltaPct(50, 0)).toBeNull();
    expect(deltaPct(50, null)).toBeNull();
    expect(deltaPct("abc", 10)).toBeNull();
  });
});
