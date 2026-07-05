/**
 * AI Insights (V2.2 §6.30 / §6.31) — business logic (unified store).
 *
 * Tier-1 detectors read the live spine and raise idempotent findings into the
 * single `shared.ai_insights` store; the CEO lists / acknowledges / resolves /
 * dismisses them and drives which modules are on from AI Control
 * (`shared.ai_insight_modules`). The detector runner walks the registry and
 * runs ONLY the modules toggled on — so nothing costs compute for a module the
 * CEO left off. Tier-2 AI narration (briefings) is layered by the AI briefing
 * job over these summaries.
 */

"use strict";

const repo = require("./insights.repo");
const registry = require("./insights.registry");
const events = require("./insights.events");
const { audit } = require("../../middleware/audit");
const { logger } = require("../../config/logger");
const { listBrands } = require("../../config/brands");
const { NotFoundError, AppError } = require("../../utils/errors");

function assertModule(module) {
  if (module && !registry.MODULE_KEYS.includes(module))
    throw new AppError("BAD_MODULE", `Unknown insight module ${module}`, 422);
}

// ── Read / lifecycle (CEO dashboard + module-slot surface) ──
function list({ brand, module, status, severity, page, page_size }) {
  assertModule(module);
  return repo.list({
    module,
    business: brand,
    status,
    severity,
    page,
    page_size,
  });
}
function summary({ brand }) {
  return repo.summary({ business: brand });
}
async function getOne({ id }) {
  const row = await repo.getOne({ id });
  if (!row) throw new NotFoundError("Insight");
  return row;
}
async function acknowledge({ brand, user, request_id, id }) {
  const row = await repo.setStatus({
    id,
    status: "acknowledged",
    fields: {
      acknowledged_by: user.user_id,
      acknowledged_at: new Date().toISOString(),
    },
  });
  if (!row) throw new NotFoundError("Insight");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "ai_insights.acknowledge",
    target_type: "ai_insight",
    target_id: id,
    request_id,
  });
  events.emit("insight.updated", { insight_id: id, status: "acknowledged", business: brand });
  return row;
}
async function resolve({ brand, user, request_id, id, reason }) {
  const row = await repo.setStatus({
    id,
    status: "resolved",
    fields: {
      resolved_by: user.user_id,
      resolved_at: new Date().toISOString(),
      resolution_notes: reason || null,
    },
  });
  if (!row) throw new NotFoundError("Insight");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "ai_insights.resolve",
    target_type: "ai_insight",
    target_id: id,
    request_id,
  });
  events.emit("insight.updated", { insight_id: id, status: "resolved", business: brand });
  return row;
}
async function dismiss({ brand, user, request_id, id }) {
  const row = await repo.setStatus({ id, status: "dismissed", fields: {} });
  if (!row) throw new NotFoundError("Insight");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "ai_insights.dismiss",
    target_type: "ai_insight",
    target_id: id,
    request_id,
  });
  events.emit("insight.updated", { insight_id: id, status: "dismissed", business: brand });
  return row;
}

// ── AI Control switchboard (the per-module matrix) ──
function listModules() {
  return repo.listModules();
}
async function updateModule({ brand, user, request_id, module, fields }) {
  assertModule(module);
  const row = await repo.updateModule({
    module,
    fields,
    updated_by: user.user_id,
  });
  if (!row) throw new NotFoundError("Insight module");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "ai_insights.module.update",
    target_type: "ai_insight_module",
    target_id: module,
    after: fields,
    request_id,
  });
  events.emit("modules.updated", { module, fields });
  return row;
}

// ── Ingest ──
/** New normalised ingest path (used by the registry runner + future producers). */
function raiseInsight(insight) {
  return repo.raise({ insight });
}

/**
 * Legacy category-shaped ingest hook, kept so existing producers (e.g. the
 * low-stock scheduler) don't change. Maps the old {category,row} onto a unified
 * insight. New producers should register a detector or call `raiseInsight`.
 */
