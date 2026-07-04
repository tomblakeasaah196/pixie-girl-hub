/**
 * AI Insights detector registry (V2.2 §6.30).
 *
 * The declarative catalogue that scales insights to every module. Each entry
 * is a tier-1 deterministic detector: it reads the live spine (via the repo's
 * parameterised, brand-scoped source reads — never free-form SQL) and returns
 * NORMALISED findings in the unified shape the store expects:
 *
 *   { module, detector, business?, severity, title, body?, context?,
 *     amount_ngn?, source_table?, source_id?, drill_route?, suppression_key }
 *
 * `scope: 'brand'` detectors run once per brand (the runner passes `brand`);
 * `scope: 'shared'` detectors run once and return rows that already carry
 * their own `business` (or null for cross-brand findings).
 *
 * Adding a module's insights = adding an entry here + flipping the module on in
 * AI Control. No new tables, repos, or routes. `MODULE_KEYS` mirrors the 27
 * seeded in `ai_insight_modules` and is the allowlist for API `module` params.
 */

"use strict";

const repo = require("./insights.repo");
const { money } = require("../../utils/money");

// The 27 modules seeded in shared.ai_insight_modules — the API `module`
// allowlist (kept in sync with migration 000256).
const MODULE_KEYS = [
  "stock",
  "invoicing",
  "intercompany",
  "approvals",
  "service_jobs",
  "pricing",
  "hr_attendance",
  "sales",
  "crm",
  "purchasing",
  "logistics",
  "expenses",
  "production",
  "retention",
  "accounting",
  "retail_partners",
  "stylist_programme",
  "sales_campaigns",
  "marketing",
  "social_media",
  "smartcomm",
  "storefront",
  "catalogue",
  "iam_security",
  "tasks",
  "payroll",
  "customer_onboarding",
];

function overdueSeverity(days) {
  if (days >= 90) return "critical";
  if (days >= 60) return "high";
  if (days >= 30) return "medium";
  return "low";
}

