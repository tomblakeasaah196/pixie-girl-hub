-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 000337 — Reconcile shared.service_booking_requests                 ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- Migration 000317 declared the table with CREATE TABLE IF NOT EXISTS.
-- Production had a stale earlier-shape copy of the table already sitting
-- there, so the whole schema (including `link_id`) was silently skipped
-- when 000317 ran. The order-links sidebar (GET
-- /api/v1/smartcomm/channels/:id/order-links) then 500'd with:
--
--   column b.link_id does not exist
--   hint: Perhaps you meant to reference the column "l.link_id".
--
-- Reconcile idempotently: ADD COLUMN IF NOT EXISTS for every column
-- from 000317's CREATE TABLE, re-create the indexes and the
-- updated_at trigger. A DB where 000317 landed cleanly is a no-op.

ALTER TABLE shared.service_booking_requests
  ADD COLUMN IF NOT EXISTS business       TEXT,
  ADD COLUMN IF NOT EXISTS link_id        UUID,
  ADD COLUMN IF NOT EXISTS channel_id     UUID,
  ADD COLUMN IF NOT EXISTS contact_id     UUID,
  ADD COLUMN IF NOT EXISTS service_id     UUID,
  ADD COLUMN IF NOT EXISTS order_id       UUID,
  ADD COLUMN IF NOT EXISTS qty            INTEGER      NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price_ngn      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS requested_for  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS note           TEXT,
  ADD COLUMN IF NOT EXISTS status         TEXT         NOT NULL DEFAULT 'requested',
  ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now();

-- The FKs on the referenced columns can only be added when the columns
-- exist on both sides — safe here because the sibling tables are older.
-- Use a DO-block so a duplicate constraint is skipped instead of raising.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_booking_requests_link_id_fkey'
  ) THEN
    ALTER TABLE shared.service_booking_requests
      ADD CONSTRAINT service_booking_requests_link_id_fkey
      FOREIGN KEY (link_id)
      REFERENCES shared.smartcomm_order_links (link_id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_booking_requests_business_fkey'
  ) THEN
    ALTER TABLE shared.service_booking_requests
      ADD CONSTRAINT service_booking_requests_business_fkey
      FOREIGN KEY (business)
      REFERENCES shared.business_config (business_key) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_booking_requests_channel_id_fkey'
  ) THEN
    ALTER TABLE shared.service_booking_requests
      ADD CONSTRAINT service_booking_requests_channel_id_fkey
      FOREIGN KEY (channel_id)
      REFERENCES shared.message_channels (channel_id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_booking_requests_contact_id_fkey'
  ) THEN
    ALTER TABLE shared.service_booking_requests
      ADD CONSTRAINT service_booking_requests_contact_id_fkey
      FOREIGN KEY (contact_id)
      REFERENCES shared.contacts (contact_id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_booking_requests_service_id_fkey'
  ) THEN
    ALTER TABLE shared.service_booking_requests
      ADD CONSTRAINT service_booking_requests_service_id_fkey
      FOREIGN KEY (service_id)
      REFERENCES shared.service_offerings (service_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_booking_requests_qty_check'
  ) THEN
    ALTER TABLE shared.service_booking_requests
      ADD CONSTRAINT service_booking_requests_qty_check CHECK (qty > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_booking_requests_status_check'
  ) THEN
    ALTER TABLE shared.service_booking_requests
      ADD CONSTRAINT service_booking_requests_status_check
      CHECK (status IN ('requested','confirmed','converted','cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_booking_requests_business
  ON shared.service_booking_requests (business, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_booking_requests_contact
  ON shared.service_booking_requests (contact_id)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_booking_requests_link
  ON shared.service_booking_requests (link_id)
  WHERE link_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_service_booking_requests_updated_at
  ON shared.service_booking_requests;
CREATE TRIGGER trg_service_booking_requests_updated_at
  BEFORE UPDATE ON shared.service_booking_requests
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
