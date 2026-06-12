/**
 * Weekly Sales + Customer reports (J-4 / PD §6.30).
 * Runs Saturday 20:00 Africa/Lagos.
 *
 * Generates the report data deterministically from logged data (no manual
 * compilation), references the seeded report_templates row, and creates a
 * report_runs row in 'needs_confirmation' (the review-then-confirm step the PD
 * describes — the dashboard's needs-confirmation queue surfaces it). The
 * computed figures are stored as a JSON output in report_run_outputs.
 *
 * Idempotent: the run_number is derived from the template + week, so a re-run
 * (or overlap) for the same week is a no-op (ON CONFLICT DO NOTHING).
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");

const { BRANDS } = require("../../config/brands");

const PAID = `('paid','awaiting_dispatch','completed')`;

function lastWeekWindow() {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function createReportRun({
  brand,
  templateKey,
  periodStart,
  periodEnd,
  payload,
  rows,
}) {
  const tpl = await query(
    `SELECT template_id, requires_staff_confirmation
       FROM ${brand}.report_templates WHERE template_key = $1`,
    [templateKey],
  );
  if (!tpl.rows[0]) {
    logger.warn(
      { brand, templateKey },
      "weekly report: template not seeded — skipping",
    );
    return null;
  }
  const template = tpl.rows[0];
  const stamp = periodEnd.slice(0, 10).replace(/-/g, "");
  const run_number = `RPT-${templateKey.toUpperCase()}-${stamp}`;
  const status = template.requires_staff_confirmation
    ? "needs_confirmation"
    : "completed";

  const run = await query(
    `INSERT INTO ${brand}.report_runs
       (run_number, report_template_id, period_start, period_end, triggered_by,
        status, rows_returned, started_at, completed_at)
     VALUES ($1,$2,$3,$4,'scheduled',$5,$6, now(), now())
     ON CONFLICT (run_number) DO NOTHING
     RETURNING run_id`,
    [run_number, template.template_id, periodStart, periodEnd, status, rows],
  );
  if (!run.rows[0]) return null; // already generated this week

  const run_id = run.rows[0].run_id;
  await query(
    `INSERT INTO ${brand}.report_run_outputs (run_id, format, inline_payload)
     VALUES ($1, 'json', $2::jsonb)`,
    [run_id, JSON.stringify(payload)],
  );
  return run_id;
}

async function runWeeklySalesReport() {
  const { start, end } = lastWeekWindow();
  let made = 0;
  for (const brand of BRANDS) {
    try {
      const totals = await query(
        `SELECT count(*) FILTER (WHERE status IN ${PAID})::int AS paid_orders,
                COALESCE(sum(total_ngn) FILTER (WHERE status IN ${PAID}),0) AS revenue_ngn,
                count(*)::int AS total_orders
           FROM ${brand}.sales_orders
          WHERE created_at >= $1 AND created_at < $2`,
        [start, end],
      );
      const byChannel = await query(
        `SELECT sales_channel,
                count(*)::int AS orders,
                COALESCE(sum(total_ngn),0) AS revenue_ngn
           FROM ${brand}.sales_orders
          WHERE created_at >= $1 AND created_at < $2 AND status IN ${PAID}
          GROUP BY sales_channel
          ORDER BY revenue_ngn DESC`,
        [start, end],
      );
      const payload = {
        period: { start, end },
        totals: totals.rows[0],
        by_channel: byChannel.rows,
      };
      const id = await createReportRun({
        brand,
        templateKey: "weekly_sales_report",
        periodStart: start,
        periodEnd: end,
        payload,
        rows: totals.rows[0].total_orders,
      });
      if (id) made += 1;
    } catch (err) {
      logger.error({ err: err.message, brand }, "weekly sales report failed");
    }
  }
  logger.info({ made }, "weekly sales reports generated");
  return { made };
}

async function runWeeklyCustomerReport() {
  const { start, end } = lastWeekWindow();
  let made = 0;
  for (const brand of BRANDS) {
    try {
      const newContacts = await query(
        `SELECT count(*)::int AS new_contacts
           FROM shared.contacts
          WHERE business = $1 AND created_at >= $2 AND created_at < $3`,
        [brand, start, end],
      );
      const active = await query(
        `SELECT count(DISTINCT contact_id)::int AS active_customers
           FROM ${brand}.sales_orders
          WHERE created_at >= $1 AND created_at < $2 AND contact_id IS NOT NULL`,
        [start, end],
      );
      const payload = {
        period: { start, end },
        new_contacts: newContacts.rows[0].new_contacts,
        active_customers: active.rows[0].active_customers,
      };
      const id = await createReportRun({
        brand,
        templateKey: "weekly_customer_report",
        periodStart: start,
        periodEnd: end,
        payload,
        rows: newContacts.rows[0].new_contacts,
      });
      if (id) made += 1;
    } catch (err) {
      logger.error(
        { err: err.message, brand },
        "weekly customer report failed",
      );
    }
  }
  logger.info({ made }, "weekly customer reports generated");
  return { made };
}

module.exports = { runWeeklySalesReport, runWeeklyCustomerReport };