async function raise({ category, row: r }) {
  const map = {
    stock: () => ({
      module: "stock",
      detector: "reorder_point",
      business: r.business,
      severity: r.severity,
      title: "Stock at/under reorder point",
      context: {
        product_id: r.product_id,
        variant_id: r.variant_id,
        stock_location_id: r.stock_location_id,
        current_stock: r.current_stock,
        reorder_point: r.reorder_point,
        daily_velocity: r.daily_velocity,
        projected_days_left: r.projected_days_left,
      },
      source_table: "stock_levels",
      source_id: r.variant_id || null,
      drill_route: "/stock",
      suppression_key: r.suppression_key,
    }),
    margin: () => ({
      module: "pricing",
      detector: r.breach_type || "margin_below_floor",
      business: r.business,
      severity: r.severity,
      title: "Margin breach",
      context: {
        breach_type: r.breach_type,
        product_id: r.product_id,
        variant_id: r.variant_id,
        channel: r.channel,
        current_cost_ngn: r.current_cost_ngn,
        current_price_ngn: r.current_price_ngn,
        current_margin_pct: r.current_margin_pct,
        floor_margin_pct: r.floor_margin_pct,
      },
      amount_ngn: r.current_price_ngn || null,
      source_table: "products",
      source_id: r.product_id || null,
      drill_route: "/pricing",
      suppression_key: r.suppression_key,
    }),
    invoice: () => ({
      module: "invoicing",
      detector: r.alert_type || "overdue",
      business: r.business,
      severity: r.severity,
      title: "Invoice alert",
      context: {
        invoice_id: r.invoice_id,
        customer_contact_id: r.customer_contact_id,
        days_overdue: r.days_overdue,
      },
      amount_ngn: r.amount_ngn || null,
      source_table: "invoices",
      source_id: r.invoice_id || null,
      drill_route: r.invoice_id ? `/invoicing/${r.invoice_id}` : "/invoicing",
      suppression_key: r.suppression_key,
    }),
    intercompany: () => ({
      module: "intercompany",
      detector: r.alert_type || "unmatched",
      business: null,
      severity: r.severity,
      title: "Inter-company alert",
      context: {
        ic_transaction_id: r.ic_transaction_id,
        recon_id: r.recon_id,
        seller_brand: r.seller_brand,
        buyer_brand: r.buyer_brand,
        age_days: r.age_days,
      },
      amount_ngn: r.amount_ngn || null,
      source_table: "intercompany_transactions",
      source_id: r.ic_transaction_id || null,
      drill_route: "/intercompany",
      suppression_key: r.suppression_key,
    }),
    attendance: () => ({
      module: "hr_attendance",
      detector: r.anomaly_type || "unusual_pattern",
      business: r.business,
      severity: r.severity,
      title: "Attendance anomaly",
      context: {
        staff_profile_id: r.staff_profile_id,
        anomaly_type: r.anomaly_type,
        clock_event_id: r.clock_event_id,
        anomaly_date: r.anomaly_date,
        distance_from_geofence_m: r.distance_from_geofence_m,
      },
      source_table: "staff_clock_events",
      source_id: r.clock_event_id || null,
      drill_route: "/hr",
      suppression_key: r.suppression_key,
    }),
    approval: () => ({
      module: "approvals",
      detector: r.alert_type || "queue_growing",
      business: r.business,
      severity: r.severity,
      title: "Approval backlog",
      context: {
        approver_user_id: r.approver_user_id,
        pending_count: r.pending_count,
        oldest_age_hours: r.oldest_age_hours,
        workflow_instance_id: r.workflow_instance_id,
      },
      source_table: "workflow_instances",
      source_id: r.workflow_instance_id || null,
      drill_route: "/org-workflow",
      suppression_key: r.suppression_key,
    }),
    service_match: () => ({
      module: "service_jobs",
      detector: r.alert_type || "no_sale_linked",
      business: r.business,
      severity: r.severity,
      title: "Service-match flag",
      context: {
        service_job_id: r.service_job_id,
        service_job_number: r.service_job_number,
        completed_by_stylist_id: r.completed_by_stylist_id,
        completed_by_user_id: r.completed_by_user_id,
        expected_amount_ngn: r.expected_amount_ngn,
        found_amount_ngn: r.found_amount_ngn,
        variance_ngn: r.variance_ngn,
      },
      amount_ngn: r.expected_amount_ngn || null,
      source_table: "service_jobs",
      source_id: r.service_job_id || null,
      drill_route: r.service_job_id
        ? `/service-jobs?job=${r.service_job_id}`
        : "/service-jobs",
      suppression_key: r.suppression_key,
    }),
  };
  const build = map[category];
  if (!build)
    throw new AppError("BAD_CATEGORY", `Unknown insight category ${category}`, 422);
  return raiseInsight(build());
}

