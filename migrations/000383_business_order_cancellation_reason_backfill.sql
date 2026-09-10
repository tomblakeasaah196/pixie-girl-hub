-- ============================================================
-- MIGRATION 000383 — backfill sales_orders.cancellation_reason
-- Pixie Girl Hub · V2.2 §6.4
--
-- The auto-cancel paths (abandoned-checkout expiry, layaway abandonment,
-- duplicate-order resolver) recorded their rationale in
-- sales_orders.abandonment_reason — the layaway column that pairs with
-- abandoned_at and that nothing in the app reads. The Orders archive and the
-- order detail read cancellation_reason (the §6.4 column beside cancelled_at),
-- so every system cancellation appeared in the UI with no explanation: an
-- order vanished from the working list and no screen could say why.
--
-- sales.repo.setCancellationReason now writes cancellation_reason. This
-- migration moves the history across so already-cancelled orders explain
-- themselves too. abandonment_reason is left as it is — this copies, it does
-- not clear — so nothing is lost if a row is inspected later.
--
-- Only rows that are actually cancelled and have no cancellation_reason yet
-- are touched, which makes the migration idempotent and keeps it from
-- overwriting a reason a human recorded.
--
-- Both brand schemas carry an identical sales_orders table (template 000019 is
-- applied per business), so this walks both schemas where the table exists.
-- ============================================================

DO $$
DECLARE
  v_schema  TEXT;
  v_updated BIGINT;
BEGIN
  FOREACH v_schema IN ARRAY ARRAY['pixiegirl','faitlynhair'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = v_schema
         AND table_name   = 'sales_orders'
         AND column_name  = 'abandonment_reason'
    ) THEN
      EXECUTE format(
        'UPDATE %I.sales_orders
            SET cancellation_reason = abandonment_reason
          WHERE status              = ''cancelled''
            AND cancellation_reason IS NULL
            AND abandonment_reason  IS NOT NULL',
        v_schema
      );
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      RAISE NOTICE '000383: %.sales_orders — % cancellation reason(s) backfilled',
        v_schema, v_updated;

      -- A cancelled order with no cancelled_at (every manual cancel before
      -- this release: setStatus never stamped the column and no trigger did
      -- it either) showed its creation date as its cancellation date in the
      -- archive. The state-history trail holds the real moment; fall back to
      -- updated_at only where no transition was recorded.
      EXECUTE format(
        'UPDATE %I.sales_orders so
            SET cancelled_at = COALESCE(
                  (SELECT max(h.changed_at)
                     FROM %I.sales_order_state_history h
                    WHERE h.order_id = so.order_id
                      AND h.to_status = ''cancelled''),
                  so.updated_at
                )
          WHERE so.status       = ''cancelled''
            AND so.cancelled_at IS NULL',
        v_schema, v_schema
      );
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      RAISE NOTICE '000383: %.sales_orders — % cancellation date(s) backfilled',
        v_schema, v_updated;
    END IF;
  END LOOP;
END $$;
