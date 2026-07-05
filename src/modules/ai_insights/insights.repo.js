/**
 * AI Insights (V2.2 §6.30) — repository (unified store).
 *
 * All findings live in ONE table, `shared.ai_insights`, keyed by
 * (module, detector) with a typed `context` JSONB and a drill target. The
 * open→acknowledged/investigating/resolved/dismissed lifecycle and the
 * idempotent `raise` (ON CONFLICT DO NOTHING on the partial-unique
 * open-suppression index) are generic over every module — so a new module
 * ships insights via a registry entry, not new SQL here.
 *
 * `shared.ai_insight_modules` is the AI Control switchboard (per-module
 * insights_enabled / narration_enabled / frequency). The detector runner and
 * the module-page UI slot both gate on it.
 *
 * The detector SOURCE reads (overdue invoices, stale intercompany, approval
 * backlog, service-match) pull from the live spine and are unchanged from the
 * category-table era — only the WRITE side moved to the unified store.
 */

"use strict";

const { query, ex } = require("../../config/database");
const { t } = require("../../config/brands");

// ── Unified ingest hook (idempotent on the open-suppression index) ──
/**
 * Raise one finding. `insight` is the normalised shape every detector emits:
 * { module, detector, business?, severity, title, body?, context?, amount_ngn?,
 *   source_table?, source_id?, drill_route?, suppression_key }.
 * Duplicate open findings for the same (module, business, suppression_key) are
 * silently skipped, so a 30-min sweep never spams.
 */
