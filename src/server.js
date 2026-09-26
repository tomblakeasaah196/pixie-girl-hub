/**
 * Pixie Girl Hub — Backend Server Entry Point
 *
 * Responsibilities:
 *   - Load environment & validate
 *   - Initialise DB pool, Redis, Socket.io
 *   - Mount routes
 *   - Bind global middleware
 *   - Start HTTP server + workers
 *
 * Process lifecycle:
 *   - SIGTERM/SIGINT → graceful shutdown (drain connections, close pool, flush logs)
 */

"use strict";

require("dotenv").config();
require("express-async-errors");

const http = require("http");
const express = require("express");
const path = require("path");

const { config, validateEnv } = require("./config/env");
const { logger } = require("./config/logger");
const { initDatabase, closeDatabase } = require("./config/database");
const { refreshBrands } = require("./config/brands");
const { initRedis, closeRedis } = require("./config/redis");
const { initSocketIo, closeSocketIo } = require("./config/socket");

const { applyGlobalMiddleware } = require("./middleware");
const { mountRoutes } = require("./routes");
const { startWorkers, stopWorkers } = require("./jobs/worker");
const { errorHandler, notFoundHandler } = require("./middleware/error-handler");
const { isStaticAssetPath } = require("./utils/spa-fallback");
const { captureError } = require("./modules/kaizen/errors/errors.capture");
const {
  perfMiddleware,
  startAutoFlush: startPerfFlush,
} = require("./modules/kaizen/perf/perf.middleware");
const geoip = require("./services/geoip");

