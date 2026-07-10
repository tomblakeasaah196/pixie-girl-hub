/**
 * Environment configuration.
 * Loaded once at boot, validated against a Zod schema. Throws if anything
 * critical is missing or wrongly typed — fail fast.
 */

"use strict";

// Load .env as a side-effect of requiring this module. Because every entrypoint
// (server, standalone worker, CLI scripts) reaches env through `config`, doing
// it here guarantees process.env is populated before the lazy validateEnv()
// runs — no entrypoint has to remember to call dotenv first. Idempotent:
// dotenv won't overwrite vars already set by the shell/host, and a second
// call from server.js is harmless.
require("dotenv").config();

const { z } = require("zod");

// Env vars arrive as strings. z.coerce.boolean() is Boolean(str), so the string
// "false" → true (every non-empty string is truthy) — a classic footgun that
// silently flips DB_SSL=false, COOKIE_SECURE=false, RLS_READ_ENFORCE=false, etc.
// to true. zBool parses the usual truthy/falsy spellings explicitly instead.
const zBool = (def) =>
  z
    .preprocess((v) => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (["true", "1", "yes", "on"].includes(s)) return true;
        if (["false", "0", "no", "off", ""].includes(s)) return false;
      }
      return v;
    }, z.boolean())
    .default(def);

