-- ============================================================
-- MIGRATION 000227 — gate intercompany transactions behind CEO
-- approval (Decision: "intercompany invoicing full fix")
--
-- src/workflows/default-definitions.js already ships an
-- 'intercompany:create' CEO-approval workflow definition, but
-- intercompany.service.js never opened an instance against it — every
-- trade posted mirrored GL entries immediately on record(), with no
-- approval gate at all. The fix (this migration's companion code change
-- in src/modules/intercompany/intercompany.service.js) now creates the
-- row in 'pending_approval' and defers GL posting + stock movement
-- until the CEO approves the workflow instance.
--
-- This needs two schema changes on the existing (single, shared) table:
--   1. status CHECK widened to add 'pending_approval' (new entry state)
--      and 'rejected' (terminal state when the CEO declines).
--   2. rejection_reason — free-text captured on reject, mirroring
--      reversed_reason's role for the 'reversed' state.
--
-- shared.intercompany_transactions is a single cross-brand table (not
-- one-per-brand), so this is a direct ALTER, not the per-schema loop
-- used for brand-local tables. Idempotent.
-- ============================================================

ALTER TABLE shared.intercompany_transactions
  DROP CONSTRAINT IF EXISTS intercompany_transactions_status_check;

ALTER TABLE shared.intercompany_transactions
  ADD CONSTRAINT intercompany_transactions_status_check
  CHECK (status IN ('pending_approval','pending_buyer','matched','settled',
                     'disputed','reversed','cancelled','rejected'));

ALTER TABLE shared.intercompany_transactions
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

DO $$
BEGIN
  RAISE NOTICE 'P-IC: intercompany_transactions now supports pending_approval/rejected + rejection_reason';
END $$;