// ── Detector sweep (cron) — registry-driven, gated by AI Control ──
/**
 * Run every enabled module's tier-1 detectors and raise their findings.
 * Brand-scoped detectors run once per brand; shared detectors run once.
 * A module toggled off in AI Control is skipped entirely (zero compute).
 */
async function runDetectorSweep() {
  const enabled = new Set(await repo.enabledModules());
  const detectors = registry.detectorsForModules(enabled);
  const result = {};
  const created = []; // rows genuinely inserted this sweep (not suppressed)
  const liveKeys = new Map(); // module → Set(suppression_key) seen this sweep
  const failedModules = new Set(); // modules whose detector errored (skip auto-resolve)
  const bump = (module, n) => {
    result[module] = (result[module] || 0) + n;
  };

  const brands = listBrands();
  for (const det of detectors) {
    if (!liveKeys.has(det.module)) liveKeys.set(det.module, new Set());
    const runs =
      det.scope === "brand" ? brands.map((b) => ({ brand: b })) : [{}];
    for (const ctx of runs) {
      try {
        const findings = await det.run(ctx);
        for (const f of findings) {
          const row = await raiseInsight(f);
          if (row) created.push(row);
          liveKeys.get(det.module).add(f.suppression_key);
        }
        bump(det.module, findings.length);
      } catch (err) {
        failedModules.add(det.module);
        logger.error(
          { err: err.message, module: det.module, detector: det.detector, brand: ctx.brand },
          "insights: detector failed",
        );
      }
    }
  }

  // Auto-resolve: for every module whose detectors ALL ran cleanly, close open
  // insights whose finding no longer appears (the condition has cleared). A
  // module with a failed detector is skipped so a transient error never
  // mass-resolves still-valid findings; stock (raised by its own scheduler, not
  // in this sweep) is never in `liveKeys`, so it's never touched.
  let autoResolved = 0;
  for (const [module, keys] of liveKeys) {
    if (failedModules.has(module)) continue;
    try {
      autoResolved +=
        (await repo.autoResolveStale({ module, liveKeys: [...keys] })) || 0;
    } catch (err) {
      logger.error({ err: err.message, module }, "insights: auto-resolve failed");
    }
  }

  // Push NEW urgent findings to the CEO's notification bell (best-effort).
  await notifyUrgent(created);

  const total = Object.values(result).reduce((a, b) => a + b, 0);
  events.emit("sweep.completed", {
    ...result,
    total,
    created: created.length,
    resolved: autoResolved,
  });
  logger.info(
    { ...result, total, created: created.length, resolved: autoResolved },
    "ai insights detector sweep done",
  );
  return result;
}

/**
 * Fan newly-raised high/critical insights to the CEO's notifications feed
 * (lights the bell + realtime push via the notifications service). Only NEW
 * rows reach here — suppressed duplicates return null from `raise` — so the
 * bell never re-pings for an alert that's already open.
 */
async function notifyUrgent(created) {
  const urgent = created.filter(
    (i) => i.severity === "high" || i.severity === "critical",
  );
  if (urgent.length === 0) return;
  // Lazy-require to keep this module's load graph light + cycle-free.
  const notifications = require("../../services/notifications.service");
  const { query } = require("../../config/database");
  let ceoId = null;
  try {
    const { rows } = await query(
      `SELECT user_id FROM shared.users WHERE is_ceo = true ORDER BY created_at LIMIT 1`,
    );
    ceoId = rows[0] ? rows[0].user_id : null;
  } catch {
    ceoId = null;
  }
  if (!ceoId) return;
  for (const i of urgent) {
    try {
      await notifications.notify({
        user_id: ceoId,
        business: i.business,
        type: "insight",
        priority: i.severity === "critical" ? "urgent" : "high",
        title: i.title,
        body: i.body,
        reference_type: "ai_insight",
        reference_id: i.insight_id,
        action_url: i.drill_route,
      });
    } catch (err) {
      logger.warn(
        { err: err.message, insight_id: i.insight_id },
        "insight notify failed",
      );
    }
  }
}

module.exports = {
  list,
  summary,
  getOne,
  acknowledge,
  resolve,
  dismiss,
  listModules,
  updateModule,
  raise,
  raiseInsight,
  notifyUrgent,
  runDetectorSweep,
  MODULE_KEYS: registry.MODULE_KEYS,
};
