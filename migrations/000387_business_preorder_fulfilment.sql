-- ============================================================
-- MIGRATION 000387 — sales_orders pre-order fulfilment timestamps
-- Pixie Girl Hub · Pre-order stock auto-deduction
--
-- Applies template 000097 to the EXISTING brand schemas (template migrations
-- only run at bootstrap for new brands). Adds:
--   • preorder_fulfilled_at        — last waiting pre-order line covered by
--                                    newly-received stock
--   • preorder_arrival_notified_at — last "pre-order arrived" email to customer
--
-- Both brand schemas carry the identical sales_orders table (template 000019
-- applied per business), so walk both schemas. Idempotent.
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
        'ALTER TABLE %I.sales_orders
           ADD COLUMN IF NOT EXISTS preorder_fulfilled_at        TIMESTAMPTZ,
           ADD COLUMN IF NOT EXISTS preorder_arrival_notified_at TIMESTAMPTZ',
        v_schema
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_%s_sales_orders_preorder_fulfilled
           ON %I.sales_orders (preorder_fulfilled_at DESC)
          WHERE preorder_fulfilled_at IS NOT NULL',
        v_schema, v_schema
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- Verify
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='sales_orders'
--      AND column_name IN ('preorder_fulfilled_at','preorder_arrival_notified_at');
--   Expected: both columns present in pixiegirl + faitlynhair.
-- ============================================================
