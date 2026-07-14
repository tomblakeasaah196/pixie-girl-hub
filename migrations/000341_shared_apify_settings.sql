-- ============================================================
-- MIGRATION 000341 — Apify integration settings (Social Studio scraper)
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- One platform-wide Apify API key (not per-brand — a single Apify workspace
-- runs the scraper for both businesses), stored the same way every other
-- third-party secret in this codebase is: AES-256-GCM ciphertext in an
-- *_enc column (src/services/encryption.service.js), a plaintext first-4
-- pill for the masked UI, and a password-gated reveal endpoint whose every
-- use is logged to a dedicated audit table. Mirrors
-- shared.messaging_accounts / shared.messaging_account_secret_reveals
-- (migration 000289) — same shape, singleton instead of one row per channel.
--
-- Idempotent: guarded with IF NOT EXISTS throughout.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.apify_settings (
  setting_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_enc              TEXT,
  api_key_first4           TEXT,
  is_active                BOOLEAN     NOT NULL DEFAULT true,
  last_tested_at           TIMESTAMPTZ,
  last_test_ok             BOOLEAN,
  last_test_message        TEXT,
  secrets_last_rotated_at  TIMESTAMPTZ,
  notes                    TEXT,
  updated_by               UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_apify_settings_updated_at') THEN
    CREATE TRIGGER trg_apify_settings_updated_at
      BEFORE UPDATE ON shared.apify_settings
      FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
  END IF;
END $$;

-- Singleton enforced at the application layer (the repo always reads/writes
-- the single existing row, creating it lazily on first save) — a hard
-- one-row constraint isn't worth a partial-unique-index trick here since
-- nothing else ever inserts a second row.

CREATE TABLE IF NOT EXISTS shared.apify_settings_secret_reveals (
  reveal_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_id   UUID        NOT NULL REFERENCES shared.apify_settings (setting_id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  field        TEXT        NOT NULL CHECK (field = 'api_key'),
  revealed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_ip    TEXT,
  request_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_apify_settings_reveals_setting
  ON shared.apify_settings_secret_reveals (setting_id, revealed_at DESC);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ Non-CEO roles get apify_settings view                                ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- CEO already has full grants (000219). Any role that can edit Social
-- Studio content is treated as a Social Studio manager — give them view on
-- apify_settings so the "Configure Apify" entry point renders. Edit (saving
-- the key, rotating it, running Test) stays CEO-only unless explicitly
-- granted — same reasoning as messaging_accounts in 000289.
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT DISTINCT p.role_id, 'apify_settings', 'view', 'all'
FROM shared.permissions p
WHERE p.module = 'social' AND p.action = 'edit'
ON CONFLICT (role_id, module, action) DO NOTHING;

-- ============================================================
-- Verify
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'shared' AND table_name = 'apify_settings';
-- ============================================================