async function bootstrap() {
  // ── Validate environment first; fail fast ──────────────
  validateEnv();
  logger.info({ env: config.NODE_ENV }, "starting pixiegirl-hub-backend");

  // ── Initialise external connections ────────────────────
  await initDatabase();
  logger.info("database connected");

  // ── Load the brand registry from business_config (W-11) ─
  // Must come after the DB pool is up and before requests/crons so every
  // per-brand guard sees the full, current set of brands.
  await refreshBrands();

  await initRedis();
  logger.info("redis connected");

  // ── AI config sanity (non-fatal) ───────────────────────
  // Warns loudly at boot if the Gemini endpoint is missing/misconfigured,
  // so a bad host (the classic gemini.api.google.com typo) screams here
  // instead of silently 503-ing every AI feature at request time.
  //
  // Follow-up: also fires an asynchronous "live" ping against every
  // configured vendor and writes a health row (see aiHealthCron). The
  // await guarantees the sanity warning lands in logs before we mount
  // routes; the live pings are fire-and-forget so slow vendors never
  // block boot.
  await require("./services/gemini.service").checkConfigAtBoot();
  require("./modules/ai_governance/health.service")
    .pingAllVendorsInBackground({ source: "boot" });

  // ── SMTP config sanity (non-fatal) ─────────────────────
  // Warns loudly if the SMTP relay is placeholder-shaped (localhost / port 25 /
  // no auth), so a dev default left in production screams here instead of
  // silently dropping every transactional email. `npm run smtp:doctor` does
  // the live connect + test send.
  require("./services/email.service").checkConfigAtBoot();

  // ── GeoIP local database ───────────────────────────────
  // Non-fatal: the server starts fine without the mmdb file; geo lookups
  // return null and the currency middleware falls back to the default (USD).
  await geoip.init();

  // ── Build Express app ──────────────────────────────────
  const app = express();
  applyGlobalMiddleware(app);
  // Kaizen perf timing — after global middleware (request-id), before routers.
  app.use(perfMiddleware);
  startPerfFlush();
  mountRoutes(app);
  // Approval inbox wiring. MUST be registered in the WEB process: approvals
  // are decided over HTTP, so the workflow engine's in-process events fire
  // here. Without it an approver is never told a decision is waiting and no
  // task is ever closed when one is made.
  try {
    require("./shared/approvals/approvals.subscribers");
  } catch (err) {
    logger.warn(
      { err: err.message },
      "approval subscribers init failed (non-fatal)",
    );
  }
  // Kaizen alert subscribers (this process emits error events). Guarded: Kaizen
  // must never break the main app boot.
  try {
    require("./modules/kaizen/alerts/alerts.subscribers").init();
  } catch (err) {
    logger.warn({ err: err.message }, "kaizen subscribers init failed (non-fatal)");
  }
  // Pre-order allocation subscribers. MUST be registered in the WEB process for
  // the manual "Run backfill" endpoint: it runs the reconcile here over HTTP and
  // emits `preorder.allocated` in-process, so without this listener the ops +
  // sales notification would never fire for a manual run. (The outbox handler it
  // also registers is inert here — the web process never dispatches the outbox.)
  try {
    require("./modules/sales/preorder-allocation.subscribers");
  } catch (err) {
    logger.warn(
      { err: err.message },
      "preorder allocation subscribers init failed (non-fatal)",
    );
  }

  // ── ERP frontend (Vite + React build) ────────────────────
  // The ERP frontend is served from the SAME origin as the
  // API (app.orikaliving.com). The Vite apps/admin calls the API at the
  // relative path `/api`, so frontend and backend are same-origin in
  // production — no CORS between them.
  //
  // Build step (run in apps/admin/ before deploy):  npm run build
  // → outputs to apps/admin/dist
  //
  // Order matters:
  //   - this block sits AFTER `/api` routes, so API calls are never
  //     shadowed by the static handler or the SPA fallback;
  //   - the SPA fallback returns index.html for any non-API GET that
  //     isn't a real file, so React Router owns apps/admin-side routing;
  //   - the JSON 404 below now only fires for unmatched /api/* routes.
  const clientDist = path.join(__dirname, "..", "apps/admin", "dist");

  app.use("/media", express.static(path.resolve(config.STORAGE_LOCAL_ROOT)));

  // Cache policy is the difference between a deploy reaching users and a
  // deploy silently dying in a stale client (see PR #100). Two rules:
  //   - Vite emits content-hashed files under /assets/* — their URL changes
  //     whenever the bytes change, so they are safe to cache forever.
  //   - index.html and sw.js are the *entry points* that point at those
  //     hashes; they must never be cached, or the browser keeps loading an
  //     old shell that references old bundles and no deploy is ever seen.
  app.use(
    express.static(clientDist, {
      setHeaders: (res, filePath) => {
        const base = path.basename(filePath);
        if (base === "index.html" || base === "sw.js") {
          res.setHeader("Cache-Control", "no-cache, must-revalidate");
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  app.get("*", (req, res, next) => {
    // Never let the SPA fallback answer an API request — an unknown
    // /api route must still return the JSON 404 below, not index.html.
    if (req.path.startsWith("/api") || req.path.startsWith("/media")) {
      return next();
    }
    // Never return the HTML shell for a static asset request. If a hashed
    // file under /assets/ (or a real web-asset extension) wasn't found by
    // express.static above, it's a missing/partial deploy — answer 404 so the
    // browser gets a clean error instead of index.html served as text/html
    // (which triggers "MIME type ('text/html') is not a supported stylesheet").
    //
    // isStaticAssetPath uses an extension ALLOW-LIST, not "any trailing
    // dotted segment" — a JWT in the path (/order/capture/<a.b.c>,
    // /welcome/:token, /sign/:token, /offer/:token) is NOT a file, and the
    // old broad regex 404'd ~26% of those links at random (a base64url
    // signature with no '-'/'_' looked like a file extension). See
    // src/utils/spa-fallback.js.
    if (isStaticAssetPath(req.path)) {
      return next();
    }
    // The SPA shell must always be revalidated so a new build is picked up
    // on the very next navigation — never served from a stale browser cache.
    res.sendFile(
      path.join(clientDist, "index.html"),
      { headers: { "Cache-Control": "no-cache, must-revalidate" } },
      (err) => {
        // If the build is missing (client/dist not built yet) fall
        // through to the 404 rather than crashing the request.
        if (err) next();
      },
    );
  });

  // JSON 404 for unknown API routes and global error handler
  app.use(notFoundHandler);
  app.use(errorHandler);

  // ── Wrap in HTTP server so we can attach Socket.io ─────
  const server = http.createServer(app);
  await initSocketIo(server);
  logger.info("socket.io ready");

  // ── Start background workers (queues + cron) ───────────
  if (config.ENABLE_WORKERS) {
    await startWorkers();
    logger.info("workers started");
  }

  // ── Listen ─────────────────────────────────────────────
  server.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, "server listening");
  });

  // ── Graceful shutdown ──────────────────────────────────
  // Order: stop accepting new work → DRAIN in-flight HTTP (await server.close)
  // → stop workers → socket → redis → db. A force-exit failsafe guards against
  // a hung keep-alive socket wedging the drain. Re-entrancy guard so a second
  // signal doesn't re-enter. Crash paths exit non-zero so the supervisor sees
  // the failure (R-4 / C-1).
  let isShuttingDown = false;
  const closeHttp = () =>
    new Promise((resolve) => {
      server.close((err) => {
        if (err) logger.error({ err }, "http server close error");
        else logger.info("http server closed (drained)");
        resolve();
      });
    });

  const shutdown = async (signal, exitCode = 0) => {
    if (isShuttingDown) {
      logger.warn({ signal }, "shutdown already in progress; ignoring");
      return;
    }
    isShuttingDown = true;
    logger.warn({ signal, exitCode }, "shutdown requested");

    // Failsafe: never let teardown hang the process indefinitely.
    const forceTimer = setTimeout(() => {
      logger.fatal("shutdown timed out after 10s — forcing exit");
      process.exit(exitCode || 1);
    }, 10_000);
    forceTimer.unref();

    // Stop taking new connections and wait for in-flight requests to finish
    // BEFORE tearing down the pool/redis they depend on.
    await closeHttp();
    await stopWorkers().catch((e) => logger.error(e, "worker stop failed"));
    await require("./services/pdf.service")
      .shutdown()
      .catch((e) => logger.error(e, "pdf browser close failed"));
    await closeSocketIo().catch((e) =>
      logger.error(e, "socket.io close failed"),
    );
    await closeRedis().catch((e) => logger.error(e, "redis close failed"));
    await closeDatabase().catch((e) =>
      logger.error(e, "database close failed"),
    );

    clearTimeout(forceTimer);
    logger.info("shutdown complete");
    process.exit(exitCode);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM", 0));
  process.on("SIGINT", () => shutdown("SIGINT", 0));

  // ── Crash-safety ───────────────────────────────────────
  // Exit non-zero so process managers (pm2/systemd/k8s) restart and surface it.
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaught exception");
    captureError(err, null, {
      source: "backend",
      code: "UNCAUGHT_EXCEPTION",
      severity: "critical",
    });
    shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "unhandled rejection");
    captureError(reason, null, {
      source: "backend",
      code: "UNHANDLED_REJECTION",
      severity: "critical",
    });
    shutdown("unhandledRejection", 1);
  });
}

bootstrap().catch((err) => {
  /// eslint-disable-next-line no-console
  console.error("Fatal bootstrap error:", err);
  process.exit(1);
});
