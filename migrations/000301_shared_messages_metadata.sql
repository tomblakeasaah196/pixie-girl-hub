-- ============================================================
-- MIGRATION 000301 — shared.messages.metadata (JSONB)
-- Pixie Girl Hub · JBS Praxis · Smartcomm
--
-- The Smartcomm repo (`src/modules/smartcomm/smartcomm.repo.js`)
-- writes into a `metadata` JSONB column on every message insert —
-- product_share carousels and send_invoice cards use it, and every
-- text message writes an empty `{}` default. The column was
-- referenced by migration 000228 ("messages.metadata.products[]
-- (JSONB, already on the table)") but never actually added, so
-- every call to POST /api/v1/smartcomm/channels/:id/messages fails
-- with Postgres 42703 undefined_column and the client sees the
-- generic "Something went wrong on our side" 500.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so re-running is a no-op on
-- any environment where the column was hand-patched already.
-- ============================================================

ALTER TABLE shared.messages
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- Verify
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_schema = 'shared'
--      AND table_name   = 'messages'
--      AND column_name  = 'metadata';
-- ============================================================
