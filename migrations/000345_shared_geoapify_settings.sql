-- ============================================================
-- MIGRATION 000345 — Geoapify integration settings (HR clock-in geocoding)
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- One platform-wide Geoapify API key (not per-brand — both businesses share
-- one Geoapify account), stored the same way every other third-party secret
-- in this codebase is: AES-256-GCM ciphertext in an *_enc column
-- (src/services/encryption.service.js), a plaintext first-4 pill for the
-- masked UI, and a password-gated reveal endpoint whose every use is logged
-- to a dedicated audit table. Mirrors shared.apify_settings /
-- shared.apify_settings_secret_reveals (migration 000341) exactly — same
-- shape, different provider. Moves the key off .env: GEOAPIFY_API_KEY stays
-- readable only as an emergency fallback when no row is configured — see
-- src/services/geoapify.service.js.
--
-- Idempotent: guarded with IF NOT EXISTS throughout.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.geoapify_settings (
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
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_geoapify_settings_updated_at') THEN
    CREATE TRIGGER trg_geoapify_settings_updated_at
      BEFORE UPDATE ON shared.geoapify_settings
      FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
  END IF;
END $$;

-- Singleton enforced at the application layer (the repo always reads/writes
-- the single existing row, creating it lazily on first save) — same
-- reasoning as shared.apify_settings (000341).

CREATE TABLE IF NOT EXISTS shared.geoapify_settings_secret_reveals (
  reveal_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_id   UUID        NOT NULL REFERENCES shared.geoapify_settings (setting_id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE CASCADE,
  field        TEXT        NOT NULL CHECK (field = 'api_key'),
  revealed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_ip    TEXT,
  request_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_geoapify_settings_reveals_setting
  ON shared.geoapify_settings_secret_reveals (setting_id, revealed_at DESC);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ Non-CEO roles get geoapify_settings view                              ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- CEO already has full grants (000219). Any role that can edit HR & Payroll
-- settings is treated as an HR settings manager — give them view on
-- geoapify_settings so the "Configure Geoapify" pill renders in HR & Staff →
-- Settings. Edit (saving the key, rotating it, running Test) stays
-- CEO-only unless explicitly granted — same reasoning as apify_settings in
-- 000341.
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT DISTINCT p.role_id, 'geoapify_settings', 'view', 'all'
FROM shared.permissions p
WHERE p.module = 'hr_payroll' AND p.action = 'edit'
ON CONFLICT (role_id, module, action) DO NOTHING;

-- ============================================================
-- Verify
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'shared' AND table_name = 'geoapify_settings';
-- ============================================================
