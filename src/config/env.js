/**
 * Environment configuration.
 * Loaded once at boot, validated against a Zod schema. Throws if anything
 * critical is missing or wrongly typed — fail fast.
 */

"use strict";

const { z } = require("zod");

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
  DB_SSL: z.coerce.boolean().default(false),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  // Redis
  REDIS_HOST: z.string(),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),

  // Auth
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("14d"),
  SESSION_SECRET: z.string().min(32),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  COOKIE_DOMAIN: z.string().default("localhost"),
  ENCRYPTION_KEY: z
    .string()
    .length(
      64,
      "ENCRYPTION_KEY must be exactly 32 bytes hex-encoded (64 chars)",
    ),

  // CORS
  CORS_ORIGINS: z.string().default(""),

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
  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Communication
  META_WA_PHONE_ID: z.string().optional(),
  META_WA_TOKEN: z.string().optional(),
  META_WA_VERIFY_TOKEN: z.string().optional(),
  META_IG_ACCESS_TOKEN: z.string().optional(),
  META_GRAPH_VERIFY_TOKEN: z.string().optional(),

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

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM_EMAIL: z.string().email().optional(),
  SMTP_FROM_NAME: z.string().optional(),

  // Logistics
  CHOWDECK_API_KEY: z.string().optional(),
  GIGL_API_KEY: z.string().optional(),

  // Geolocation
  MAXMIND_DB_PATH: z.string().default("./data/GeoLite2-Country.mmdb"),

  // AI
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  GROQ_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  AI_MONTHLY_SOFT_CAP_NGN: z.coerce.number().nonnegative().default(75000),
  AI_MONTHLY_HARD_CAP_NGN: z.coerce.number().nonnegative().default(80000),

  // Observability
  SENTRY_DSN: z.string().optional(),
  ENABLE_REQUEST_LOGGING: z.coerce.boolean().default(true),
  ENABLE_AUDIT_LOG: z.coerce.boolean().default(true),

  // PDF rendering (J-7 / X-1 — headless-Chromium HTML→PDF)
  PDF_ENABLED: z.coerce.boolean().default(true),
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
  PRAXIS_ORCHESTRATOR_ENABLED: z.coerce.boolean().default(false),
  // Which ai_vendor_credentials row backs Praxis's chat LLM (creds live in DB /
  // AI Control, not env). RAG retrieval depth + answer token budget.
  PRAXIS_LLM_VENDOR: z.string().default("deepseek"),
  PRAXIS_RAG_TOP_K: z.coerce.number().int().min(0).max(20).default(6),
  PRAXIS_MAX_TOOLS: z.coerce.number().int().min(1).max(128).default(40),

  // Feature flags
  FEATURE_MANUAL_PAYMENTS_ENABLED: z.coerce.boolean().default(false),
  FEATURE_PRAXIS_VOICE_ENABLED: z.coerce.boolean().default(true),
  FEATURE_UGC_INGESTION_ENABLED: z.coerce.boolean().default(true),
  ENABLE_WORKERS: z.coerce.boolean().default(true),

  // H-1 read-side RLS: when true, one-shot reads with an ambient brand context
  // run inside a minimal transaction so app.current_business is set and RLS
  // filters them. Adds BEGIN/COMMIT round-trips per read — keep OFF until a
  // staging perf check confirms acceptable latency. Write paths (transaction())
  // already set the GUC regardless of this flag.
  RLS_READ_ENFORCE: z.coerce.boolean().default(false),
});

let _config = null;

function validateEnv() {
  if (_config) return _config;
  const parsed = schema.safeParse(process.env);
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

// Lazy proxy — touching `config.X` before validateEnv() runs will throw,
// catching bootstrap-order bugs early.
const config = new Proxy(
  {},
  {
    get(_, prop) {
      if (!_config) {
        throw new Error(`config.${String(prop)} accessed before validateEnv()`);
      }
      return _config[prop];
    },
  },
);

module.exports = { config, validateEnv };
