-- ============================================================
-- MIGRATION 000372 — Composer quick inserts: address + hours
-- Pixie Girl Hub · V2.2 · Messaging
--
-- The two questions customers ask most often in the inbox are
-- "where are you?" and "what time do you close?". Operators were
-- retyping both answers all day.
--
-- The composer already has an editable-stock-message pattern
-- (migration 000336): insert the copy, edit it, optionally save the
-- edit as the brand's new default. This extends that table with two
-- more stock messages so the new attachment-sheet entries behave
-- identically:
--   address_template  — {address} → the shared address value below
--   hours_template    — {hours}   → the shared hours value below
--
-- The *values* are separated from the *wording* so the CEO can fix a
-- typo in the address without rewriting the sentence around it:
--   address_share_text — explicit override; NULL falls back to
--                        business_config.address (Settings → Business
--                        Setup), so the address is seeded, not invented.
--   hours_share_text   — explicit override; NULL falls back to the code
--                        default (Monday–Saturday, 9:00 AM – 8:00 PM).
--                        business_config has no opening-hours column, so
--                        this is the only home for it.
--
-- One row per brand (unchanged). Absent row / NULL column = code default.
-- ============================================================

ALTER TABLE shared.smartcomm_composer_settings
  ADD COLUMN IF NOT EXISTS address_template   TEXT,
  ADD COLUMN IF NOT EXISTS address_share_text TEXT,
  ADD COLUMN IF NOT EXISTS hours_template     TEXT,
  ADD COLUMN IF NOT EXISTS hours_share_text   TEXT;

COMMENT ON COLUMN shared.smartcomm_composer_settings.address_template IS
  'Composer "send our address" wording; {address} is substituted at insert time. NULL = code default.';
COMMENT ON COLUMN shared.smartcomm_composer_settings.address_share_text IS
  'Address override for the composer insert. NULL = business_config.address (Settings → Business Setup).';
COMMENT ON COLUMN shared.smartcomm_composer_settings.hours_template IS
  'Composer "send our working hours" wording; {hours} is substituted at insert time. NULL = code default.';
COMMENT ON COLUMN shared.smartcomm_composer_settings.hours_share_text IS
  'Opening-hours line shared with customers. NULL = code default (Monday–Saturday, 9:00 AM – 8:00 PM).';
