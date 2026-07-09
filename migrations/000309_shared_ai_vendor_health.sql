-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ AI vendor health + connection tests + failover incidents           ║
-- ║                                                                    ║
-- ║ The Jul-2026 storefront outage was caused by a bad GEMINI_BASE_URL ║
-- ║ in .env that no dashboard surfaced — every Gemini call died with   ║
-- ║ ENOTFOUND, and because the ledger only writes on success, the      ║
-- ║ failure was invisible for ~5 days.                                 ║
-- ║                                                                    ║
-- ║ This migration adds the storage the reliability layer needs:       ║
-- ║   1. per-vendor test-connection outcome (Save gate)                ║
-- ║   2. per-vendor rolling health state (green/red chip)              ║
-- ║   3. a health-ping log for cron/boot pings                         ║
-- ║   4. an incident log for failover events + red flips (admin alert) ║
-- ║                                                                    ║
-- ║ Idempotent — safe to re-run.                                       ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ── ai_vendor_credentials: test + health columns ─────────────────────
ALTER TABLE shared.ai_vendor_credentials
  ADD COLUMN IF NOT EXISTS last_test_ok_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_test_latency_ms  INTEGER,
  ADD COLUMN IF NOT EXISTS last_test_error       TEXT,
  ADD COLUMN IF NOT EXISTS last_test_by          UUID REFERENCES shared.users (user_id) ON DELETE SET NULL,
  -- Rolling health (updated by the hourly ping cron + on any live call)
  --   'green'   → last ping/call succeeded
  --   'red'     → last ping/call failed
  --   'unknown' → never pinged
  ADD COLUMN IF NOT EXISTS last_health_status    TEXT
                          CHECK (last_health_status IN ('green','red','unknown')),
  ADD COLUMN IF NOT EXISTS last_health_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_health_latency_ms INTEGER,
  ADD COLUMN IF NOT EXISTS last_health_error     TEXT;

-- Default existing rows to 'unknown' so the chip renders sensibly.
UPDATE shared.ai_vendor_credentials
   SET last_health_status = 'unknown'
 WHERE last_health_status IS NULL;

-- ── ai_vendor_health_pings ───────────────────────────────────────────
-- Append-only log of every boot ping, hourly cron ping, and "Test
-- connection" click. The Admin AI Health page shows the last N per
-- vendor; the alerter watches for green→red transitions.
CREATE TABLE IF NOT EXISTS shared.ai_vendor_health_pings (
  ping_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor        TEXT        NOT NULL,
  source        TEXT        NOT NULL
                  CHECK (source IN ('boot','cron','manual','live_call')),
  ok            BOOLEAN     NOT NULL,
  latency_ms    INTEGER,
  http_status   INTEGER,
  error_code    TEXT,
  error_message TEXT,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_by    UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_vendor_health_pings_vendor_time
  ON shared.ai_vendor_health_pings (vendor, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_vendor_health_pings_time
  ON shared.ai_vendor_health_pings (checked_at DESC);

-- ── ai_incidents ─────────────────────────────────────────────────────
-- One row per notable AI-layer event:
--   * failover_engaged  — primary vendor failed, fallback used
--   * vendor_red        — health flipped green→red
--   * vendor_recovered  — health flipped red→green (auto-close)
--   * failure_spike     — success rate for a vendor dropped below threshold
-- Feeds the admin alert (email/WhatsApp/in-app) and the AI Health page.
CREATE TABLE IF NOT EXISTS shared.ai_incidents (
  incident_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_type TEXT        NOT NULL
                  CHECK (incident_type IN
                    ('failover_engaged','vendor_red','vendor_recovered','failure_spike')),
  vendor        TEXT        NOT NULL,
  fallback_vendor TEXT,                        -- populated on failover_engaged
  feature_key   TEXT,                          -- which feature was affected
  business      TEXT        REFERENCES shared.business_config (business_key) ON DELETE SET NULL,
  severity      TEXT        NOT NULL DEFAULT 'warning'
                  CHECK (severity IN ('info','warning','critical')),
  summary       TEXT        NOT NULL,
  details       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  alert_sent_at TIMESTAMPTZ,                   -- populated when the notification fired
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_incidents_time
  ON shared.ai_incidents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_incidents_open
  ON shared.ai_incidents (vendor, incident_type)
  WHERE resolved_at IS NULL;
