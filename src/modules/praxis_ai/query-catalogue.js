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
const cashRequestRepo = require("../cash_request/cash-request.repo");
const hrService = require("../../shared/hr_payroll/hr_ops.service");
const hrRepo = require("../../shared/hr_payroll/hr_ops.repo");

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
  {
    key: "cash_requests_pending",
    title: "Pending cash requests",
    description:
      "Cash requests awaiting approval (pending_finance or pending_ceo) for the current brand, ordered by submission date.",
    module: "expenses",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "Filter by specific status (optional). One of: pending_finance, pending_ceo, approved, disbursed, settled.",
        },
      },
    },
    run: ({ brand, args }) =>
      cashRequestRepo.findAll({
        brand,
        scope: "all",
        user_id: null,
        filters: { status: str(args.status) || "pending_finance" },
        page: 1,
        page_size: 20,
      }),
  },
  {
    key: "cash_request_kpis",
    title: "Cash request KPIs",
    description:
      "Summary KPIs for cash requests: pending count, unsettled advances, disbursed this month.",
    module: "expenses",
    parameters: { type: "object", properties: {} },
    run: ({ brand }) =>
      cashRequestRepo.kpis({ brand, scope: "all", user_id: null }),
  },
  {
    key: "hr_overview",
    title: "HR overview",
    description:
      "Staff headcount and today's HR snapshot: present, late, on leave, pending leave and open queries.",
    module: "hr_payroll",
    parameters: { type: "object", properties: {} },
    run: ({ brand }) => hrService.getOverview({ brand }),
  },
  {
    key: "hr_analytics",
    title: "HR analytics (month-to-date)",
    description:
      "Month-to-date HR metrics: headcount, punctuality %, late/absent/leave/off-site days, lateness deductions, open queries, target progress and earnings.",
    module: "hr_payroll",
    parameters: { type: "object", properties: {} },
    run: ({ brand }) => hrService.getAnalytics({ brand }),
  },
  {
    key: "hr_attendance_today",
    title: "Attendance today",
    description:
      "Today's reconciled attendance rows for the brand (who is present, late, absent, on leave or off-site).",
    module: "hr_payroll",
    parameters: { type: "object", properties: {} },
    run: ({ brand }) => {
      const today = new Date().toISOString().slice(0, 10);
      return hrRepo.listAttendanceDays({ brand, filters: { from: today, to: today } });
    },
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
