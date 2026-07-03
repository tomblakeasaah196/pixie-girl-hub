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

const { RedisStore } = require("rate-limit-redis");

const { config } = require("../config/env");
const { logger } = require("../config/logger");
const { getClient: getRedisClient } = require("../config/redis");
const { requestIdMiddleware } = require("./request-id");
const { geoCurrencyMiddleware } = require("./geo-currency");

/**
 * Redis-backed rate-limit store so limits hold across processes/instances
 * and survive restarts (the default MemoryStore is per-process — two API
 * replicas would double every limit; a deploy resets all counters).
 *
 * NOTE: rate-limit-redis v4's RedisStore constructor eagerly issues a
 * `SCRIPT LOAD` (loadIncrementScript) — so building a store needs a LIVE Redis
 * client, it is NOT safe at require time before initRedis(). `sendCommand` is
 * async so a not-yet-ready / disconnected client surfaces as a rejected promise
 * that `passOnStoreError` fails open on, rather than a synchronous throw that
 * crashes the process. Stores are also only built lazily on first request (see
 * lazyLimiter) — by then startup has finished and Redis is connected.
 */
function redisRateLimitStore(prefix) {
  return new RedisStore({
    prefix,
    sendCommand: async (...args) => getRedisClient().call(...args),
  });
}

/**
 * Wrap a rate-limiter factory so the limiter (and its Redis store) is built on
 * first request instead of at module-load time. This is what lets
 * publicWriteLimiter be `require`d before initRedis() runs — requests only
 * arrive after server.listen(), which is well after Redis is connected.
 */
function lazyLimiter(factory) {
  let mw = null;
  return (req, res, next) => {
    if (!mw) mw = factory();
    return mw(req, res, next);
  };
}

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

  // Geo-currency: attach req.geoCountry + req.geoCurrency from the local
  // MaxMind mmdb reader. Sub-millisecond, never throws, degrades gracefully
  // when the database file is absent (reader returns null → DEFAULT_CURRENCY).
  app.use(geoCurrencyMiddleware);

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

  // Global rate limit (per-route limits applied separately).
  //
  // Exactly ONE limiter guards /api. A second, identical limiter used to be
  // mounted right after this one (an artefact of adding the SSR skip as a new
  // block instead of editing this one): every request was counted against two
  // independent buckets, and because the FIRST limiter had no skip, the
  // localhost exemption below never actually applied — internal storefront
  // SSR calls could be 429'd despite the comment saying otherwise.
  app.use(
    "/api/",
    lazyLimiter(() =>
      rateLimit({
        windowMs: 60_000,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false,
        store: redisRateLimitStore("rl:api:"),
        passOnStoreError: true,
        // Skip rate limiting for internal SSR requests from the storefront
        // (127.0.0.1 / ::1). Real client IP limiting still applies for all
        // external traffic via the cf-connecting-ip / x-real-ip override above.
        skip: (req) => {
          const ip = req.ip || req.socket?.remoteAddress || "";
          return (
            ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1"
          );
        },
        message: {
          error: {
            code: "TOO_MANY_REQUESTS",
            message: "Slow down — try again in a minute.",
          },
        },
      }),
    ),
  );
}

/**
 * Stricter limiter for UNAUTHENTICATED write endpoints (H-10 / D-5): public
 * order-form checkout, newsletter signup, hair-quiz submit, e-sign submit, etc.
 * The global limiter is generous; these blunt enumeration/abuse on writes that
 * create records. Keyed by client IP (trust proxy is set above).
 */
const publicWriteLimiter = lazyLimiter(() =>
  rateLimit({
    windowMs: config.PUBLIC_WRITE_RATE_WINDOW_MS,
    max: config.PUBLIC_WRITE_RATE_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisRateLimitStore("rl:pubw:"),
    passOnStoreError: true,
    message: {
      error: {
        code: "TOO_MANY_REQUESTS",
        message: "Too many submissions — please try again shortly.",
      },
    },
  }),
);

module.exports = { applyGlobalMiddleware, publicWriteLimiter };
