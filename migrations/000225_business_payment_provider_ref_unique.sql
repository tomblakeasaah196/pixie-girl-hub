-- ============================================================
-- MIGRATION 000225 — sales_order_payments provider-ref uniqueness (P1-2)
--
-- idx_{business}_sales_order_payments_provider_ref was a plain (non-unique)
-- index, so a re-delivered webhook (or two webhook deliveries racing each
-- other) could insert two payment rows for the same gateway charge —
-- addPayment had nothing in the database to stop it. The pre-check in
-- webhooks.service.js (paymentExistsByProviderRef) closes the common case but
-- is a plain SELECT outside any lock, so it cannot close the race.
--
-- This promotes the index to UNIQUE on (provider, provider_reference) — a
-- gateway's transaction reference is unique within that gateway, never reused
-- across orders — so the database itself now rejects the duplicate insert.
-- sales.repo.addPayment is updated alongside this to INSERT ... ON CONFLICT
-- DO NOTHING and fall back to fetching the existing row.
--
-- Applies to every existing brand schema (loop); the template
-- (000019_business_sales) carries the same UNIQUE index so new brands inherit
-- it directly. Idempotent.
--
-- NOTE: if any brand schema already has duplicate (provider, provider_reference)
-- rows (a symptom of the bug this migration fixes), CREATE UNIQUE INDEX below
-- will fail with a clear "could not create unique index" error naming the
-- conflicting rows. Reconcile those rows (refund/void the duplicate payment)
-- before re-running this migration.
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_schema AS s
      FROM information_schema.tables
     WHERE table_name = 'sales_order_payments'
       AND table_schema NOT IN ('template')
  LOOP
    EXECUTE format(
      'DROP INDEX IF EXISTS %I.idx_%s_sales_order_payments_provider_ref',
      r.s, r.s
    );
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS sales_order_payments_provider_ref_uidx '
      || 'ON %I.sales_order_payments (provider, provider_reference) '
      || 'WHERE provider_reference IS NOT NULL',
      r.s
    );
    RAISE NOTICE 'P1-2: unique provider-reference index ensured on %.sales_order_payments', r.s;
  END LOOP;
END $$;
