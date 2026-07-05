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

  // ── Purchasing: PO submitted for approval but untouched ──
  {
    module: "purchasing",
    detector: "approval_stalled",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.stalledPurchaseApprovals({ brand });
      return rows.map((po) => {
        const days = Number(po.days_waiting) || 0;
        return {
          module: "purchasing",
          detector: "approval_stalled",
          business: brand,
          severity: days >= 14 ? "high" : "medium",
          title: `PO ${po.po_number} awaiting approval ${days} day${days === 1 ? "" : "s"}`,
          body: null,
          context: {
            po_id: po.po_id,
            po_number: po.po_number,
            supplier_id: po.supplier_id,
            days_waiting: days,
          },
          amount_ngn: po.total_ngn || null,
          source_table: "purchase_orders",
          source_id: po.po_id,
          drill_route: "/purchasing",
          suppression_key: `po_approval:${po.po_id}`,
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

  // ── Sales: paid orders not dispatched (fulfilment delay) ──
  {
    module: "sales",
    detector: "fulfillment_delayed",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.fulfillmentDelayedOrders({ brand });
      return rows.map((o) => {
        const days = Number(o.age_days) || 0;
        return {
          module: "sales",
          detector: "fulfillment_delayed",
          business: brand,
          severity: days >= 14 ? "critical" : days >= 7 ? "high" : "medium",
          title: `Order ${o.order_number} paid but not dispatched (${days}d)`,
          body: null,
          context: {
            order_id: o.order_id,
            order_number: o.order_number,
            contact_id: o.contact_id,
            status: o.status,
            age_days: days,
          },
          amount_ngn: o.total_ngn || null,
          source_table: "sales_orders",
          source_id: o.order_id,
          drill_route: o.order_id ? `/sales/orders/${o.order_id}` : "/sales",
          suppression_key: `fulfil:${o.order_id}`,
        };
      });
    },
  },

  // ── CRM: open deals stalled in stage ──
  {
    module: "crm",
    detector: "deal_stalled",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.stalledDeals({ brand });
      return rows.map((d) => {
        const days = Number(d.days_in_stage) || 0;
        return {
          module: "crm",
          detector: "deal_stalled",
          business: brand,
          severity: days >= 30 ? "high" : "medium",
          title: `Deal "${d.title}" stalled ${days} days in stage`,
          body: null,
          context: {
            deal_id: d.deal_id,
            current_stage_id: d.current_stage_id,
            days_in_stage: days,
          },
          amount_ngn: d.expected_value_ngn || null,
          source_table: "crm_deals",
          source_id: d.deal_id,
          drill_route: d.deal_id ? `/crm/deals/${d.deal_id}` : "/crm",
          suppression_key: `stalled:${d.deal_id}`,
        };
      });
    },
  },

  // ── Production: run arrival overdue ──
  {
    module: "production",
    detector: "run_delayed",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.delayedProductionRuns({ brand });
      return rows.map((r) => {
        const days = Number(r.days_late) || 0;
        return {
          module: "production",
          detector: "run_delayed",
          business: brand,
          severity: days >= 14 ? "critical" : days >= 7 ? "high" : "medium",
          title: `Run ${r.run_number} arrival overdue ${days} day${days === 1 ? "" : "s"}`,
          body: `Status: ${String(r.status).replace(/_/g, " ")}.`,
          context: {
            run_id: r.run_id,
            run_number: r.run_number,
            status: r.status,
            days_late: days,
          },
          amount_ngn: r.total_landed_cost_ngn || null,
          source_table: "production_runs",
          source_id: r.run_id,
          drill_route: "/production",
          suppression_key: `run_late:${r.run_id}`,
        };
      });
    },
  },

  // ── Accounting: draft journals left unposted ──
  {
    module: "accounting",
    detector: "journal_draft_aging",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.agingDraftJournals({ brand });
      return rows.map((j) => {
        const days = Number(j.age_days) || 0;
        return {
          module: "accounting",
          detector: "journal_draft_aging",
          business: brand,
          severity: days >= 30 ? "high" : "medium",
          title: `Draft journal ${j.entry_number} unposted ${days} days`,
          body: j.description || null,
          context: {
            entry_id: j.entry_id,
            entry_number: j.entry_number,
            age_days: days,
          },
          amount_ngn: null,
          source_table: "journal_entries",
          source_id: j.entry_id,
          drill_route: "/accounting",
          suppression_key: `je_draft:${j.entry_id}`,
        };
      });
    },
  },

  // ── Retention: contacts at high churn risk ──
  {
    module: "retention",
    detector: "churn_risk",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.churnRiskContacts({ brand });
      return rows.map((c) => ({
        module: "retention",
        detector: "churn_risk",
        business: brand,
        severity: c.risk_band === "critical" ? "critical" : "high",
        title: `High churn risk (score ${c.risk_score})`,
        body: null,
        context: {
          contact_id: c.contact_id,
          risk_score: c.risk_score,
          risk_band: c.risk_band,
        },
        amount_ngn: null,
        source_table: "churn_risk_scores",
        source_id: c.contact_id,
        drill_route: c.contact_id ? `/contacts/${c.contact_id}` : "/retention",
        suppression_key: `churn:${c.contact_id}`,
      }));
    },
  },

  // ── Pricing: price below cost (any channel) / below floor (storefront) ──
  // One finding per (variant, channel). Superseded storefront-only findings
  // (old `margin:<variant>` keys) auto-resolve on the first sweep after this
  // ships and re-raise channel-scoped.
  {
    module: "pricing",
    detector: "margin_breach",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.marginBreaches({ brand });
      return rows.map((v) => {
        const cost = money(v.cost_price_ngn || 0);
        const price = money(v.price_ngn || 0);
        const floor = money(v.min_price_ngn || 0);
        const belowCost = price.lt(cost);
        const severity = belowCost
          ? price.lt(cost.times("0.9"))
            ? "critical"
            : "high"
          : "medium";
        return {
          module: "pricing",
          detector: belowCost ? "price_below_cost" : "price_below_floor",
          business: brand,
          severity,
          title: `${v.sku || v.product_name} below ${belowCost ? "cost" : "floor"} on ${v.channel}`,
          body: `${v.channel} ₦${price.toFixed(2)} vs ${belowCost ? "cost" : "floor"} ₦${(belowCost ? cost : floor).toFixed(2)}.`,
          context: {
            variant_id: v.variant_id,
            product_id: v.product_id,
            sku: v.sku,
            channel: v.channel,
            cost_price_ngn: v.cost_price_ngn,
            min_price_ngn: v.min_price_ngn,
            price_ngn: v.price_ngn,
          },
          amount_ngn: v.price_ngn || null,
          source_table: "product_variants",
          source_id: v.variant_id,
          drill_route: "/pricing",
          suppression_key: `margin:${v.variant_id}:${v.channel}`,
        };
      });
    },
  },

  // ── Retail partners: disputed / unpaid settlements ──
  {
    module: "retail_partners",
    detector: "settlement_unpaid",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.unpaidPartnerSettlements({ brand });
      return rows.map((s) => {
        const days = Number(s.age_days) || 0;
        const disputed = s.status === "disputed";
        return {
          module: "retail_partners",
          detector: disputed ? "settlement_disputed" : "settlement_unpaid",
          business: brand,
          severity: disputed || days >= 30 ? "high" : "medium",
          title: disputed
            ? `Settlement ${s.settlement_number} disputed`
            : `Settlement ${s.settlement_number} unpaid ${days} day${days === 1 ? "" : "s"}`,
          body: null,
          context: {
            settlement_id: s.settlement_id,
            settlement_number: s.settlement_number,
            partner_id: s.partner_id,
            status: s.status,
            age_days: days,
          },
          amount_ngn: s.total_partner_share_ngn || null,
          source_table: "partner_settlements",
          source_id: s.settlement_id,
          drill_route: "/retail-partners",
          suppression_key: `settle:${s.settlement_id}`,
        };
      });
    },
  },

  // ── Tasks: overdue open tasks ──
  {
    module: "tasks",
    detector: "overdue",
    scope: "shared",
    async run() {
      const rows = await repo.overdueTasks({});
      return rows.map((tk) => {
        const days = Number(tk.days_overdue) || 0;
        const severity =
          tk.priority === "urgent"
            ? "high"
            : tk.priority === "high" || days >= 7
              ? "medium"
              : "low";
        return {
          module: "tasks",
          detector: "overdue",
          business: tk.business,
          severity,
          title: `Task overdue ${days} day${days === 1 ? "" : "s"}: ${tk.title}`,
          body: null,
          context: {
            task_id: tk.task_id,
            priority: tk.priority,
            assigned_to: tk.assigned_to,
            days_overdue: days,
          },
          amount_ngn: null,
          source_table: "tasks",
          source_id: tk.task_id,
          drill_route: "/workspace",
          suppression_key: `task_overdue:${tk.task_id}`,
        };
      });
    },
  },

  // ── Stylist programme: unpaid / failed stylist payouts (cross-brand) ──
  {
    module: "stylist_programme",
    detector: "payout_unpaid",
    scope: "shared",
    async run() {
      const rows = await repo.pendingStylistPayouts({});
      return rows.map((p) => {
        const days = Number(p.age_days) || 0;
        const failed = p.status === "failed";
        return {
          module: "stylist_programme",
          detector: failed ? "payout_failed" : "payout_unpaid",
          business: null,
          severity: failed || days >= 14 ? "high" : "medium",
          title: failed
            ? `Stylist payout ${p.payout_number} failed`
            : `Stylist payout ${p.payout_number} unpaid ${days} day${days === 1 ? "" : "s"}`,
          body: null,
          context: {
            payout_id: p.payout_id,
            payout_number: p.payout_number,
            stylist_id: p.stylist_id,
            status: p.status,
            age_days: days,
          },
          amount_ngn: p.amount_ngn || null,
          source_table: "stylist_payouts",
          source_id: p.payout_id,
          drill_route: "/stylists",
          suppression_key: `payout:${p.payout_id}`,
        };
      });
    },
  },

  // ── Sales campaigns: live past end, or scheduled past start ──
  {
    module: "sales_campaigns",
    detector: "campaign_stuck",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.stuckCampaigns({ brand });
      return rows.map((c) => {
        const overrun = c.status === "live";
        const days = Number(c.days_past_end) || 0;
        return {
          module: "sales_campaigns",
          detector: overrun ? "ended_not_closed" : "scheduled_not_launched",
          business: brand,
          severity: "medium",
          title: overrun
            ? `Campaign "${c.name}" past its end but still live`
            : `Campaign "${c.name}" scheduled but not launched`,
          body: null,
          context: {
            campaign_id: c.campaign_id,
            status: c.status,
            days_past_end: overrun ? days : null,
          },
          amount_ngn: null,
          source_table: "sales_campaigns",
          source_id: c.campaign_id,
          drill_route: c.campaign_id
            ? `/sales-campaigns/${c.campaign_id}`
            : "/sales-campaigns",
          suppression_key: `campaign:${c.campaign_id}`,
        };
      });
    },
  },

  // ── Marketing: active ad spend with zero conversions (last 7 days) ──
  {
    module: "marketing",
    detector: "ad_no_conversions",
    scope: "shared",
    async run() {
      const rows = await repo.wastefulAdCampaigns({});
      return rows.map((a) => {
        const spend = money(a.spend_ngn || 0);
        return {
          module: "marketing",
          detector: "ad_no_conversions",
          business: a.business,
          severity: spend.gte(money("50000")) ? "high" : "medium",
          title: `Ad "${a.name}" — ₦${spend.toFixed(2)} spent, 0 conversions (7d)`,
          body: null,
          context: {
            ad_campaign_id: a.ad_campaign_id,
            spend_ngn: a.spend_ngn,
            conversions: a.conversions,
          },
          amount_ngn: a.spend_ngn || null,
          source_table: "ad_campaigns",
          source_id: a.ad_campaign_id,
          drill_route: "/marketing",
          suppression_key: `ad_waste:${a.ad_campaign_id}`,
        };
      });
    },
  },

  // ── Smartcomm: customer thread unanswered past SLA ──
  {
    module: "smartcomm",
    detector: "unanswered",
    scope: "shared",
    async run() {
      const rows = await repo.unansweredThreads({ hours: 4 });
      return rows.map((c) => {
        const hrs = Number(c.hours_waiting) || 0;
        return {
          module: "smartcomm",
          detector: "unanswered",
          business: c.business,
          severity: hrs >= 24 ? "high" : "medium",
          title: `Unanswered ${c.external_platform || "message"} — waiting ${hrs}h`,
          body: null,
          context: {
            channel_id: c.channel_id,
            platform: c.external_platform,
            hours_waiting: hrs,
          },
          amount_ngn: null,
          source_table: "message_channels",
          source_id: c.channel_id,
          drill_route: c.channel_id
            ? `/smartcomm?channel=${c.channel_id}`
            : "/smartcomm",
          suppression_key: `unanswered:${c.channel_id}`,
        };
      });
    },
  },

  // ── Social: failed / overdue scheduled posts ──
  {
    module: "social_media",
    detector: "post_failed",
    scope: "shared",
    async run() {
      const rows = await repo.failedSocialPosts({});
      return rows.map((p) => ({
        module: "social_media",
        detector: p.status === "failed" ? "post_failed" : "post_overdue",
        business: p.business,
        severity: "medium",
        title:
          p.status === "failed"
            ? "Scheduled post failed to publish"
            : "Scheduled post is overdue",
        body: null,
        context: { post_id: p.post_id, status: p.status, scheduled_for: p.scheduled_for },
        amount_ngn: null,
        source_table: "social_posts",
        source_id: p.post_id,
        drill_route: "/social",
        suppression_key: `post:${p.post_id}`,
      }));
    },
  },

  // ── Social: access token expiring (publishing will break) ──
  {
    module: "social_media",
    detector: "token_expiring",
    scope: "shared",
    async run() {
      const rows = await repo.expiringSocialTokens({});
      return rows.map((a) => {
        const days = Number(a.days_left) || 0;
        return {
          module: "social_media",
          detector: "token_expiring",
          business: a.business,
          severity: days <= 1 ? "high" : "medium",
          title: `${a.platform} token expires in ${days} day${days === 1 ? "" : "s"}`,
          body: "Re-authorise the account before it stops publishing.",
          context: { account_id: a.account_id, platform: a.platform, days_left: days },
          amount_ngn: null,
          source_table: "social_accounts",
          source_id: a.account_id,
          drill_route: "/social",
          suppression_key: `token:${a.account_id}`,
        };
      });
    },
  },

  // ── Storefront: recent failed order payments ──
  {
    module: "storefront",
    detector: "payment_failed",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.failedStorefrontPayments({ brand });
      return rows.map((p) => {
        const hrs = Number(p.hours_ago) || 0;
        return {
          module: "storefront",
          detector: "payment_failed",
          business: brand,
          severity: hrs <= 24 ? "high" : "medium",
          title: `Checkout payment failed${p.method ? ` (${p.method})` : ""}`,
          body: p.failure_reason || null,
          context: {
            payment_id: p.payment_id,
            order_id: p.order_id,
            method: p.method,
            hours_ago: hrs,
          },
          amount_ngn: p.amount_ngn || null,
          source_table: "sales_order_payments",
          source_id: p.payment_id,
          drill_route: p.order_id ? `/sales/orders/${p.order_id}` : "/sales",
          suppression_key: `pay_fail:${p.payment_id}`,
        };
      });
    },
  },

  // ── IAM / Security: access reviews overdue (Hub-level governance) ──
  {
    module: "iam_security",
    detector: "access_review_overdue",
    scope: "shared",
    async run() {
      const rows = await repo.overdueAccessReviews({});
      return rows.map((r) => {
        const days = Number(r.days_overdue) || 0;
        return {
          module: "iam_security",
          detector: "access_review_overdue",
          business: null,
          severity: days >= 30 ? "high" : "medium",
          title: `Access review overdue ${days} day${days === 1 ? "" : "s"}`,
          body: null,
          context: { review_id: r.review_id, status: r.status, days_overdue: days },
          amount_ngn: null,
          source_table: "access_reviews",
          source_id: r.review_id,
          drill_route: "/iam-security/reviews",
          suppression_key: `review:${r.review_id}`,
        };
      });
    },
  },

  // ── Payroll: staff contracts expiring within 30 days ──
  {
    module: "payroll",
    detector: "contract_expiring",
    scope: "shared",
    async run() {
      const rows = await repo.expiringContracts({});
      return rows.map((c) => {
        const days = Number(c.days_left) || 0;
        return {
          module: "payroll",
          detector: "contract_expiring",
          business: c.business,
          severity: days <= 7 ? "high" : "medium",
          title: `Staff contract expires in ${days} day${days === 1 ? "" : "s"}`,
          body: null,
          context: {
            contract_id: c.contract_id,
            profile_id: c.profile_id,
            contract_type: c.contract_type,
            days_left: days,
          },
          amount_ngn: null,
          source_table: "staff_contracts",
          source_id: c.contract_id,
          drill_route: "/payroll",
          suppression_key: `contract:${c.contract_id}`,
        };
      });
    },
  },

  // ── Customer onboarding: submissions never linked to a contact ──
  {
    module: "customer_onboarding",
    detector: "onboarding_stalled",
    scope: "shared",
    async run() {
      const rows = await repo.stalledOnboarding({});
      return rows.map((s) => {
        const days = Number(s.age_days) || 0;
        return {
          module: "customer_onboarding",
          detector: "onboarding_stalled",
          business: s.business,
          severity: days >= 7 ? "medium" : "low",
          title: `Onboarding submission unprocessed ${days} day${days === 1 ? "" : "s"}`,
          body: "Not yet linked to a contact.",
          context: { submission_id: s.submission_id, age_days: days },
          amount_ngn: null,
          source_table: "customer_onboarding_submissions",
          source_id: s.submission_id,
          drill_route: "/contacts",
          suppression_key: `onboard:${s.submission_id}`,
        };
      });
    },
  },

  // ── Catalogue: products visible on the storefront but not buyable ──
  {
    module: "catalogue",
    detector: "visible_unbuyable",
    scope: "brand",
    async run({ brand }) {
      const rows = await repo.unbuyableProducts({ brand });
      return rows.map((p) => ({
        module: "catalogue",
        detector: "visible_unbuyable",
        business: brand,
        severity: "medium",
        title: `"${p.name}" is visible but has no priced variant`,
        body: "Customers can see it but can't buy it.",
        context: { product_id: p.product_id },
        amount_ngn: null,
        source_table: "products",
        source_id: p.product_id,
        drill_route: p.product_id ? `/catalogue/styled/${p.product_id}` : "/catalogue",
        suppression_key: `unbuyable:${p.product_id}`,
      }));
    },
  },
];

function detectorsForModules(enabledSet) {
  return DETECTORS.filter((d) => enabledSet.has(d.module));
}

module.exports = { MODULE_KEYS, DETECTORS, detectorsForModules, overdueSeverity };
