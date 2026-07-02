/**
 * Background worker — BullMQ queues + cron schedules.
 *
 * Started in-process by `src/server.js` when ENABLE_WORKERS=true,
 * or independently by `npm run workers:start` for a dedicated worker
 * dyno in production.
 *
 * Queues:
 *   media-processing   — FFmpeg compress, poster gen
 *   email-send         — outbound transactional + campaign emails
 *   whatsapp-send      — Smartcomm outbound WA messages
 *   webhooks-replay    — failed inbound webhook retries
 *   ai-embed           — RAG ingest jobs
 *   report-generate    — weekly Sales + Customer reports (V2.2 §6.30)
 *
 * Cron jobs (timezone Africa/Lagos):
 *   daily 07:00      — AI Briefing
 *   daily 02:00      — Layaway abandonment check (V2.2 §6.2 — auto-cancel 60d)
 *   Sat 20:00        — Weekly Sales & Customer Reports
 *   daily 06:00      — FX rate refresh
 *   twice/day        — Low-stock alerts
 *   every 15m        — Pending action expiry sweep (Praxis)
 *   every 30m        — Layaway gentle payment reminder
 *   every 30m        — Invoice reminder sweep (F-10)
 *   every 30m        — Webhook replay sweep (H-4 — re-drive stuck webhooks)
 *   daily 03:00      — Soft-FK reconciliation sweep (F-13)
 *   daily 03:30      — Catalogue Trash purge (15-day grace window)
 *   Sun 02:00        — GeoLite2-Country database auto-update (MaxMind)
 */

"use strict";

const cron = require("node-cron");
const { Queue, Worker } = require("bullmq");
const { config } = require("../config/env");
const { logger } = require("../config/logger");
const { getClient: getRedisClient } = require("../config/redis");
const { refreshBrands } = require("../config/brands");
const { withCronLock } = require("./cron-lock");

const queueNames = [
  "media-processing",
  "email-send",
  "whatsapp-send",
  "instagram-send",
  "webhooks-replay",
  "ai-embed",
  "report-generate",
  "cart-ttl",
];

const queues = new Map();
const workers = [];
const cronJobs = [];
let outboxTimer = null;

// How often the worker drains committed outbox rows (H-2). Fast enough that a
// paid order's GL post lands within seconds of commit.
const OUTBOX_POLL_MS = 5000;

function getQueue(name) {
  if (!queues.has(name)) throw new Error(`queue ${name} not initialised`);
  return queues.get(name);
}

