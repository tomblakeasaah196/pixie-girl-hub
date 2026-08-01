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
const dashboardsMetricsRepo = require("../dashboards/dashboards.metrics.repo");
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
const campaignsRepo = require("../sales_campaigns/campaigns.repo");
const perfInsights = require("../../shared/hr_payroll/insights.service");

const str = (v) => (typeof v === "string" && v ? v : null);

const QUERIES = [
  {
    key: "insights_open",
    title: "Open insights / what needs attention",
    description:
      "Open AI-insight counts per module for the current brand (overdue invoices, low stock, unpaid settlements, unanswered messages, and more), PLUS a sample of the individual affected records behind those counts — so root-cause / 'which records' / 'what should I do first' follow-ups can already be answered from this SAME call, without a second tool call. Use this for 'what needs my attention?', 'any alerts?', 'what's wrong today?', and for detail/root-cause follow-ups about those counts.",
    module: "ai_insights",
    parameters: { type: "object", properties: {} },
    run: async ({ brand }) => {
      const [summary, records] = await Promise.all([
        insightsRepo.summary({ business: brand }),
        insightsRepo.list({ business: brand, status: "open", page: 1, page_size: 60 }),
      ]);
      return { summary, records };
    },
  },
  {
    key: "insights_list",
    title: "Open insight details (drill-down, filterable)",
    description:
      "Individual open AI-insight records for the current brand — each one names the specific affected record (order, invoice, staff member, etc.), its severity, and supporting context (why it was raised). insights_open already includes a sample of these; call insights_list instead when you need to FILTER by one module or by severity, or need more than insights_open's sample.",
    module: "ai_insights",
    parameters: {
      type: "object",
      properties: {
        module: {
          type: "string",
          description:
            "Restrict to one module's insights, e.g. 'sales', 'stock', 'invoicing', 'purchasing', 'expenses', 'hr_attendance', 'crm', 'production', 'accounting', 'retention', 'pricing', 'logistics', 'approvals', 'intercompany', 'catalogue' (optional — omit for all modules).",
        },
        severity: {
          type: "string",
          description: "Filter by severity: low, medium, high, critical (optional).",
        },
        limit: {
          type: "integer",
          description: "Max insights to return (optional; default 50, max 200).",
        },
      },
    },
    run: ({ brand, args }) => {
      const limit =
        Number.isInteger(args.limit) && args.limit > 0
          ? Math.min(args.limit, 200)
          : 50;
      return insightsRepo.list({
        module: str(args.module) || undefined,
        business: brand,
        status: "open",
        severity: str(args.severity) || undefined,
        page: 1,
        page_size: limit,
      });
    },
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
    key: "top_products",
    title: "Best-selling products",
    description:
      "Top-selling products for the current brand by revenue over a date range — units sold and revenue per product. Defaults to year-to-date if no range is given. Use this for 'best seller', 'top product(s)', 'what's selling' questions instead of sql_schema/sql_query.",
    module: "dashboards",
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description:
            "ISO date/time lower bound (optional; defaults to 1 Jan of the current year).",
        },
        to: {
          type: "string",
          description: "ISO date/time upper bound (optional; defaults to now).",
        },
        limit: {
          type: "integer",
          description: "Max products to return (optional; default 10, max 50).",
        },
      },
    },
    run: ({ brand, args }) => {
      const now = new Date();
      const from =
        str(args.from) || new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
      const to = str(args.to) || now.toISOString();
      const limit =
        Number.isInteger(args.limit) && args.limit > 0
          ? Math.min(args.limit, 50)
          : 10;
      return dashboardsMetricsRepo.topProducts({ brand, from, to, limit });
    },
  },
  {
    key: "top_customers",
    title: "Top customers by spend",
    description:
      "Highest-spending customers for the current brand over a date range — each customer's paid order count and total spend (NGN). Defaults to the CURRENT MONTH if no range is given. Use this for 'top/best customers', 'who spends the most', 'biggest customers this month' questions instead of sql_schema/sql_query.",
    module: "dashboards",
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description:
            "ISO date/time lower bound (optional; defaults to the 1st of the current month).",
        },
        to: {
          type: "string",
          description: "ISO date/time upper bound (optional; defaults to now).",
        },
        limit: {
          type: "integer",
          description: "Max customers to return (optional; default 10, max 50).",
        },
      },
    },
    run: async ({ brand, args }) => {
      const now = new Date();
      const from =
        str(args.from) ||
        new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        ).toISOString();
      const to = str(args.to) || now.toISOString();
      const limit =
        Number.isInteger(args.limit) && args.limit > 0
          ? Math.min(args.limit, 50)
          : 10;
      // Existing repo method returns { rows }; unwrap to a plain array so the
      // model gets the customer list directly (matches top_products' shape).
      const { rows } = await dashboardsMetricsRepo.topCustomers({
        brand,
        from,
        to,
        limit,
      });
      return rows;
    },
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
    module: "cash_request",
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
    module: "cash_request",
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
  {
    key: "campaigns_recent",
    title: "Recent / current sales campaigns",
    description:
      "The brand's sales campaigns, most recent first: campaign_id, name, slug, status and start/end dates. Use this to answer 'when was our last campaign?', to see what's live now, or to find a campaign's id (campaign_id) before calling any sales_campaigns action.",
    module: "sales_campaigns",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "Optional status filter (comma-separated): draft, pending_approval, scheduled, live, paused, ended, archived.",
        },
      },
    },
    run: async ({ brand, args }) => {
      const r = await campaignsRepo.findAll({
        brand,
        scope: "all",
        filters: { status: str(args.status) || undefined },
        page: 1,
        page_size: 10,
        offset: 0,
      });
      // Compact projection — the model needs identifiers + timeline, not the
      // whole row (landing blocks, voice profiles, etc. would blow the prompt).
      return (r.data || []).map((c) => ({
        campaign_id: c.campaign_id,
        name: c.name,
        slug: c.slug,
        status: c.status,
        starts_at: c.starts_at,
        ends_at: c.ends_at,
        created_at: c.created_at,
      }));
    },
  },
  {
    key: "performance_sales_exec",
    title: "Sales exec of the month (who closed the most sales)",
    description:
      "The sales-rep leaderboard for a period: who CLOSED how many sales, each rep's share of ALL sales, and the value they closed — plus the month's winner (Sales Exec of the Month) and the channel mix. Website / storefront self-service checkouts are counted in the total but bucketed as 'Online / self-service (unattributed)' — credited to no individual. Use this for 'who closed the most sales?', 'who is sales exec of the month?', 'how many sales did <rep> close out of the total?', 'which channel drives our sales?'. Defaults to the current calendar month.",
    module: "performance",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Optional start date (YYYY-MM-DD). Defaults to the 1st of the current month." },
        to: { type: "string", description: "Optional end date (YYYY-MM-DD), inclusive. Defaults to month-end." },
      },
    },
    run: ({ brand, args }) =>
      perfInsights.salesReport({
        brand,
        from: str(args.from) || undefined,
        to: str(args.to) || undefined,
        withCompare: true,
      }),
  },
  {
    key: "performance_attendance",
    title: "Attendance report (present / late / absent + on-time %)",
    description:
      "Per-staff attendance summary for a period from the reconciled attendance days: present, late, absent, on-leave and off-site day counts, total minutes late, hours worked, and each person's on-time % (punctual days ÷ present days). Use this for 'how was attendance this month?', 'who was late the most?', 'what is <person>'s on-time percentage?', 'who has the best attendance?'. Defaults to the current calendar month.",
    module: "performance",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Optional start date (YYYY-MM-DD). Defaults to the 1st of the current month." },
        to: { type: "string", description: "Optional end date (YYYY-MM-DD), inclusive. Defaults to month-end." },
      },
    },
    run: ({ brand, args }) =>
      perfInsights.attendanceReport({
        brand,
        from: str(args.from) || undefined,
        to: str(args.to) || undefined,
      }),
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
