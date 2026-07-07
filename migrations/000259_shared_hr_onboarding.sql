-- ============================================================
-- MIGRATION 000259 — HR onboarding pack (meeting §3.7)
--
-- "New employees see their onboarding materials on first login." The brand's
-- onboarding checklist already exists (hr_settings.onboarding_checklist,
-- 000233); this adds:
--   • staff_onboarding_progress — per-employee completion of each checklist
--     item (the boss's brand-wide list, ticked off per person).
--   • hr_settings.onboarding_links   — configurable "handy links" (titled URLs)
--     HR maintains for every new hire.
--   • hr_settings.onboarding_welcome — an optional welcome note shown at the
--     top of the Getting-started card.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.staff_onboarding_progress (
  progress_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business      TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  profile_id    UUID        NOT NULL REFERENCES shared.staff_profiles (profile_id) ON DELETE CASCADE,
  item_key      TEXT        NOT NULL,                 -- matches a hr_settings.onboarding_checklist[].key
  completed     BOOLEAN     NOT NULL DEFAULT true,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_by  UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  UNIQUE (profile_id, item_key)
);
CREATE INDEX IF NOT EXISTS idx_staff_onboarding_progress_profile
  ON shared.staff_onboarding_progress (profile_id);

ALTER TABLE shared.hr_settings
  ADD COLUMN IF NOT EXISTS onboarding_links   JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_welcome TEXT;
