-- ============================================================
-- MIGRATION 000346 — expenses.amount_paid_ngn
-- Pixie Girl Hub · V2.2 §6.7
--
-- The expense detail screen's "Paid" summary tile and status pill read
-- `amount_paid_ngn`, but the `expenses` table (template 000023) never
-- declared that column — markPaid() had nothing to write it to, so a paid
-- expense always rendered "—" instead of the amount actually disbursed.
--
-- This migration:
--   1. Adds expenses.amount_paid_ngn NUMERIC(14,2) to both brand schemas.
--   2. Backfills existing paid/partially_paid/reimbursed rows with
--      total_amount_ngn + vat_amount_ngn (the full owed amount — markPaid
--      has only ever supported settling in full, mirroring the ledger
--      entry it posts in the same transaction).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a backfill guarded to rows that are
-- still NULL, so re-applying is a no-op.
-- ============================================================

DO $$
DECLARE
  v_schema TEXT;
  v_count  INT;
BEGIN
  FOREACH v_schema IN ARRAY ARRAY['pixiegirl','faitlynhair'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = v_schema AND table_name = 'expenses'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.expenses ADD COLUMN IF NOT EXISTS amount_paid_ngn NUMERIC(14,2)',
        v_schema
      );

      EXECUTE format(
        $sql$
        UPDATE %I.expenses
           SET amount_paid_ngn = total_amount_ngn + COALESCE(vat_amount_ngn, 0)
         WHERE amount_paid_ngn IS NULL
           AND status IN ('paid','partially_paid','reimbursed')
        $sql$,
        v_schema
      );
      GET DIAGNOSTICS v_count = ROW_COUNT;
      RAISE NOTICE '000346: backfilled amount_paid_ngn on % rows in %.expenses', v_count, v_schema;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- Verify
--   SELECT status, amount_paid_ngn FROM faitlynhair.expenses
--    WHERE status IN ('paid','partially_paid','reimbursed');
--   Expected: amount_paid_ngn populated for every row.
-- ============================================================
