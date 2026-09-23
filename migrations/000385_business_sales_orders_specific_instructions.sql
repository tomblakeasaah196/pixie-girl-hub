-- ============================================================
-- MIGRATION 000385 — sales_orders.specific_instructions
-- Pixie Girl Hub · Specific Instructions feature
--
-- Adds a dedicated TEXT column for free-text specific instructions
-- behind a checkbox. Order-level only (Q1=A). Internal only (Q5=A),
-- editable until terminal states (Q2=A), live join + snapshot (Q4=C).
--
-- Both brand schemas carry identical sales_orders table (template
-- 000019 applied per business), so walk both schemas. Idempotent.
-- ============================================================

DO $$
DECLARE
  v_schema TEXT;
BEGIN
  FOREACH v_schema IN ARRAY ARRAY['pixiegirl','faitlynhair'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = v_schema AND table_name = 'sales_orders'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.sales_orders ADD COLUMN IF NOT EXISTS specific_instructions TEXT',
        v_schema
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- Verify
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name='sales_orders' AND column_name='specific_instructions';
--   Expected: pixiegirl.sales_orders + faitlynhair.sales_orders both have TEXT
-- ============================================================
