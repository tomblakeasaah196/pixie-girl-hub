/**
 * Contacts 360 — unified activity timeline (V2.2 §6.12: "Every record created
 * anywhere in the system appears here with a running log of all interactions
 * ... full history across all modules").
 *
 * Aggregates every record that flows through a contact across the brand
 * schema (sales, quotations, invoices, receipts, POS, CRM deals/activities/
 * notes, service jobs, deliveries, hair-quiz) and the shared schema (loyalty
 * ledger, referral redemptions, product reviews) into one time-sorted feed.
 *
 * Bound params: $1 = contact_id, $2 = brand. Each subquery projects the same
 * shape: (occurred_at, module, kind, ref_id, ref, title, status, amount_ngn).
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");

/** The UNION ALL of every contact-activity source for a brand. */
function unionSql(brand) {
  return [
    // ── Brand schema ────────────────────────────────────────
    `SELECT COALESCE(placed_at, created_at) AS occurred_at, 'sales'::text AS module,
            'sales_order'::text AS kind, order_id AS ref_id, order_number AS ref,
            NULL::text AS title, status::text AS status, total_ngn AS amount_ngn
       FROM ${t(brand, "sales_orders")} WHERE contact_id = $1`,
    `SELECT created_at, 'sales', 'quotation', quotation_id, quotation_number,
            NULL, status::text, total_ngn
       FROM ${t(brand, "quotations")} WHERE contact_id = $1`,
    `SELECT created_at, 'invoicing', 'invoice', invoice_id, invoice_number,
            NULL, status::text, total_ngn
       FROM ${t(brand, "invoices")} WHERE contact_id = $1`,
    `SELECT issued_at, 'invoicing', 'receipt', receipt_id, receipt_number,
            NULL, NULL, amount_ngn
       FROM ${t(brand, "receipts")} WHERE contact_id = $1`,
    `SELECT created_at, 'pos', 'pos_sale', transaction_id, NULL,
            NULL, status::text, total_ngn
       FROM ${t(brand, "pos_transactions")} WHERE customer_contact_id = $1`,
    `SELECT created_at, 'crm', 'deal', deal_id, NULL,
            title, status::text, expected_value_ngn
       FROM ${t(brand, "crm_deals")} WHERE contact_id = $1`,
    `SELECT performed_at, 'crm', 'activity', activity_id, NULL,
            subject, activity_type::text, NULL::numeric
       FROM ${t(brand, "crm_activities")} WHERE contact_id = $1`,
    `SELECT created_at, 'crm', 'note', note_id, NULL,
            left(body, 140), NULL, NULL
       FROM ${t(brand, "crm_notes")} WHERE contact_id = $1`,
    `SELECT created_at, 'service', 'service_job', job_id, job_number,
            NULL, status::text, agreed_cost_ngn
       FROM ${t(brand, "service_jobs")} WHERE customer_contact_id = $1`,
    `SELECT created_at, 'logistics', 'delivery', delivery_id, delivery_number,
            NULL, status::text, NULL
       FROM ${t(brand, "deliveries")} WHERE recipient_contact_id = $1`,
    `SELECT completed_at, 'retention', 'hair_quiz', response_id, NULL,
            NULL, NULL, NULL
       FROM ${t(brand, "hair_quiz_responses")}
      WHERE contact_id = $1 AND completed_at IS NOT NULL`,
    // ── Shared schema (scoped by business) ──────────────────
    `SELECT created_at, 'retention', 'loyalty', ledger_id, NULL,
            transaction_type::text, NULL, NULL
       FROM shared.loyalty_ledger WHERE contact_id = $1 AND business = $2`,
    `SELECT created_at, 'retention', 'referral_redemption', redemption_id, NULL,
            NULL, status::text, NULL
       FROM shared.referral_redemptions
      WHERE referred_contact_id = $1 AND business = $2`,
    `SELECT created_at, 'storefront', 'review', review_id, NULL,
            NULL, NULL, NULL
       FROM shared.product_reviews WHERE contact_id = $1 AND business = $2`,
  ].join("\n    UNION ALL\n");
}

// Module → frontend timeline category. "commercial" = money-bearing events,
// "engagement" = touchpoints/notes, "internal" = system-side changes.
const CATEGORY_BY_MODULE = {
  sales: "commercial",
  invoicing: "commercial",
  pos: "commercial",
  service: "commercial",
  retention: "commercial",
  storefront: "engagement",
  crm: "engagement",
  logistics: "internal",
};

function toTimelineEvent(r) {
  return {
    event_id: r.ref_id,
    event_type: `${r.module}.${r.kind}`,
    event_at: r.occurred_at,
    title:
      r.title || r.ref || `${r.module} · ${String(r.kind).replace(/_/g, " ")}`,
    detail: r.status || null,
    metadata: {
      module: r.module,
      kind: r.kind,
      ref: r.ref,
      amount_ngn: r.amount_ngn,
    },
    created_by: null,
    created_by_name: null,
    category: CATEGORY_BY_MODULE[r.module] || "internal",
  };
}

async function timeline({
  brand,
  contact_id,
  kinds,
  category,
  page = 1,
  page_size = 30,
}) {
  const union = unionSql(brand);
  const params = [contact_id, brand];
  const where = [];
  if (Array.isArray(kinds) && kinds.length > 0) {
    params.push(kinds);
    where.push(`kind = ANY($${params.length})`);
  }
  if (category) {
    // Translate a category filter into the set of modules it covers.
    const modules = Object.entries(CATEGORY_BY_MODULE)
      .filter(([, c]) => c === category)
      .map(([m]) => m);
    if (modules.length > 0) {
      params.push(modules);
      where.push(`module = ANY($${params.length})`);
    }
  }
  const filterSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total FROM (${union}) tl ${filterSql}`,
    params,
  );

  const offset = (page - 1) * page_size;
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const { rows } = await query(
    `SELECT * FROM (${union}) tl ${filterSql}
      ORDER BY occurred_at DESC NULLS LAST
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, page_size, offset],
  );

  const total = countRows[0].total;
  return {
    data: rows.map(toTimelineEvent),
    meta: {
      page,
      page_size,
      total,
      has_more: offset + rows.length < total,
    },
  };
}

/** Roll-up counters for the contact header (cheap targeted aggregates). */
async function summary({ brand, contact_id }) {
  const paid = "('paid','awaiting_dispatch','completed')";
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM ${t(brand, "sales_orders")} WHERE contact_id = $1)
         AS orders_count,
       (SELECT COALESCE(SUM(total_ngn),0) FROM ${t(brand, "sales_orders")}
         WHERE contact_id = $1 AND status IN ${paid}) AS lifetime_spend_ngn,
       (SELECT COALESCE(SUM(balance_due_ngn),0) FROM ${t(brand, "invoices")}
         WHERE contact_id = $1 AND status NOT IN ('draft','void','paid'))
         AS open_invoice_balance_ngn,
       (SELECT count(*)::int FROM ${t(brand, "crm_deals")}
         WHERE contact_id = $1 AND status = 'open') AS open_deals,
       (SELECT count(*)::int FROM ${t(brand, "service_jobs")}
         WHERE customer_contact_id = $1) AS service_jobs_count,
       (SELECT COALESCE(current_balance,0) FROM shared.customer_loyalty_state
         WHERE contact_id = $1 AND business = $2) AS loyalty_balance`,
    [contact_id, brand],
  );
  return rows[0];
}

module.exports = { timeline, summary };
