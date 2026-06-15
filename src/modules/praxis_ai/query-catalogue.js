/**
 * Praxis Query Catalogue (§8.2 — the Query Agent's allowlist).
 *
 * A curated registry of READ-ONLY questions Praxis can answer about LIVE
 * business data. The model NEVER writes SQL — it selects a query by key and
 * supplies typed params; each entry's `run` executes an existing, parameterised,
 * brand-scoped repository read (so there is no free-form SQL and no injection
 * surface). `module` is the RBAC key the caller must hold `view` on for the
 * query to run (enforced in query-agent).
 *
 * Extending: add an entry whose `run` calls a brand-scoped repo read. Keep
 * params declarative (JSON-schema) and pass them through as bound parameters —
 * never interpolate model output into SQL.
 */

"use strict";

const dashboardsRepo = require("../dashboards/dashboards.repo");

const str = (v) => (typeof v === "string" && v ? v : null);

const QUERIES = [
  {
    key: "sales_summary",
    title: "Sales summary",
    description:
      "Orders and revenue for the current brand over an optional date range: paid orders, revenue, pending orders, and outstanding balance.",
    module: "dashboards",
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "ISO date/time lower bound, e.g. 2026-06-01 (optional)",
        },
        to: {
          type: "string",
          description: "ISO date/time upper bound (optional)",
        },
      },
    },
    run: ({ brand, args }) =>
      dashboardsRepo.salesKpis({
        brand,
        from: str(args.from),
        to: str(args.to),
      }),
  },
  {
    key: "operations_summary",
    title: "Operations summary",
    description:
      "Operational KPIs for the current brand (e.g. service jobs in progress, deliveries in flight).",
    module: "dashboards",
    parameters: { type: "object", properties: {} },
    run: ({ brand }) => dashboardsRepo.opsKpis({ brand }),
  },
];

const byKey = new Map(QUERIES.map((q) => [q.key, q]));

function list() {
  return QUERIES;
}
function get(key) {
  return byKey.get(key) || null;
}

module.exports = { list, get };
