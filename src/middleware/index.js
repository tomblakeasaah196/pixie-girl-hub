/**
 * Global middleware setup. Order matters — applied in sequence.
 */

"use strict";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const pinoHttp = require("pino-http");

const { config } = require("../config/env");
const { logger } = require("../config/logger");
const { requestIdMiddleware } = require("./request-id");

function applyGlobalMiddleware(app) {
  // Behind a proxy (nginx, etc.) — trust X-Forwarded-* headers. An integer
  // string → hop count; a CSV of keywords/IPs → trusted addresses.
  const trustProxy = config.TRUSTED_PROXIES;
  app.set(
    "trust proxy",
    /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy,
  );

  // Cloudflare (and some other CDNs/reverse-proxies) set headers that
  // carry the true client IP regardless of how many hops exist. Override
  // req.ip early so every downstream consumer (rate limiters, controllers,
  // audit) sees the real address without per-callsite patching.
  app.use((req, _res, next) => {
    const cdnIp = req.headers["cf-connecting-ip"] || req.headers["x-real-ip"];
    if (cdnIp && typeof cdnIp === "string") {
      const clean = cdnIp.split(",")[0].trim();
      if (clean) {
        Object.defineProperty(req, "ip", { value: clean, writable: true });
      }
    }
    next();
  });

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: false, // storefront has its own CSP via Next.js
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  // CORS
  app.use(
    cors({
      origin: config.CORS_ORIGINS.split(",").filter(Boolean),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Brand-Context",
        "X-Request-Id",
      ],
    }),
  );

  app.use(compression());
  app.use(cookieParser(config.SESSION_SECRET));
  // Capture the raw body buffer (req.rawBody) while parsing JSON, so inbound
  // webhook receivers can verify HMAC signatures over the exact bytes (H-4).
  app.use(
    express.json({
      limit: "10mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  app.use(requestIdMiddleware);

  if (config.ENABLE_REQUEST_LOGGING) {
    app.use(
      pinoHttp({
        logger,
        customLogLevel(_req, res, err) {
          if (err || res.statusCode >= 500) return "error";
          if (res.statusCode >= 400) return "warn";
          return "info";
        },
        customSuccessMessage(req, res) {
          return `${req.method} ${req.url} → ${res.statusCode}`;
        },
        autoLogging: {
          ignore: (req) => req.url === "/health" || req.url === "/metrics",
        },
      }),
    );
  }

  // Global rate limit (per-route limits applied separately)
  app.use(
    "/api/",
    rateLimit({
      windowMs: 60_000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: {
          code: "TOO_MANY_REQUESTS",
          message: "Slow down — try again in a minute.",
        },
      },
    }),
  );
}

/**
 * Stricter limiter for UNAUTHENTICATED write endpoints (H-10 / D-5): public
 * order-form checkout, newsletter signup, hair-quiz submit, e-sign submit, etc.
 * The global limiter is generous; these blunt enumeration/abuse on writes that
 * create records. Keyed by client IP (trust proxy is set above).
 */
const publicWriteLimiter = rateLimit({
  windowMs: config.PUBLIC_WRITE_RATE_WINDOW_MS,
  max: config.PUBLIC_WRITE_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many submissions — please try again shortly.",
    },
  },
});

module.exports = { applyGlobalMiddleware, publicWriteLimiter };