const schema = z.object({
  // App
  NODE_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_NAME: z.string().default("pixiegirl-hub-backend"),
  APP_URL: z.string().url().default("http://localhost:7000"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  TZ: z.string().default("Africa/Lagos"),

  // Database
  DB_HOST: z.string(),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_POOL_MIN: z.coerce.number().int().nonnegative().default(2),
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  DB_SSL: zBool(false),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  // Redis
  REDIS_HOST: z.string(),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),

  // Auth
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("45m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("14d"),
  // Idle-session timeout for staff/admin sessions: the session dies after
  // this many seconds without proven user activity, enforced server-side in
  // authMiddleware and /auth/refresh (see shared/hr_payroll/session-idle.js).
  SESSION_IDLE_TIMEOUT_S: z.coerce
    .number()
    .int()
    .positive()
    .default(45 * 60),
  // Hard cap on total session age since the last real credential check.
  // Refresh rotation re-issues full-length tokens on every use, so without
  // this cap a regularly-active user would never re-authenticate at all.
  SESSION_ABSOLUTE_MAX_S: z.coerce
    .number()
    .int()
    .positive()
    .default(14 * 24 * 60 * 60),
  SESSION_SECRET: z.string().min(32),
  COOKIE_SECURE: zBool(false),
  COOKIE_DOMAIN: z.string().default("localhost"),
  ENCRYPTION_KEY: z
    .string()
    .length(
      64,
      "ENCRYPTION_KEY must be exactly 32 bytes hex-encoded (64 chars)",
    ),
  // Password hashing (argon2id). Tunable cost so hashing can be strengthened
  // without code changes; defaults match argon2's built-in defaults.
  ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(65536),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(3),

  // CORS
  CORS_ORIGINS: z.string().default(""),

  // Content-Security-Policy (admin SPA served same-origin as the API).
  // Enforcing by default; flip CSP_REPORT_ONLY=true to observe violations
  // without blocking while tuning. Extra hosts (deploy-specific CDNs, map/
  // analytics vendors) can be appended per-directive as comma-separated lists
  // without a code change.
  CSP_ENABLED: z.coerce.boolean().default(true),
  CSP_REPORT_ONLY: z.coerce.boolean().default(false),
  CSP_EXTRA_SCRIPT_SRC: z.string().default(""),
  CSP_EXTRA_CONNECT_SRC: z.string().default(""),
  CSP_EXTRA_IMG_SRC: z.string().default(""),
  CSP_EXTRA_FRAME_SRC: z.string().default(""),

  // Express `trust proxy`. An integer string → number of hops to trust; a CSV
  // of keywords/IPs (e.g. "loopback,uniquelocal") → trusted addresses.
  TRUSTED_PROXIES: z.string().default("1"),

  // Storage
  STORAGE_KIND: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_ROOT: z.string().default("./media"),
  CDN_BASE_URL: z.string().optional(),
  MEDIA_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(200),

  // FFmpeg
  FFMPEG_PATH: z.string().default("/usr/bin/ffmpeg"),
  FFPROBE_PATH: z.string().default("/usr/bin/ffprobe"),

  // Payment gateways — all optional at boot (loaded per-brand from business_config too)
  PAYSTACK_SECRET_KEY: z.string().optional(),
  // OPay (Cashier API)
  OPAY_PUBLIC_KEY: z.string().optional(),
  OPAY_PRIVATE_KEY: z.string().optional(),
  OPAY_MERCHANT_ID: z.string().optional(),
  OPAY_BASE_URL: z.string().url().default("https://liveapi.opaycheckout.com"),
  // Nomba (OAuth client-credentials)
  NOMBA_API_KEY: z.string().optional(), // client secret
  NOMBA_CLIENT_ID: z.string().optional(),
  NOMBA_ACCOUNT_ID: z.string().optional(),
  NOMBA_BASE_URL: z.string().url().default("https://api.nomba.com"),
  // Nomba is per-brand: each business has its own Nomba account. The unprefixed
  // NOMBA_* above stays as a legacy single-tenant fallback.
  PIXIE_NOMBA_CLIENT_ID: z.string().optional(),
  PIXIE_NOMBA_API_KEY: z.string().optional(),
  PIXIE_NOMBA_ACCOUNT_ID: z.string().optional(),
  FAITLYN_NOMBA_CLIENT_ID: z.string().optional(),
  FAITLYN_NOMBA_API_KEY: z.string().optional(),
  FAITLYN_NOMBA_ACCOUNT_ID: z.string().optional(),
  // Nomba webhook signature key — a SEPARATE secret set in the Nomba dashboard
  // (Developer → Webhook Setup), NOT the API client secret. Used only to VERIFY
  // inbound webhooks (HMAC-SHA256 over the canonical field string). Unprefixed
  // is the legacy single-tenant fallback; per-brand overrides mirror the API keys.
  NOMBA_WEBHOOK_SIG_KEY: z.string().optional(),
  PIXIE_NOMBA_WEBHOOK_SIG_KEY: z.string().optional(),
  FAITLYN_NOMBA_WEBHOOK_SIG_KEY: z.string().optional(),
  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Gateways live in THIS deployment (comma list). OPay + Stripe stay fully
  // implemented but off by default — list them here to re-enable for a project.
  ENABLED_PAYMENT_GATEWAYS: z.string().default("paystack,nomba"),

  // Communication
  META_WA_PHONE_ID: z.string().optional(),
  META_WA_TOKEN: z.string().optional(),
  META_WA_VERIFY_TOKEN: z.string().optional(),
  // App Secret for WA inbound payload HMAC verification (X-Hub-Signature-256)
  META_WA_APP_SECRET: z.string().optional(),
  META_IG_ACCESS_TOKEN: z.string().optional(),
  META_GRAPH_VERIFY_TOKEN: z.string().optional(),
  // App Secret for IG/Messenger inbound payload HMAC verification.
  // Can equal META_WA_APP_SECRET when both run under the same Meta app.
  META_IG_APP_SECRET: z.string().optional(),

  // Cloudflare Email Routing → inbound webhook HMAC secret. Configure
  // the same secret in the Email Worker that signs forwarded mail.
  CF_EMAIL_INBOUND_SECRET: z.string().optional(),

  // Storefront base URL used in customer-facing links (pay-link,
  // onboarding form, etc.).
  STOREFRONT_BASE_URL: z.string().url().optional(),
  ADMIN_BASE_URL: z.string().url().optional(),

  // Google Maps / Places — browser-side key powering address autocomplete on
  // the public Walk-in + Online-QR forms. Surfaced to the client at RUNTIME
  // via GET /api/public/config, so setting it on the live server takes effect
  // without rebuilding the admin bundle (a Vite VITE_* var would not). The key
  // is meant to be public; lock it down with HTTP-referrer restrictions in the
  // Google Cloud console.
  GOOGLE_MAPS_API_KEY: z.string().optional(),

  // Social posting (V2.2 §6.14). Per-platform publish creds; blank → that
  // platform's publish/metrics calls are skipped with a clear error.
  META_GRAPH_VERSION: z.string().default("v21.0"),
  META_IG_USER_ID: z.string().optional(), // IG Business account id (publish target)
  META_FB_PAGE_ID: z.string().optional(),
  META_FB_PAGE_TOKEN: z.string().optional(), // page access token (FB + IG publish)
  TIKTOK_ACCESS_TOKEN: z.string().optional(),
  TIKTOK_BASE_URL: z.string().url().default("https://open.tiktokapis.com"),
  YOUTUBE_ACCESS_TOKEN: z.string().optional(), // OAuth token with youtube.upload scope
  YOUTUBE_BASE_URL: z.string().url().default("https://www.googleapis.com"),

  // Paid ads — Google Ads + Meta Marketing (V2.2 §6.15 live sync). App-level
  // creds only; per-ad-account OAuth tokens are stored AES-encrypted on
  // shared.ad_accounts. Blank for a network → its pull/push returns a clean 503
  // and the nightly sync skips it.
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().optional(), // MCC id, digits only
  GOOGLE_ADS_API_VERSION: z.string().default("v17"),
  GOOGLE_ADS_BASE_URL: z
    .string()
    .url()
    .default("https://googleads.googleapis.com"),
  GOOGLE_OAUTH_TOKEN_URL: z
    .string()
    .url()
    .default("https://oauth2.googleapis.com/token"),
  // Meta Marketing rides the Graph API (META_GRAPH_VERSION above). Optional
  // system-user token; per-account tokens are preferred. App secret (optional)
  // enables appsecret_proof on calls.
  META_MARKETING_API_KEY: z.string().optional(),
  META_ADS_APP_SECRET: z.string().optional(),

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // Implicit TLS from the first byte (port 465). Leave false for a 587 relay —
  // the transport still upgrades to STARTTLS there (see email.service). Only a
  // loopback dev relay (MailHog/sendmail) sends plaintext.
  SMTP_SECURE: zBool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM_EMAIL: z.string().email().optional(),
  SMTP_FROM_NAME: z.string().optional(),

  // Logistics
  CHOWDECK_API_KEY: z.string().optional(),
  GIGL_API_KEY: z.string().optional(),

  // Geolocation (MaxMind GeoLite2 local database)
  MAXMIND_DB_PATH: z.string().default("./data/GeoLite2-Country.mmdb"),
  // Free licence key from maxmind.com — required only for automated weekly
  // database updates (CRON_GEOIP_DB_UPDATE). IP lookups work without it once
  // the .mmdb file is placed at MAXMIND_DB_PATH.
  MAXMIND_LICENSE_KEY: z.string().optional(),
  // MaxMind account ID (numeric). Required alongside MAXMIND_LICENSE_KEY for
  // Basic Auth on the download endpoint. Free accounts: use your account ID.
  MAXMIND_ACCOUNT_ID: z.string().optional(),
  // node-cron expression for the weekly database update (default: Sun 02:00 WAT).
  CRON_GEOIP_DB_UPDATE: z.string().default("0 2 * * 0"),

  // AI
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  GROQ_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  // Gemini (Google Generative Language API). Free dev tier on the public
  // endpoint; vertex AI uses a different base URL.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z
    .string()
    .url()
    .default("https://generativelanguage.googleapis.com"),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  // Fallback vendor — when the primary call fails (5xx, timeout, rate
  // limit) the orchestrator tries this vendor before throwing.
  PRAXIS_LLM_FALLBACK_VENDOR: z.string().default("gemini"),
  AI_MONTHLY_SOFT_CAP_NGN: z.coerce.number().nonnegative().default(75000),
  AI_MONTHLY_HARD_CAP_NGN: z.coerce.number().nonnegative().default(80000),
  // Optional: email address that receives AI ops alerts (vendor down,
  // failover spike, hard-cap breach). Leave blank to disable — the alert
  // is still logged as an error in pm2 either way.
  AI_ALERT_EMAIL: z.string().optional(),
  // Cron: hourly vendor health ping (Q6). Set to "off" to disable.
  CRON_AI_VENDOR_HEALTH_PING: z.string().default("15 * * * *"),

  // Shade Finder (public Praxis shade match on the storefront). Photo
  // analyses per device per day; a wider per-IP ceiling backstops device-id
  // resets; follow-up text turns get their own (cheaper) daily cap.
  SHADE_FINDER_DAILY_LIMIT: z.coerce.number().int().positive().default(10),
  SHADE_FINDER_IP_DAILY_LIMIT: z.coerce.number().int().positive().default(30),
  SHADE_FINDER_CHAT_DAILY_LIMIT: z.coerce.number().int().positive().default(60),
  // Guest session lifetime (Redis TTL + guest-token expiry), seconds.
  SHADE_FINDER_SESSION_TTL_S: z.coerce.number().int().positive().default(7200),
  // Largest raw photo upload accepted before the shared compressor ever runs
  // (multer memoryStorage limit). Below this, oversized phone-camera shots
  // fail with a clear message instead of a silent/generic error.
  SHADE_FINDER_MAX_PHOTO_MB: z.coerce.number().int().positive().default(20),

  // Shop AI Search (public "ask Praxis" natural-language search on the shop
  // page). One Gemini text turn per search; the client resends recent turns
  // as history so a follow-up ("something cheaper") needs no server session.
  SHOP_AI_SEARCH_DAILY_LIMIT: z.coerce.number().int().positive().default(20),
  SHOP_AI_SEARCH_IP_DAILY_LIMIT: z.coerce.number().int().positive().default(60),

  // Observability
  SENTRY_DSN: z.string().optional(),
  ENABLE_REQUEST_LOGGING: zBool(true),
  ENABLE_AUDIT_LOG: zBool(true),

  // PDF rendering (J-7 / X-1 — headless-Chromium HTML→PDF)
  PDF_ENABLED: zBool(true),
  // Optional: path to a system Chromium (e.g. /usr/bin/chromium). When unset,
  // puppeteer uses its bundled Chromium.
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),
  PDF_RENDER_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  // FX rate provider (J-3). No key → the refresh cron no-ops gracefully.
  FX_PROVIDER: z
    .enum(["none", "openexchangerates", "exchangerate_host", "fixer"])
    .default("none"),
  FX_API_KEY: z.string().optional(),
  FX_API_BASE_URL: z.string().url().optional(),
  FX_BASE_CURRENCY: z.string().length(3).default("NGN"),
  FX_BUFFER_PCT: z.coerce.number().min(0).max(1).default(0),

  // Embeddings / RAG vendor (J-8 / X-2). No key → ai-embed + Praxis RAG skip.
  EMBEDDINGS_PROVIDER: z
    .enum(["none", "openai", "deepseek", "voyage"])
    .default("none"),
  EMBEDDINGS_API_KEY: z.string().optional(),
  EMBEDDINGS_API_BASE_URL: z.string().url().optional(),
  EMBEDDINGS_MODEL: z.string().default("text-embedding-3-small"),
  PRAXIS_ORCHESTRATOR_ENABLED: zBool(false),
  // Which ai_vendor_credentials row backs Praxis's chat LLM (creds live in DB /
  // AI Control, not env). RAG retrieval depth + answer token budget.
  PRAXIS_LLM_VENDOR: z.string().default("deepseek"),
  PRAXIS_RAG_TOP_K: z.coerce.number().int().min(0).max(20).default(6),
  PRAXIS_MAX_TOOLS: z.coerce.number().int().min(1).max(128).default(40),
  // Minimum cosine similarity (1 - distance) for a retrieved chunk to enter
  // the prompt. Top-K nearest-neighbour ALWAYS returns k rows, so without a
  // floor an off-corpus question gets unrelated chunks presented as
  // grounding. 0.3 is conservative for text-embedding-3-small; raise it once
  // corpus relevance has been observed in ai_run_steps traces.
  PRAXIS_RAG_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.3),
  // Max output tokens per Praxis LLM completion. Answers were being cut off
  // mid-table because no cap was sent and the vendor's implicit default is low;
  // 4096 comfortably fits a long answer (e.g. a 27-row order table), and the
  // continuation helper stitches anything that still hits the cap.
  PRAXIS_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(256)
    .max(32000)
    .default(4096),

  // Feature flags
  FEATURE_MANUAL_PAYMENTS_ENABLED: zBool(false),
  FEATURE_PRAXIS_VOICE_ENABLED: zBool(true),
  FEATURE_UGC_INGESTION_ENABLED: zBool(true),
  ENABLE_WORKERS: zBool(true),

  // H-1 read-side RLS: when true, one-shot reads with an ambient brand context
  // run inside a minimal transaction so app.current_business is set and RLS
  // filters them — closing the read-side of SEC-2 (a mis-scoped repo read is
  // filtered by the DB instead of leaking cross-brand). Costs BEGIN/COMMIT
  // round-trips per read; set RLS_READ_ENFORCE=false in the environment to
  // fall back without a deploy. Two prerequisites for it to actually filter:
  // the DB connection must NOT be a superuser (initDatabase warns loudly at
  // boot if it is), and write paths (transaction()) already set the GUC
  // regardless of this flag.
  RLS_READ_ENFORCE: zBool(true),

  // Password-reset link lifetime (minutes). Token is single-use and stored only
  // as a SHA-256 hash in redis.
  PASSWORD_RESET_TTL_MIN: z.coerce.number().int().positive().default(30),

  // Identity cache (shared/cache/identity-cache.js): TTL in seconds for the
  // per-request user / brand-config / permission-grant lookups. Domain events
  // invalidate eagerly; the TTL is the staleness backstop. 0 disables the
  // cache entirely (every request goes straight to the DB — the escape hatch).
  IDENTITY_CACHE_TTL_S: z.coerce.number().int().min(0).default(30),

  // Per-IP throttle for unauthenticated write endpoints (middleware/index.js).
  PUBLIC_WRITE_RATE_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  PUBLIC_WRITE_RATE_MAX: z.coerce.number().int().positive().default(20),

  // SMS support was retired in PR 2 — every retention workflow runs on
  // email + WhatsApp + Instagram via the outbound channel policy. The
  // Twilio env vars previously lived here; leaving the slot for future
  // SMS-OTP-only reintroduction (Termii etc.) if ever needed.

  // Speech-to-text (Whisper) for Praxis voice input. Unset → transcription
  // no-ops. MEDIA_BASE_URL bounds which audio origins may be fetched (SSRF).
  TRANSCRIPTION_PROVIDER: z.string().default("none"),
  TRANSCRIPTION_API_KEY: z.string().optional(),
  TRANSCRIPTION_API_BASE_URL: z.string().optional(),
  TRANSCRIPTION_MODEL: z.string().optional(),
  MEDIA_BASE_URL: z.string().optional(),

  // Web Push (VAPID) — browser push notifications. All three unset → push is
  // inert (push.service isConfigured() false). Generate keys with web-push.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_EMAIL: z.string().optional(),

  // Cron schedules (worker). Overridable; defaults preserve the built-in
  // cadence. Operational sweeps (queues, reminders) stay literal in worker.js.
  CRON_DAILY_AI_BRIEFING: z.string().default("0 7 * * *"),
  CRON_WEEKLY_SALES_REPORT: z.string().default("0 20 * * 6"),
  CRON_WEEKLY_CUSTOMER_REPORT: z.string().default("0 20 * * 6"),
  CRON_LAYAWAY_ABANDONMENT_CHECK: z.string().default("0 2 * * *"),
  CRON_FX_RATE_REFRESH: z.string().default("0 6 * * *"),
  CRON_LOW_STOCK_ALERTS: z.string().default("0 8,14 * * *"),

  // ── Kaizen (maintenance/ops console) ─────────────────────────────────────
  // All optional/defaulted so the main app boots even when Kaizen isn't wired.
  // The Kaizen auth service fails fast (with a clear message) on the login path
  // if KAIZEN_JWT_SECRET is missing — it never affects the rest of the API.
  KAIZEN_JWT_SECRET: z.string().optional(),
  KAIZEN_ACCESS_TTL: z.string().default("30m"),
  KAIZEN_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(14),
  KAIZEN_INVITE_TTL_HOURS: z.coerce.number().int().positive().default(72),
  KAIZEN_BASE_URL: z.string().url().default("http://localhost:5174"),
  KAIZEN_COOKIE_DOMAIN: z.string().optional(),
  // Phase 1 — frontend error ingest. When KAIZEN_INGEST_KEY is unset the ingest
  // endpoint returns 503 (disabled); client apps then simply don't report.
  KAIZEN_INGEST_KEY: z.string().optional(),
  KAIZEN_INGEST_ALLOWED_ORIGINS: z.string().optional(), // comma-separated
  KAIZEN_CAPTURE_4XX: zBool(false), // capture 4xx as errors too (noisy — off by default)
});

let _config = null;

function validateEnv() {
  if (_config) return _config;
  // Treat a present-but-blank var as unset. dotenv assigns "" for a bare key
  // (e.g. `FX_API_BASE_URL=` in .env); without this, optional .url()/.email()
  // fields would fail validation on an empty string instead of falling through
  // to their default/optional. Required fields still error (as "Required").
  const source = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string" && v.trim() === "") continue;
    source[k] = v;
  }
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  _config = Object.freeze(parsed.data);
  return _config;
}

// Lazy proxy. Accessing `config.X` validates the environment on first touch
// (process.env is already loaded by dotenv), so `config` is a true drop-in env
// wrapper usable anywhere — including module-level constants that run at
// require() time, before bootstrap() reaches its explicit validateEnv() call.
// validateEnv() is idempotent, so the explicit boot-time call still gives a
// clean fail-fast with the full list of bad vars.
const config = new Proxy(
  {},
  {
    get(_, prop) {
      if (!_config) validateEnv();
      return _config[prop];
    },
  },
);

module.exports = { config, validateEnv };
