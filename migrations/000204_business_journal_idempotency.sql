-- ============================================================
-- MIGRATION 000204 — Journal idempotency key (H-3 / A-3)
--
-- At-least-once outbox delivery (000203) requires idempotent consumers. The
-- sale GL post writes journal_entries with (source_type='sales', source_id =
-- order_id) and there must be exactly ONE such entry per order. This adds a
-- partial UNIQUE index so a re-delivery / double markPaid cannot create a
-- duplicate sale journal — the consumer also pre-checks, this is the race
-- backstop.
--
-- SCOPED to source_type='sales' on purpose: other source types legitimately
-- repeat a source_id — notably 'fx_revaluation' posts once PER foreign-currency
-- payment but carries source_id = order_id, so a blanket (source_type,
-- source_id) unique would wrongly reject the 2nd installment's FX entry.
--
-- Applies to every existing brand schema (loop) AND the template gets the same
-- index (000033_business_indexes) so new brands inherit it. Idempotent.
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
      'CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_sales_src_uidx '
      || 'ON %I.journal_entries (source_id) '
      || 'WHERE source_type = ''sales'' AND source_id IS NOT NULL',
      r.s
    );
    RAISE NOTICE 'H-3: sale-journal idempotency index ensured on %.journal_entries', r.s;
  END LOOP;
END $$;
