/**
 * Auto target-progress wiring (HR — meeting §3.3/§3.6, answers #5/#6).
 *
 * Drives the monthly performance-target countdowns automatically:
 *   - Sales: every paid order bumps the salesperson's `sales_count` (+1) and
 *     `sales_revenue` (+order total) targets. Driven by the transactional
 *     outbox (`order.paid`), same as commission accrual — at-least-once,
 *     post-commit.
 *   - Service Jobs (the stylist side of the future Operations module): every
 *     completed job bumps the assigned staffer's `styles_completed` and
 *     `services_completed` targets (+1). In-process event.
 *
 * Only metrics that have an active target for that staffer this month actually
 * move (incrementActiveTarget no-ops otherwise), and crossing a goal emits
 * `target_achieved` → the bonus subscriber. Fully defensive: failures are
 * logged and never block the sale/job.
 *
 * OPERATIONS MODULE SEAM: when the dedicated Operations module lands, its
 * completion + quality-rating flow can call `hrOps.bumpTargetProgress` directly
 * (and feed quality into appraisal scores) — this file already covers the
 * service-job path so stylist countdowns work today.
 */

"use strict";

const outbox = require("../outbox/outbox");
const salesRepo = require("../../modules/sales/sales.repo");
const serviceJobsRepo = require("../../modules/service_jobs/service-jobs.repo");
const serviceJobEvents = require("../../modules/service_jobs/service-jobs.events");
const hrOps = require("./hr_ops.service");
const { logger } = require("../../config/logger");

// ── Sales → sales targets (outbox, post-commit) ───────────
async function bumpSalesTargets({ brand, order_id }) {
  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order || !order.created_by) return;
  await hrOps.bumpTargetProgress({
    brand, userId: order.created_by, metric: "sales_count", delta: 1,
  });
  const revenue = Number(order.total_ngn || 0);
  if (revenue > 0) {
    await hrOps.bumpTargetProgress({
      brand, userId: order.created_by, metric: "sales_revenue", delta: revenue,
    });
  }
}

// ── Service jobs → stylist targets (in-process event) ─────
async function bumpStylistTargets({ brand, job_id }) {
  try {
    const job = await serviceJobsRepo.getServiceJob({ brand, id: job_id });
    const userId = job && job.assigned_staff_user_id;
    if (!userId) return;
    // Bump both styling metrics; only the one with an active target moves.
    await hrOps.bumpTargetProgress({ brand, userId, metric: "styles_completed", delta: 1 });
    await hrOps.bumpTargetProgress({ brand, userId, metric: "services_completed", delta: 1 });
  } catch (err) {
    logger.error({ err, brand, job_id }, "stylist target progress failed");
  }
}

let registered = false;
function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.paid", "hr_sales_target", bumpSalesTargets);
  serviceJobEvents.on("completed", bumpStylistTargets);
  logger.info("hr_payroll target-progress subscribers registered (sales + service jobs)");
}

register();

module.exports = { register, bumpSalesTargets, bumpStylistTargets };
