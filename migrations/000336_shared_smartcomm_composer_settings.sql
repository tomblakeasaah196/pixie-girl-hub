-- ============================================================
-- MIGRATION 000336 — Smartcomm composer settings (per brand)
-- Pixie Girl Hub · V2.2 · Messaging
--
-- The inbox composer has two "insert a stock message" buttons: the
-- Online welcome-form link and (new) a WhatsApp follow-up handoff.
-- Both used to send hardcoded copy directly. The CEO asked to be able
-- to (a) edit the copy before sending, and (b) make an edit the new
-- default so next time it "replaces the automated text".
--
-- This table holds the editable per-brand templates plus the WhatsApp
-- number to share. Both templates carry a placeholder the composer
-- substitutes at insert time:
--   onboarding_template        — {link}   → the generated welcome URL
--   whatsapp_handoff_template  — {number} → the brand's WhatsApp number
-- whatsapp_share_number is an explicit override; when NULL the composer
-- falls back to business_config.phone (the number set in Business Setup).
--
-- One row per brand. Absent row = every field NULL = code defaults.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.smartcomm_composer_settings (
  business                  TEXT        PRIMARY KEY
                            REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  onboarding_template       TEXT,
  whatsapp_handoff_template TEXT,
  whatsapp_share_number     TEXT,
  updated_by                UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_smartcomm_composer_settings_updated_at
  ON shared.smartcomm_composer_settings;
CREATE TRIGGER trg_smartcomm_composer_settings_updated_at
  BEFORE UPDATE ON shared.smartcomm_composer_settings
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
