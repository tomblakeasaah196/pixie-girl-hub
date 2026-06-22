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

  // ── GeoIP local database ───────────────────────────────
  // Non-fatal: the server starts fine without the mmdb file; geo lookups
  // return null and the currency middleware falls back to the default (USD).
  await geoip.init();

  // ── Build Express app ──────────────────────────────────
  const app = express();
  applyGlobalMiddleware(app);
  mountRoutes(app);

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
    // file under /assets/ (or any file with an extension) wasn't found by
    // express.static above, it's a missing/partial deploy — answer 404 so the
    // browser gets a clean error instead of index.html served as text/html
    // (which triggers "MIME type ('text/html') is not a supported stylesheet").
    if (req.path.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(req.path)) {
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
    shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "unhandled rejection");
    shutdown("unhandledRejection", 1);
  });
}

bootstrap().catch((err) => {
  /// eslint-disable-next-line no-console
  console.error("Fatal bootstrap error:", err);
  process.exit(1);
});
