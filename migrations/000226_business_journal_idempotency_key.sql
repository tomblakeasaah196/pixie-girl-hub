-- ============================================================
-- MIGRATION 000226 — generalised journal posting idempotency key (P1-3)
--
-- journal_entries_sales_src_uidx (000204) protects exactly one source_type
-- ('sales'). Every other posting path (payment fees, realised FX, supplier
-- payments, expense disbursement/settlement, intercompany legs, ...) has no
-- backstop at all, and several of them legitimately post more than one
-- journal against the same (source_type, source_id) pair (e.g. cash_request
-- posts 'expense' twice — disbursement then settlement — against the same
-- cash_request_id; purchasing posts 'payment' once per instalment against the
-- same supplier_invoice id), so a blanket UNIQUE(source_type, source_id) would
-- reject legitimate entries.
--
-- Instead of fighting over the shared (source_type, source_id) namespace,
-- this adds an opt-in `idempotency_key` column: callers that need a hard
-- "post this exactly once" guarantee pass their own globally-unique key
-- (e.g. `payment_fee:<payment_id>`, `intercompany:<ic_transaction_id>:seller`)
-- and accounting.postEntry pre-checks + relies on this unique index as the
-- race backstop, exactly like the existing source-based pattern. Callers that
-- don't pass a key are completely unaffected (column is nullable, index is
-- partial).
--
-- Applies to every existing brand schema (loop); the template
-- (000022_business_accounting + 000033_business_indexes) carries the same
-- column/index so new brands inherit it directly. Idempotent.
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_schema AS s
      FROM information_schema.tables
     WHERE table_name = 'journal_entries'
       AND table_schema NOT IN ('template')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.journal_entries ADD COLUMN IF NOT EXISTS idempotency_key TEXT',
      r.s
    );
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_idempotency_uidx '
      || 'ON %I.journal_entries (idempotency_key) '
      || 'WHERE idempotency_key IS NOT NULL',
      r.s
    );
    RAISE NOTICE 'P1-3: idempotency_key column + unique index ensured on %.journal_entries', r.s;
  END LOOP;
END $$;