async function startWorkers() {
  const connection = getRedisClient();

  // Load the brand registry before any cron fans out across brands. Safe to
  // call even if the host process already refreshed it at boot.
  await refreshBrands();

  // Initialise queues
  for (const name of queueNames) {
    queues.set(name, new Queue(name, { connection }));
  }

  // Workers — each pulls in its processor lazily
  const handlers = {
    "media-processing": require("./processors/media-processor"),
    "email-send": require("./processors/email-processor"),
    "whatsapp-send": require("./processors/whatsapp-processor"),
    "instagram-send": require("./processors/instagram-processor"),
    "webhooks-replay": require("./processors/webhooks-replay-processor"),
    "ai-embed": require("./processors/ai-embed-processor"),
    "report-generate": require("./processors/report-processor"),
    "cart-ttl": require("./processors/cart-ttl-processor").processCartTtl,
  };

  for (const [name, processor] of Object.entries(handlers)) {
    const worker = new Worker(name, processor, { connection, concurrency: 4 });
    worker.on("failed", (job, err) =>
      logger.error({ queue: name, jobId: job?.id, err }, "job failed"),
    );
    worker.on("completed", (job) =>
      logger.debug({ queue: name, jobId: job?.id }, "job completed"),
    );
    workers.push(worker);
  }

  // ── Cron schedules ─────────────────────────────────────
  // Every job runs under a Postgres advisory lock (jobs/cron-lock.js) so a
  // second worker instance — or ENABLE_WORKERS=true on the API alongside a
  // dedicated worker — cannot double-run it (double email sends, double
  // billing). `perInstance: true` opts a job OUT of the lock: jobs that
  // maintain per-PROCESS state (in-memory brand registry, local mmdb file)
  // must run in every instance, not once per fleet.
  const scheduleCron = (name, expr, fn, { perInstance = false } = {}) => {
    const run = perInstance ? fn : () => withCronLock(name, fn);
    const job = cron.schedule(
      expr,
      async () => {
        try {
          await run();
        } catch (err) {
          logger.error({ err, cron: name }, "cron job failed");
        }
      },
      { timezone: config.TZ },
    );
    cronJobs.push({ name, job });
    logger.info({ cron: name, expr, locked: !perInstance }, "cron scheduled");
  };

  const { runDailyAiBriefing } = require("./schedulers/ai-briefing");
  const {
    runWeeklySalesReport,
    runWeeklyCustomerReport,
  } = require("./schedulers/weekly-reports");
  const {
    runLayawayAbandonmentSweep,
  } = require("./schedulers/layaway-abandonment");
  const { runFxRateRefresh } = require("./schedulers/fx-rates");
  const { runLowStockAlerts } = require("./schedulers/low-stock");
  const {
    runPendingActionExpirySweep,
  } = require("./schedulers/ai-pending-expiry");
  const { runLayawayReminders } = require("./schedulers/layaway-reminders");
  const { runWorkflowTimeoutSweep } = require("./schedulers/workflow-timeout");
  const {
    runCampaignStateTransitions,
  } = require("./schedulers/campaign-state-transition");
  const {
    runCampaignMetricsRollup,
  } = require("./schedulers/campaign-metrics-rollup");
  const { runUgcIngestionSweep } = require("./schedulers/ugc-ingest");
  const {
    runScheduledEmailSends,
  } = require("./schedulers/email-campaign-send");
  const { runAiInsightsSweep } = require("./schedulers/ai-insights-sweep");
  const { runRetentionWorkflows } = require("./schedulers/retention-workflows");
  const {
    runRetentionStrategyTick,
  } = require("./schedulers/retention-strategy-tick");
  const {
    runRetentionStrategyScan,
  } = require("./schedulers/retention-strategy-scan");
  const {
    runSubscriptionBilling,
  } = require("./schedulers/subscription-billing");
  const { runInvoiceReminderSweep } = require("./schedulers/invoice-reminders");
  const {
    runSoftFkReconciliation,
  } = require("./schedulers/soft-fk-reconciliation");
  const {
    runChemicalReconciliation,
  } = require("./schedulers/chemical-reconciliation");
  const { runMissingWigCheck } = require("./schedulers/missing-wig-check");
  const { runWebhookReplaySweep } = require("./schedulers/webhook-replay");
  const { runAdSpendSync } = require("./schedulers/ad-spend-sync");
  const { runGeoIpDatabaseUpdate } = require("./schedulers/geoip-updater");
  const {
    runCatalogueTrashPurge,
  } = require("./schedulers/catalogue-trash-purge");
  const { runHrAttendanceSweep } = require("./schedulers/hr-attendance");

  // Re-sync the brand registry so a business provisioned by the API process
  // reaches this worker's crons without a restart. Per-instance: it refreshes
  // THIS process's in-memory Set — every instance must run it itself.
  scheduleCron("brand-registry-refresh", "*/5 * * * *", refreshBrands, {
    perInstance: true,
  });
  scheduleCron("ugc-ingestion", "*/10 * * * *", runUgcIngestionSweep);
  scheduleCron(
    "daily-ai-briefing",
    config.CRON_DAILY_AI_BRIEFING,
    runDailyAiBriefing,
  );
  scheduleCron(
    "weekly-sales-report",
    config.CRON_WEEKLY_SALES_REPORT,
    runWeeklySalesReport,
  );
  scheduleCron(
    "weekly-customer-report",
    config.CRON_WEEKLY_CUSTOMER_REPORT,
    runWeeklyCustomerReport,
  );
  scheduleCron(
    "layaway-abandonment",
    config.CRON_LAYAWAY_ABANDONMENT_CHECK,
    runLayawayAbandonmentSweep,
  );
  scheduleCron(
    "fx-rate-refresh",
    config.CRON_FX_RATE_REFRESH,
    runFxRateRefresh,
  );
  scheduleCron(
    "low-stock-alerts",
    config.CRON_LOW_STOCK_ALERTS,
    runLowStockAlerts,
  );
  scheduleCron(
    "ai-pending-expiry",
    "*/15 * * * *",
    runPendingActionExpirySweep,
  );
  scheduleCron("layaway-reminders", "*/30 * * * *", runLayawayReminders);
  // Nightly HR attendance: reconcile + query reminders + lapsed off-site (23:30 Lagos).
  scheduleCron("hr-attendance-sweep", "30 23 * * *", runHrAttendanceSweep);
  scheduleCron("email-campaign-send", "* * * * *", runScheduledEmailSends);
  scheduleCron("ai-insights-sweep", "*/30 * * * *", runAiInsightsSweep);
  scheduleCron("retention-workflows", "* * * * *", runRetentionWorkflows);
  // Retention strategy engine: advance due enrolments every minute; scan for
  // time-based triggers + expire stale points nightly (02:30 Lagos).
  scheduleCron(
    "retention-strategy-tick",
    "* * * * *",
    runRetentionStrategyTick,
  );
  scheduleCron(
    "retention-strategy-scan",
    "30 2 * * *",
    runRetentionStrategyScan,
  );
  // nightly ad-spend sync (pull metrics from ad networks)
  scheduleCron("ad-spend-sync", "0 2 * * *", runAdSpendSync);
  scheduleCron("subscription-billing", "0 3 * * *", runSubscriptionBilling);
  scheduleCron("workflow-timeout", "*/10 * * * *", runWorkflowTimeoutSweep);
  scheduleCron(
    "campaign-state-transition",
    "* * * * *",
    runCampaignStateTransitions,
  );
  scheduleCron(
    "campaign-metrics-rollup",
    "*/5 * * * *",
    runCampaignMetricsRollup,
  );
  scheduleCron("invoice-reminders", "*/30 * * * *", runInvoiceReminderSweep);
  scheduleCron("webhook-replay", "*/30 * * * *", runWebhookReplaySweep);
  scheduleCron("soft-fk-reconciliation", "0 3 * * *", runSoftFkReconciliation);
  // Daily 03:30 — purge catalogue Trash past its 15-day grace window.
  scheduleCron("catalogue-trash-purge", "30 3 * * *", runCatalogueTrashPurge);
  scheduleCron(
    "chemical-reconciliation",
    "30 3 2 * *",
    runChemicalReconciliation,
  );
  // Daily 08:00 — flag wigs sitting too long with a stylist (accountability).
  scheduleCron("missing-wig-check", "0 8 * * *", runMissingWigCheck);
  // Per-instance: downloads the GeoLite2 mmdb to THIS instance's local disk.
  scheduleCron(
    "geoip-db-update",
    config.CRON_GEOIP_DB_UPDATE,
    runGeoIpDatabaseUpdate,
    { perInstance: true },
  );

  // ── Transactional outbox dispatcher (H-2) ──────────────
  // Register the durable event handlers IN THIS PROCESS (the dispatcher runs
  // here), then poll committed outbox rows. The poller is re-entrancy-guarded
  // inside dispatchDue and uses SKIP LOCKED, so it is safe alongside a second
  // instance.
  const outbox = require("../shared/outbox/outbox");
  // Register every durable order.paid consumer in THIS process (the dispatcher
  // runs here). Each registers a named, idempotent handler with the outbox.
  require("../modules/accounting/accounting.subscribers"); // GL post
  require("../modules/invoicing/invoicing.subscribers"); // auto-invoice
  require("../shared/hr_payroll/commission.subscribers"); // commission accrual
  require("../modules/logistics/logistics.subscribers"); // dispatch delivery
  require("../modules/retention/retention.subscribers"); // loyalty + streak
  require("../shared/notifications/notifications.subscribers"); // rep notification
  require("../modules/sales/timeline.subscribers"); // order.paid → timeline event
  require("../modules/sales/receipt.subscribers"); // order.paid → archive receipt PDF
  require("../modules/sales/duplicate-resolve.subscribers"); // order.paid → cancel pending duplicate twins
  require("../modules/retention/workflow.subscribers"); // order.paid → workflow trigger
  require("../modules/stock/stock.subscribers"); // variant.created → seed stock level
  require("../modules/service_jobs/service-jobs.subscribers"); // order.deposit_met → service job
  require("../modules/business_setup/webhooks.service"); // webhook.received → dispatch
  outboxTimer = setInterval(() => {
    outbox
      .dispatchDue()
      .catch((err) => logger.error({ err }, "outbox dispatch tick failed"));
  }, OUTBOX_POLL_MS);
  outboxTimer.unref();
  logger.info({ pollMs: OUTBOX_POLL_MS }, "outbox dispatcher started");
}

async function stopWorkers() {
  if (outboxTimer) {
    clearInterval(outboxTimer);
    outboxTimer = null;
  }
  for (const { job } of cronJobs) job.stop();
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([...queues.values()].map((q) => q.close()));
  queues.clear();
  workers.length = 0;
  cronJobs.length = 0;
}

module.exports = { startWorkers, stopWorkers, getQueue };
