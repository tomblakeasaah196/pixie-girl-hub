-- ============================================================
-- MIGRATION 000365 — User soft-delete (Trash)
-- Pixie Girl Hub · V2.2
--
-- Adds a reversible "move to trash" for login accounts / people,
-- driven from IAM & Security → Users & Access.
--
-- A trashed user (deleted_at IS NOT NULL) disappears from every
-- active surface: the Users & Access list, security stats, access
-- reviews, and — via the linked staff_profile + contact soft-delete
-- the service performs — from HR, Payroll, Performance and Contacts.
-- They live only in the Trash, from which they can be restored or,
-- when nothing references them, permanently purged.
--
-- staff_profiles already carried is_deleted + deleted_at (000003);
-- we add deleted_by + deletion_reason there for parity so the Trash
-- can show who archived the person and why.
--
-- Fully idempotent: ADD COLUMN IF NOT EXISTS, guarded constraint,
-- CREATE INDEX IF NOT EXISTS.
-- ============================================================

-- ── shared.users: trash metadata ───────────────────────────
ALTER TABLE shared.users
  ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by      UUID,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

-- deleted_by is a self-reference to the admin who trashed the account.
-- SET NULL so purging that admin later never blocks on this pointer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_deleted_by'
  ) THEN
    ALTER TABLE shared.users
      ADD CONSTRAINT fk_users_deleted_by
      FOREIGN KEY (deleted_by) REFERENCES shared.users (user_id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Partial index: the Trash list scans only the trashed rows.
CREATE INDEX IF NOT EXISTS idx_users_deleted_at
  ON shared.users (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ── shared.staff_profiles: trash metadata parity ───────────
-- is_deleted + deleted_at already exist (000003). Record who / why.
ALTER TABLE shared.staff_profiles
  ADD COLUMN IF NOT EXISTS deleted_by      UUID,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;