// ── Detectors (ported faithfully from the category-table era) ──
const DETECTORS = [
  // ── Invoicing: overdue AR ──
  {
    module: "invoicing",
    detector: "overdue",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.overdueInvoices({ brand });
      return rows.map((inv) => {
        const days = Number(inv.days_overdue) || 0;
        return {
          module: "invoicing",
          detector: days >= 60 ? "overdue_long" : "overdue",
          business: brand,
          severity: overdueSeverity(days),
          title: `Invoice overdue ${days} day${days === 1 ? "" : "s"}`,
          body: null,
          context: {
            invoice_id: inv.invoice_id,
            customer_contact_id: inv.customer_contact_id,
            days_overdue: days,
          },
          amount_ngn: inv.net_due_ngn || null,
          source_table: "invoices",
          source_id: inv.invoice_id,
          drill_route: inv.invoice_id ? `/invoicing/${inv.invoice_id}` : "/invoicing",
          suppression_key: `overdue:${inv.invoice_id}`,
        };
      });
    },
  },

  // ── Inter-company: stale transactions (cross-brand, business = null) ──
  {
    module: "intercompany",
    detector: "pending_too_long",
    scope: "shared",
    async run() {
      const rows = await repo.staleIntercompany({ within_days: 7 });
      return rows.map((ic) => {
        const age = Number(ic.age_days) || 0;
        const severity = age >= 30 ? "critical" : age >= 14 ? "high" : "medium";
        return {
          module: "intercompany",
          detector: "pending_too_long",
          business: null,
          severity,
          title: `Inter-company item pending ${age} day${age === 1 ? "" : "s"}`,
          body: null,
          context: {
            ic_transaction_id: ic.ic_transaction_id,
            seller_brand: ic.seller_brand,
            buyer_brand: ic.buyer_brand,
            age_days: age,
          },
          amount_ngn: ic.amount_ngn || null,
          source_table: "intercompany_transactions",
          source_id: ic.ic_transaction_id,
          drill_route: "/intercompany",
          suppression_key: `stale:${ic.ic_transaction_id}`,
        };
      });
    },
  },

  // ── Approvals: workflow backlog (per-business rows from a shared query) ──
  {
    module: "approvals",
    detector: "queue_growing",
    scope: "shared",
    async run() {
      const rows = await repo.staleApprovals({ within_hours: 48 });
      return rows.map((q) => {
        const hours = Number(q.oldest_age_hours) || 0;
        const severity =
          hours >= 168 ? "critical" : hours >= 96 ? "high" : "medium";
        return {
          module: "approvals",
          detector: "queue_growing",
          business: q.business,
          severity,
          title: `${q.pending_count} approval${q.pending_count === 1 ? "" : "s"} waiting (oldest ${hours}h)`,
          body: null,
          context: {
            pending_count: q.pending_count,
            oldest_age_hours: hours,
          },
          amount_ngn: null,
          source_table: "workflow_instances",
          source_id: null,
          drill_route: "/org-workflow",
          suppression_key: `queue:${q.business}`,
        };
      });
    },
  },

  // ── Service Jobs: anti-pocketing — completed job with no linked sale ──
  {
    module: "service_jobs",
    detector: "no_sale_linked",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.unlinkedServiceJobs({ brand });
      return rows.map((job) => {
        const expected = money(job.actual_cost_ngn || job.agreed_cost_ngn || 0);
        return {
          module: "service_jobs",
          detector: "no_sale_linked",
          business: brand,
          severity: expected.gte(money("50000")) ? "high" : "medium",
          title: `Service job ${job.job_number || ""} completed with no sale`.trim(),
          body: null,
          context: {
            service_job_id: job.job_id,
            service_job_number: job.job_number,
            completed_by_stylist_id: job.assigned_stylist_id,
            completed_by_user_id: job.assigned_staff_user_id,
            expected_amount_ngn: expected.gt(0) ? expected.toFixed(2) : null,
          },
          amount_ngn: expected.gt(0) ? expected.toFixed(2) : null,
          source_table: "service_jobs",
          source_id: job.job_id,
          drill_route: job.job_id ? `/service-jobs?job=${job.job_id}` : "/service-jobs",
          suppression_key: `no_sale:${job.job_id}`,
        };
      });
    },
  },

  // ── Service Jobs: Flow-1 — cross-entity job with no inter-company match ──
  {
    module: "service_jobs",
    detector: "no_intercompany_match",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.intercompanyJobsMissingMatch({ brand });
      return rows.map((job) => {
        const expected = money(job.actual_cost_ngn || job.agreed_cost_ngn || 0);
        return {
          module: "service_jobs",
          detector: "no_intercompany_match",
          business: brand,
          severity: job.status === "completed" ? "high" : "medium",
          title: `Cross-entity job ${job.job_number || ""} has no inter-company invoice`.trim(),
          body: null,
          context: {
            service_job_id: job.job_id,
            service_job_number: job.job_number,
            completed_by_stylist_id: job.assigned_stylist_id,
            completed_by_user_id: job.assigned_staff_user_id,
            expected_amount_ngn: expected.gt(0) ? expected.toFixed(2) : null,
            job_status: job.status,
          },
          amount_ngn: expected.gt(0) ? expected.toFixed(2) : null,
          source_table: "service_jobs",
          source_id: job.job_id,
          drill_route: job.job_id ? `/service-jobs?job=${job.job_id}` : "/service-jobs",
          suppression_key: `no_ic:${job.job_id}`,
        };
      });
    },
  },
  // ── Attendance: off-site clock-in (reconciled attendance_days) ──
  {
    module: "hr_attendance",
    detector: "off_site",
    scope: "shared",
    async run() {
      const rows = await repo.offsiteAttendance({ within_days: 7 });
      return rows.map((r) => {
        const dist = Number(r.offsite_distance_m) || 0;
        const date = new Date(r.work_date).toISOString().slice(0, 10);
        return {
          module: "hr_attendance",
          detector: "off_site",
          business: r.business,
          severity: dist >= 1000 ? "high" : "medium",
          title: `Off-site clock-in${dist ? ` (${Math.round(dist)}m away)` : ""}`,
          body: `Recorded ${date}.`,
          context: {
            profile_id: r.profile_id,
            work_date: date,
            offsite_distance_m: r.offsite_distance_m,
          },
          amount_ngn: null,
          source_table: "attendance_days",
          source_id: r.profile_id,
          drill_route: "/hr",
          suppression_key: `offsite:${r.profile_id}:${date}`,
        };
      });
    },
  },

  // ── Purchasing: PO delivery overdue ──
  {
    module: "purchasing",
    detector: "delivery_overdue",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.overduePurchaseOrders({ brand });
      return rows.map((po) => {
        const days = Number(po.days_overdue) || 0;
        return {
          module: "purchasing",
          detector: "delivery_overdue",
          business: brand,
          severity: days >= 30 ? "critical" : days >= 14 ? "high" : "medium",
          title: `PO ${po.po_number} delivery overdue ${days} day${days === 1 ? "" : "s"}`,
          body: null,
          context: {
            po_id: po.po_id,
            po_number: po.po_number,
            supplier_id: po.supplier_id,
            days_overdue: days,
          },
          amount_ngn: po.total_ngn || null,
          source_table: "purchase_orders",
          source_id: po.po_id,
          drill_route: "/purchasing",
          suppression_key: `po_overdue:${po.po_id}`,
        };
      });
    },
  },

  // ── Logistics: failed / lost / overdue deliveries ──
  {
    module: "logistics",
    detector: "delivery_problem",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.problemDeliveries({ brand });
      const FAILED = new Set([
        "attempted_failed",
        "lost",
        "damaged",
        "returned_to_sender",
      ]);
      return rows.map((d) => {
        const failed = FAILED.has(d.status);
        const overdueH = Number(d.overdue_hours) || 0;
        const severity =
          d.status === "lost" || d.status === "damaged"
            ? "critical"
            : failed
              ? "high"
              : overdueH >= 48
                ? "high"
                : "medium";
        return {
          module: "logistics",
          detector: failed ? "delivery_failed" : "delivery_overdue",
          business: brand,
          severity,
          title: failed
            ? `Delivery ${d.delivery_number} ${String(d.status).replace(/_/g, " ")}`
            : `Delivery ${d.delivery_number} overdue`,
          body: null,
          context: {
            delivery_id: d.delivery_id,
            delivery_number: d.delivery_number,
            order_id: d.order_id,
            status: d.status,
          },
          amount_ngn: d.pod_amount_expected_ngn || null,
          source_table: "deliveries",
          source_id: d.delivery_id,
          drill_route: "/logistics",
          suppression_key: `del:${d.delivery_id}`,
        };
      });
    },
  },

  // ── Expenses: unsettled / overdue cash advances ──
  {
    module: "expenses",
    detector: "advance_unsettled",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.unsettledAdvances({ brand });
      return rows.map((a) => {
        const days = Number(a.age_days) || 0;
        const overdue = a.status === "overdue_settlement";
        return {
          module: "expenses",
          detector: overdue ? "advance_overdue" : "advance_ageing",
          business: brand,
          severity: overdue || days >= 30 ? "high" : "medium",
          title: `Advance ${a.advance_number} unsettled${days ? ` ${days} day${days === 1 ? "" : "s"}` : ""}`,
          body: a.purpose ? `Purpose: ${a.purpose}.` : null,
          context: {
            advance_id: a.advance_id,
            advance_number: a.advance_number,
            purpose: a.purpose,
            status: a.status,
            age_days: days,
          },
          amount_ngn: a.amount_ngn || null,
          source_table: "cash_advances",
          source_id: a.advance_id,
          drill_route: "/expenses",
          suppression_key: `adv:${a.advance_id}`,
        };
      });
    },
  },
];

function detectorsForModules(enabledSet) {
  return DETECTORS.filter((d) => enabledSet.has(d.module));
}

module.exports = { MODULE_KEYS, DETECTORS, detectorsForModules, overdueSeverity };
