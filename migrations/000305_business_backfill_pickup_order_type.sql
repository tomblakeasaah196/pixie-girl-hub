-- ============================================================
-- MIGRATION 000305 — backfill pickup orders' order_type
-- Pixie Girl Hub · V2.2 §6.4 / §6.10
--
-- Both public checkouts (storefront + sales campaign) used to hardcode
-- order_type = 'dispatch' regardless of the buyer's fulfilment choice.
-- The pickup flag was only stored inside internal_notes.fulfilment_type,
-- so paid pickup orders rendered as "DELIVERY" in the Sales list AND
-- were silently skipped by the logistics auto-create subscriber (which
-- correctly no-ops when delivery_address_snapshot is null).
--
-- The forward fix lives in the two checkout services. This migration
-- corrects existing rows: any order flagged `fulfilment_type = 'pickup'`
-- in internal_notes that is still tagged order_type = 'dispatch' is
-- moved to order_type = 'collection' — the value already permitted by
-- the CHECK constraint and mapped to the "Pick-up" label in the UI.
--
-- Idempotent (only rewrites 'dispatch' rows; safe to re-run). Guarded so
-- non-JSON / null internal_notes never raise a cast error.
-- ============================================================

DO $$
DECLARE
  v_schema TEXT;
  v_count  INT;
BEGIN
  FOREACH v_schema IN ARRAY ARRAY['pixiegirl','faitlynhair'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = v_schema AND table_name = 'sales_orders'
    ) THEN
      EXECUTE format(
        $sql$
        UPDATE %I.sales_orders
           SET order_type = 'collection'
         WHERE order_type = 'dispatch'
           AND delivery_address_snapshot IS NULL
           AND internal_notes IS NOT NULL
           AND left(btrim(internal_notes), 1) = '{'
           AND (internal_notes::jsonb ->> 'fulfilment_type') = 'pickup'
        $sql$,
        v_schema
      );
      GET DIAGNOSTICS v_count = ROW_COUNT;
      RAISE NOTICE '000305: reclassified % pickup orders in %.sales_orders', v_count, v_schema;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- Verify
--   SELECT order_type, COUNT(*)
--     FROM faitlynhair.sales_orders
--    WHERE internal_notes::jsonb->>'fulfilment_type' = 'pickup'
--    GROUP BY 1;
--   Expected: only 'collection' rows (no 'dispatch' left).
-- ============================================================