async function raise({ client, insight: r }) {
  // RETURNING with ON CONFLICT DO NOTHING yields the row ONLY when a new insight
  // was actually inserted (suppressed duplicates return nothing) — so callers
  // can notify/relay only on genuinely new findings.
  const { rows } = await ex(client)(
    `INSERT INTO shared.ai_insights
       (module, detector, business, severity, status, title, body, context,
        amount_ngn, source_table, source_id, drill_route, suppression_key)
     VALUES ($1,$2,$3,$4,'open',$5,$6,COALESCE($7::jsonb,'{}'::jsonb),
             $8,$9,$10,$11,$12)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      r.module,
      r.detector,
      r.business || null,
      r.severity,
      r.title,
      r.body || null,
      r.context ? JSON.stringify(r.context) : null,
      r.amount_ngn || null,
      r.source_table || null,
      r.source_id || null,
      r.drill_route || null,
      r.suppression_key,
    ],
  );
  return rows[0] || null;
}

// ── Lifecycle read/write (generic over the unified table) ──
async function list({
  module,
  business,
  status = "open",
  severity,
  page = 1,
  page_size = 50,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (module) {
    where.push(`module = $${i++}`);
    params.push(module);
  }
  // Cross-brand findings (business IS NULL, e.g. inter-company) show for
  // whichever brand is asking.
  if (business) {
    where.push(`(business = $${i++} OR business IS NULL)`);
    params.push(business);
  }
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  if (severity) {
    where.push(`severity = $${i++}`);
    params.push(severity);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT * FROM shared.ai_insights ${w}
      ORDER BY detected_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return rows;
}
async function getOne({ id }) {
  const { rows } = await query(
    `SELECT * FROM shared.ai_insights WHERE insight_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function setStatus({ id, status, fields = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  const { rows } = await query(
    `UPDATE shared.ai_insights SET ${sets.join(", ")}
      WHERE insight_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
/** Per-module open counts (+ urgent = high/critical) for the summary/badges. */
async function summary({ business }) {
  const params = [];
  let filter = "";
  if (business) {
    filter = `AND (business = $1 OR business IS NULL)`;
    params.push(business);
  }
  const { rows } = await query(
    `SELECT module,
            count(*)::int AS open,
            count(*) FILTER (WHERE severity IN ('high','critical'))::int AS urgent
       FROM shared.ai_insights
      WHERE status = 'open' ${filter}
      GROUP BY module`,
    params,
  );
  const out = {};
  for (const r of rows) out[r.module] = { open: r.open, urgent: r.urgent };
  return out;
}
/**
 * Auto-resolve open insights for a module whose finding no longer appears in
 * the latest sweep (the condition cleared). `liveKeys` is the set of
 * suppression_keys the module's detectors produced this run; any open /
 * acknowledged / investigating insight whose key is NOT in it is resolved.
 * Returns the count resolved. Only ever called for modules whose detectors all
 * ran cleanly this sweep, so a detector error never mass-resolves live findings.
 */
async function autoResolveStale({ module, liveKeys, business }) {
  // Optional business scope: per-brand producers (the stock scheduler) resolve
  // only their own brand's stale findings, so one brand's failed run can never
  // wipe another brand's live alerts. Sweep detectors resolve module-wide.
  const params = [module, liveKeys];
  let scope = "";
  if (business) {
    scope = "AND business = $3";
    params.push(business);
  }
  const { rows } = await query(
    `UPDATE shared.ai_insights
        SET status = 'resolved', resolved_at = now(),
            resolution_notes = 'Auto-resolved: condition cleared'
      WHERE module = $1
        AND status IN ('open','acknowledged','investigating')
        AND NOT (suppression_key = ANY($2::text[]))
        ${scope}
      RETURNING insight_id`,
    params,
  );
  return rows.length;
}
/** Top open findings for a business, worst first — feeds briefing refs. */
async function topOpenInsights({ business, limit = 10 }) {
  const { rows } = await query(
    `SELECT insight_id, module, title, severity
       FROM shared.ai_insights
      WHERE status = 'open' AND (business = $1 OR business IS NULL)
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                             WHEN 'medium' THEN 2 ELSE 3 END,
               detected_at DESC
      LIMIT $2`,
    [business, limit],
  );
  return rows;
}
/** Link a briefing to the findings it covered (paragraph → alert refs). */
async function insertBriefingRefs({ briefing_id, refs }) {
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    await query(
      `INSERT INTO shared.ai_briefing_insight_refs
         (briefing_id, insight_category, insight_id, excerpt, display_order)
       VALUES ($1,$2,$3,$4,$5)`,
      [briefing_id, r.module, r.insight_id, r.title || null, i],
    );
  }
}

// ── AI Control switchboard (ai_insight_modules) ──
async function listModules() {
  const { rows } = await query(
    `SELECT * FROM shared.ai_insight_modules ORDER BY sort_order, module`,
  );
  return rows;
}
async function getModule(module) {
  const { rows } = await query(
    `SELECT * FROM shared.ai_insight_modules WHERE module = $1`,
    [module],
  );
  return rows[0] || null;
}
/** Modules with tier-1 detectors switched on. */
async function enabledModules() {
  const { rows } = await query(
    `SELECT module FROM shared.ai_insight_modules WHERE insights_enabled = true`,
  );
  return rows.map((r) => r.module);
}
/** Modules with tier-2 AI narration switched on (implies insights on). */
async function narrationModules() {
  const { rows } = await query(
    `SELECT module FROM shared.ai_insight_modules
      WHERE insights_enabled = true AND narration_enabled = true`,
  );
  return rows.map((r) => r.module);
}
async function updateModule({ module, fields, updated_by }) {
  const allowed = ["insights_enabled", "narration_enabled", "frequency"];
  const sets = [];
  const params = [module];
  let i = 2;
  for (const k of allowed) {
    if (k in fields) {
      sets.push(`${k} = $${i++}`);
      params.push(fields[k]);
    }
  }
  if (updated_by) {
    sets.push(`updated_by = $${i++}`);
    params.push(updated_by);
  }
  if (sets.length === 0) return getModule(module);
  const { rows } = await query(
    `UPDATE shared.ai_insight_modules SET ${sets.join(", ")}
      WHERE module = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Detector SOURCE reads (the live spine) — unchanged ─────
async function overdueInvoices({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT invoice_id, contact_id AS customer_contact_id, balance_due_ngn AS net_due_ngn,
            (CURRENT_DATE - due_date) AS days_overdue
       FROM ${t(brand, "invoices")}
      WHERE status IN ('sent','viewed','partially_paid')
        AND due_date < CURRENT_DATE
      ORDER BY due_date ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
async function staleIntercompany({ within_days = 7, limit = 500 }) {
  const { rows } = await query(
    `SELECT ic_transaction_id, seller_brand, buyer_brand, amount_ngn,
            (CURRENT_DATE - created_at::date) AS age_days
       FROM shared.intercompany_transactions
      WHERE status IN ('recorded','pending','matched')
        AND created_at < now() - ($1 || ' days')::interval
      ORDER BY created_at ASC LIMIT $2`,
    [within_days, limit],
  );
  return rows;
}
async function staleApprovals({ within_hours = 48 }) {
  const { rows } = await query(
    `SELECT business, count(*)::int AS pending_count,
            (EXTRACT(EPOCH FROM (now() - min(stage_entered_at))) / 3600)::int AS oldest_age_hours
       FROM shared.workflow_instances
      WHERE status = 'pending' AND stage_entered_at < now() - ($1 || ' hours')::interval
      GROUP BY business`,
    [within_hours],
  );
  return rows;
}
async function unlinkedServiceJobs({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT job_id, job_number, assigned_stylist_id, assigned_staff_user_id,
            completed_at, agreed_cost_ngn, actual_cost_ngn
       FROM ${t(brand, "service_jobs")}
      WHERE status = 'completed' AND sales_order_id IS NULL
        AND is_intercompany = false
      ORDER BY completed_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}
async function intercompanyJobsMissingMatch({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT j.job_id, j.job_number, j.assigned_stylist_id, j.assigned_staff_user_id,
            j.completed_at, j.agreed_cost_ngn, j.actual_cost_ngn, j.status
       FROM ${t(brand, "service_jobs")} j
       LEFT JOIN shared.intercompany_transactions ic
              ON ic.ic_transaction_id = j.intercompany_transaction_id
      WHERE j.is_intercompany = true
        AND j.status NOT IN ('cancelled', 'rejected')
        AND (j.status = 'completed' OR j.created_at < now() - interval '2 days')
        AND (j.intercompany_transaction_id IS NULL
             OR ic.status IN ('rejected', 'cancelled', 'reversed', 'disputed'))
      ORDER BY j.created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

// Attendance (shared.attendance_days carries business + is_offsite from 000234).
async function offsiteAttendance({ within_days = 7, limit = 500 }) {
  const { rows } = await query(
    `SELECT business, profile_id, work_date, offsite_distance_m
       FROM shared.attendance_days
      WHERE is_offsite = true
        AND work_date >= CURRENT_DATE - ($1::int)
      ORDER BY work_date DESC LIMIT $2`,
    [within_days, limit],
  );
  return rows;
}
// Purchasing: POs whose expected delivery date has passed and that are not yet
// received/closed/cancelled.
async function overduePurchaseOrders({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT po_id, po_number, supplier_id, total_ngn,
            (CURRENT_DATE - expected_delivery) AS days_overdue
       FROM ${t(brand, "purchase_orders")}
      WHERE expected_delivery IS NOT NULL
        AND expected_delivery < CURRENT_DATE
        AND status NOT IN ('received','closed','cancelled')
      ORDER BY expected_delivery ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Logistics: failed/lost/damaged/returned deliveries, plus in-flight deliveries
// past their expected time.
async function problemDeliveries({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT delivery_id, delivery_number, order_id, status,
            pod_amount_expected_ngn, expected_delivery_at,
            (EXTRACT(EPOCH FROM (now() - expected_delivery_at)) / 3600)::int AS overdue_hours
       FROM ${t(brand, "deliveries")}
      WHERE status IN ('attempted_failed','lost','damaged','returned_to_sender')
         OR (expected_delivery_at IS NOT NULL
             AND expected_delivery_at < now()
             AND status IN ('queued','booked','picked_up','in_transit',
                            'arrived_destination_city','out_for_delivery'))
      ORDER BY expected_delivery_at ASC NULLS LAST LIMIT $1`,
    [limit],
  );
  return rows;
}
// Expenses: cash advances flagged overdue for settlement, or disbursed and ageing.
async function unsettledAdvances({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT advance_id, advance_number, purpose, status,
            COALESCE(approved_amount_ngn, requested_amount_ngn) AS amount_ngn,
            (CURRENT_DATE - created_at::date) AS age_days
       FROM ${t(brand, "cash_advances")}
      WHERE status = 'overdue_settlement'
         OR (status = 'disbursed' AND created_at < now() - interval '14 days')
      ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}

// Sales: orders paid but not yet dispatched for too long (fulfilment delay).
async function fulfillmentDelayedOrders({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT order_id, order_number, contact_id, total_ngn, status,
            (EXTRACT(EPOCH FROM (now() - placed_at)) / 86400)::int AS age_days
       FROM ${t(brand, "sales_orders")}
      WHERE status IN ('paid','awaiting_dispatch','ready_for_dispatch')
        AND placed_at IS NOT NULL
        AND placed_at < now() - interval '3 days'
      ORDER BY placed_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// CRM: open deals with no stage movement for a while (stalled).
async function stalledDeals({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT deal_id, title, current_stage_id, expected_value_ngn,
            (EXTRACT(EPOCH FROM (now() - stage_entered_at)) / 86400)::int AS days_in_stage
       FROM ${t(brand, "crm_deals")}
      WHERE status = 'open'
        AND stage_entered_at < now() - interval '14 days'
      ORDER BY stage_entered_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Production: runs whose expected arrival date has passed and aren't terminal.
async function delayedProductionRuns({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT run_id, run_number, status, total_landed_cost_ngn,
            (CURRENT_DATE - expected_arrival_date) AS days_late
       FROM ${t(brand, "production_runs")}
      WHERE expected_arrival_date IS NOT NULL
        AND expected_arrival_date < CURRENT_DATE
        AND status NOT IN ('received','styled','closed','cancelled')
      ORDER BY expected_arrival_date ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Accounting: draft journal entries left unposted.
async function agingDraftJournals({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT entry_id, entry_number, description,
            (EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::int AS age_days
       FROM ${t(brand, "journal_entries")}
      WHERE status = 'draft'
        AND created_at < now() - interval '7 days'
      ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Retention: contacts whose current (non-superseded) churn score is high.
async function churnRiskContacts({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT score_id, contact_id, risk_score, risk_band, computed_at
       FROM ${t(brand, "churn_risk_scores")}
      WHERE superseded_at IS NULL
        AND risk_band IN ('high','critical')
      ORDER BY risk_score DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

// Pricing: margin breaches per (variant, channel). Below COST flags on every
// sales channel — selling under cost is always wrong. Below FLOOR
// (min_price_ngn) flags on the storefront only, since wholesale/partner
// channels legitimately price under the retail floor.
async function marginBreaches({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT pv.variant_id, pv.product_id, pv.sku, pv.variant_name,
            pv.cost_price_ngn, pv.min_price_ngn, p.name AS product_name,
            ch.channel, ch.price_ngn
       FROM ${t(brand, "product_variants")} pv
       JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
      CROSS JOIN LATERAL (VALUES
        ('storefront', pv.price_storefront_ngn),
        ('pos',        pv.price_pos_ngn),
        ('wholesale',  pv.price_wholesale_ngn),
        ('partner',    pv.price_partner_ngn)
      ) AS ch(channel, price_ngn)
      WHERE pv.is_active = true
        AND pv.cost_price_ngn > 0
        AND ch.price_ngn IS NOT NULL
        AND ch.price_ngn > 0
        AND (ch.price_ngn < pv.cost_price_ngn
             OR (ch.channel = 'storefront'
                 AND pv.min_price_ngn IS NOT NULL AND pv.min_price_ngn > 0
                 AND ch.price_ngn < pv.min_price_ngn))
      ORDER BY (pv.cost_price_ngn - ch.price_ngn) DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}
// Purchasing: POs submitted for approval but untouched (second purchasing
// signal — the first is delivery_overdue).
async function stalledPurchaseApprovals({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT po_id, po_number, supplier_id, total_ngn,
            (EXTRACT(EPOCH FROM (now() - updated_at)) / 86400)::int AS days_waiting
       FROM ${t(brand, "purchase_orders")}
      WHERE status = 'submitted'
        AND updated_at < now() - interval '7 days'
      ORDER BY updated_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Retail partners: settlements disputed, or approved/invoiced but unpaid.
async function unpaidPartnerSettlements({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT settlement_id, settlement_number, partner_id, status,
            total_partner_share_ngn,
            (EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::int AS age_days
       FROM ${t(brand, "partner_settlements")}
      WHERE status = 'disputed'
         OR (status IN ('approved','invoiced')
             AND created_at < now() - interval '7 days')
      ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Tasks: overdue open tasks (shared.tasks carries business).
async function overdueTasks({ limit = 500 }) {
  const { rows } = await query(
    `SELECT task_id, business, title, priority, assigned_to,
            (EXTRACT(EPOCH FROM (now() - due_at)) / 86400)::int AS days_overdue
       FROM shared.tasks
      WHERE due_at IS NOT NULL
        AND due_at < now()
        AND status NOT IN ('done','cancelled')
      ORDER BY due_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}

module.exports = {
  raise,
  list,
  getOne,
  setStatus,
  summary,
  autoResolveStale,
  topOpenInsights,
  insertBriefingRefs,
  stalledPurchaseApprovals,
  listModules,
  getModule,
  enabledModules,
  narrationModules,
  updateModule,
  overdueInvoices,
  staleIntercompany,
  staleApprovals,
  unlinkedServiceJobs,
  intercompanyJobsMissingMatch,
  offsiteAttendance,
  overduePurchaseOrders,
  problemDeliveries,
  unsettledAdvances,
  fulfillmentDelayedOrders,
  stalledDeals,
  delayedProductionRuns,
  agingDraftJournals,
  churnRiskContacts,
  marginBreaches,
  unpaidPartnerSettlements,
  overdueTasks,
  pendingStylistPayouts,
  stuckCampaigns,
  wastefulAdCampaigns,
  unansweredThreads,
  failedSocialPosts,
  expiringSocialTokens,
  failedStorefrontPayments,
  overdueAccessReviews,
  expiringContracts,
  stalledOnboarding,
  unbuyableProducts,
};

// Social: posts that failed to publish, or are scheduled but overdue.
async function failedSocialPosts({ limit = 500 }) {
  const { rows } = await query(
    `SELECT post_id, business, status, scheduled_for
       FROM shared.social_posts
      WHERE status = 'failed'
         OR (status = 'scheduled' AND scheduled_for IS NOT NULL
             AND scheduled_for < now() - interval '15 minutes')
      ORDER BY scheduled_for ASC NULLS LAST LIMIT $1`,
    [limit],
  );
  return rows;
}
// Social: active accounts whose access token expires within a week.
async function expiringSocialTokens({ limit = 500 }) {
  const { rows } = await query(
    `SELECT account_id, business, platform, token_expires_at,
            (token_expires_at::date - CURRENT_DATE) AS days_left
       FROM shared.social_accounts
      WHERE is_active = true
        AND token_expires_at IS NOT NULL
        AND token_expires_at < now() + interval '7 days'
      ORDER BY token_expires_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Storefront: recent failed order payments.
async function failedStorefrontPayments({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT payment_id, order_id, amount_ngn, method, failure_reason,
            (EXTRACT(EPOCH FROM (now() - created_at)) / 3600)::int AS hours_ago
       FROM ${t(brand, "sales_order_payments")}
      WHERE status = 'failed'
        AND created_at > now() - interval '7 days'
      ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}
// IAM/Security: access reviews open past their due date (governance, Hub-level).
async function overdueAccessReviews({ limit = 500 }) {
  const { rows } = await query(
    `SELECT review_id, status, due_date,
            (CURRENT_DATE - due_date) AS days_overdue
       FROM shared.access_reviews
      WHERE status IN ('open','in_progress')
        AND due_date IS NOT NULL
        AND due_date < CURRENT_DATE
      ORDER BY due_date ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Payroll: staff contracts expiring within 30 days (business via staff_profiles).
async function expiringContracts({ limit = 500 }) {
  const { rows } = await query(
    `SELECT c.contract_id, c.profile_id, c.contract_type, c.effective_to,
            sp.business, (c.effective_to - CURRENT_DATE) AS days_left
       FROM shared.staff_contracts c
       JOIN shared.staff_profiles sp ON sp.profile_id = c.profile_id
      WHERE c.effective_to IS NOT NULL
        AND c.effective_to >= CURRENT_DATE
        AND c.effective_to < CURRENT_DATE + 30
        AND c.contract_type <> 'termination'
      ORDER BY c.effective_to ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Customer onboarding: submissions never linked to a contact (unprocessed).
async function stalledOnboarding({ limit = 500 }) {
  const { rows } = await query(
    `SELECT submission_id, business, created_at,
            (EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::int AS age_days
       FROM shared.customer_onboarding_submissions
      WHERE contact_id IS NULL
        AND created_at < now() - interval '2 days'
      ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Catalogue: products visible on the storefront with no active, priced variant
// (visible but not actually buyable).
async function unbuyableProducts({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT p.product_id, p.name
       FROM ${t(brand, "products")} p
      WHERE p.is_visible_storefront = true
        AND NOT EXISTS (
          SELECT 1 FROM ${t(brand, "product_variants")} pv
           WHERE pv.product_id = p.product_id
             AND pv.is_active = true
             AND pv.price_storefront_ngn > 0
        )
      ORDER BY p.name ASC LIMIT $1`,
    [limit],
  );
  return rows;
}

// Stylist programme: approved/processing payouts left unpaid, or failed
// (shared.stylist_payouts is cross-brand — no business column).
async function pendingStylistPayouts({ limit = 500 }) {
  const { rows } = await query(
    `SELECT payout_id, payout_number, stylist_id, amount_ngn, status,
            (EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::int AS age_days
       FROM shared.stylist_payouts
      WHERE status = 'failed'
         OR (status IN ('approved','processing')
             AND created_at < now() - interval '3 days')
      ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Sales campaigns: live campaign past its end, or scheduled past its start.
async function stuckCampaigns({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT campaign_id, name, status, starts_at, ends_at,
            (EXTRACT(EPOCH FROM (now() - ends_at)) / 86400)::int AS days_past_end
       FROM ${t(brand, "sales_campaigns")}
      WHERE (status = 'live' AND ends_at < now())
         OR (status = 'scheduled' AND starts_at < now())
      ORDER BY ends_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Marketing: active ad campaigns spending with zero conversions (last 7 days).
async function wastefulAdCampaigns({ limit = 500 }) {
  const { rows } = await query(
    `SELECT c.ad_campaign_id, c.name, c.business,
            SUM(s.spend_ngn)::numeric(14,2) AS spend_ngn,
            SUM(s.conversions)::int AS conversions
       FROM shared.ad_campaigns c
       JOIN shared.ad_spend_daily s ON s.ad_campaign_id = c.ad_campaign_id
      WHERE c.status = 'active'
        AND s.metric_date >= CURRENT_DATE - 7
      GROUP BY c.ad_campaign_id, c.name, c.business
     HAVING SUM(s.conversions) = 0 AND SUM(s.spend_ngn) > 5000
      ORDER BY SUM(s.spend_ngn) DESC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Smartcomm: customer threads whose most-recent message is from the customer
// (a contact sender) and has gone unanswered past the SLA.
async function unansweredThreads({ hours = 4, limit = 500 }) {
  const { rows } = await query(
    `SELECT c.channel_id, c.business, c.external_platform, c.name,
            m.created_at AS last_at,
            (EXTRACT(EPOCH FROM (now() - m.created_at)) / 3600)::int AS hours_waiting
       FROM shared.message_channels c
       JOIN LATERAL (
         SELECT created_at, sender_contact_id
           FROM shared.messages
          WHERE channel_id = c.channel_id
          ORDER BY created_at DESC LIMIT 1
       ) m ON true
      WHERE c.channel_type = 'customer_thread'
        AND c.is_archived = false
        AND m.sender_contact_id IS NOT NULL
        AND m.created_at < now() - ($1 || ' hours')::interval
      ORDER BY m.created_at ASC LIMIT $2`,
    [hours, limit],
  );
  return rows;
}
