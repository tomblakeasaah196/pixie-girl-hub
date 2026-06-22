-- ============================================================
-- MIGRATION 000232 — Make shared.contacts.primary_phone nullable
--
-- A contact may now be saved with only an email (no phone). The rule
-- becomes "at least one of phone OR email", enforced in the app layer
-- (contacts validator, bulk import, and walk-in self-registration).
-- This reverses the NOT NULL set in migration 000003. Idempotent:
-- DROP NOT NULL on an already-nullable column is a no-op.
-- ============================================================

ALTER TABLE shared.contacts
  ALTER COLUMN primary_phone DROP NOT NULL;
