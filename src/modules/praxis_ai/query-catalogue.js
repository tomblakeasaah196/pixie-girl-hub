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
const stockRepo = require("../stock/stock.repo");
const invoicingRepo = require("../invoicing/invoicing.repo");
const logisticsRepo = require("../logistics/logistics.repo");
const purchasingRepo = require("../purchasing/purchasing.repo");
const contactsRepo = require("../../shared/contacts/contacts.repo");
const crmRepo = require("../crm/crm.repo");
const insightsRepo = require("../ai_insights/insights.repo");

const str = (v) => (typeof v === "string" && v ? v : null);

const QUERIES = [
  {
    key: "insights_open",
    title: "Open insights / what needs attention",
    description:
      "Open AI-insight counts per module for the current brand — overdue invoices, low stock, unpaid settlements, unanswered messages, and more. Use this when asked 'what needs my attention?', 'any alerts?', or 'what's wrong today?'.",
    module: "ai_insights",
    parameters: { type: "object", properties: {} },
    run: ({ brand }) => insightsRepo.summary({ business: brand }),
  },
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
  {
    key: "hr_employee_360",
    title: "Employee 360 (dossier)",
    description:
      "Everything about one employee: profile & employment terms, attendance insights (earliest/latest arrival, punctuality, days at risk), earnings & payslips, targets & bonuses, queries, leave, contracts and appraisals. Requires the employee's profile_id.",
    module: "hr_payroll",
    parameters: {
      type: "object",
      properties: {
        profile_id: { type: "string", description: "The employee's staff profile_id (UUID)." },
      },
      required: ["profile_id"],
    },
    // user is threaded through so PII masking is inherited (non-CEO callers
    // still get bank/NIN masked).
    run: ({ brand, args, user }) =>
      hrService.getEmployee360({ brand, user, profileId: args.profile_id }),
  },
  {
    key: "stock_alerts",
    title: "Stock alerts (low / out of stock)",
    description:
      "Current inventory alerts for the brand — low-stock and out-of-stock warnings by variant/location.",
    module: "stock",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter by alert status, e.g. 'open' (optional).",
        },
      },
    },
    run: ({ brand, args }) =>
      stockRepo.listAlerts({
        brand,
        page: 1,
        page_size: 50,
        offset: 0,
        filters: { status: str(args.status) || undefined },
      }),
  },
  {
    key: "invoices_outstanding",
    title: "Outstanding invoices (accounts receivable)",
    description:
      "Invoices for the brand filtered by status (default 'overdue') — use for who owes money / AR.",
    module: "invoicing",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "Invoice status: draft, sent, viewed, partially_paid, paid, overdue, void (optional; default overdue).",
        },
      },
    },
    run: ({ brand, args }) =>
      invoicingRepo.listInvoices({
        brand,
        filters: { status: str(args.status) || "overdue" },
        page: 1,
        page_size: 25,
        offset: 0,
      }),
  },
  {
    key: "deliveries_by_status",
    title: "Deliveries",
    description:
      "Logistics deliveries for the brand by status (queued, booked, in_transit, out_for_delivery, delivered, returned, cancelled). Default 'queued'.",
    module: "logistics",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Delivery status (optional; default 'queued').",
        },
      },
    },
    run: ({ brand, args }) =>
      logisticsRepo.listDeliveries({
        brand,
        filters: { status: str(args.status) || "queued" },
        page: 1,
        page_size: 25,
        offset: 0,
      }),
  },
  {
    key: "purchase_orders",
    title: "Purchase orders",
    description:
      "Supplier purchase orders for the brand — open/active by default, or filter by a specific status.",
    module: "purchasing",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "PO status (optional). If omitted, returns open/active POs.",
        },
      },
    },
    run: ({ brand, args }) => {
      const status = str(args.status);
      return purchasingRepo.listPos({
        brand,
        filters: status ? { status } : { open: true },
        page: 1,
        page_size: 25,
        offset: 0,
      });
    },
  },
  {
    key: "contacts_overview",
    title: "Contacts overview",
    description:
      "Contact-base stats for the brand: total contacts, VIPs, new this month, and at-risk count.",
    module: "contacts",
    parameters: { type: "object", properties: {} },
    run: ({ brand }) => contactsRepo.stats({ brand }),
  },
  {
    key: "crm_pipeline",
    title: "CRM pipeline KPIs",
    description:
      "Sales pipeline KPIs for the brand: open deals and value, deals won this month and value, and overall win totals.",
    module: "crm",
    parameters: { type: "object", properties: {} },
    run: ({ brand }) => crmRepo.kpis({ brand }),
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
