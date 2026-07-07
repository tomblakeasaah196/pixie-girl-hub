-- ============================================================
-- MIGRATION 000306 — stamp sales_orders.paid_at + backfill
-- Pixie Girl Hub · V2.2 §6.2
--
-- `paid_at` has always existed on `sales_orders` (declared in template
-- 000019, indexed by template 000033, referenced by `sales-report.export.js`
-- and various repos), but nothing ever wrote to it — the trigger stamped
-- `fully_paid_at` only. Reports came out with an "always null" Paid At
-- column, and any downstream query filtering on paid_at silently returned
-- zero rows.
--
-- This migration:
--   1. Reinstalls fn_sales_order_recompute_paid in both brand schemas
--      with a `paid_at` COALESCE mirror alongside `fully_paid_at`.
--   2. Backfills existing rows: `paid_at := fully_paid_at` where paid_at
--      is null and fully_paid_at is set.
--
-- Idempotent. CREATE OR REPLACE FUNCTION handles the trigger body; the
-- backfill UPDATE is nullable-guarded so re-running is a no-op.
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
      -- (1) Reinstall the trigger function with paid_at stamped.
      EXECUTE format(
        $fn$
        CREATE OR REPLACE FUNCTION %1$I.fn_sales_order_recompute_paid()
        RETURNS TRIGGER
        LANGUAGE plpgsql AS $body$
        DECLARE
          v_order_id     UUID;
          v_paid         NUMERIC(14,2);
          v_total        NUMERIC(14,2);
          v_required_dep NUMERIC(14,2);
          v_last_pay     TIMESTAMPTZ;
          v_now          TIMESTAMPTZ := now();
        BEGIN
          v_order_id := COALESCE(NEW.order_id, OLD.order_id);

          SELECT COALESCE(SUM(amount_ngn),0), MAX(recorded_at)
            INTO v_paid, v_last_pay
            FROM %1$I.sales_order_payments
           WHERE order_id = v_order_id
             AND status IN ('captured','authorised');

          SELECT total_ngn, required_deposit_ngn
            INTO v_total, v_required_dep
            FROM %1$I.sales_orders
           WHERE order_id = v_order_id;

          UPDATE %1$I.sales_orders
             SET amount_paid_ngn = v_paid,
                 last_payment_at = COALESCE(v_last_pay, last_payment_at),
                 deposit_met_at  = COALESCE(
                   deposit_met_at,
                   CASE WHEN payment_model = 'deposit_triggered'
                          AND v_required_dep IS NOT NULL
                          AND v_paid >= v_required_dep
                        THEN v_now ELSE NULL END
                 ),
                 fully_paid_at   = COALESCE(
                   fully_paid_at,
                   CASE WHEN v_paid >= v_total THEN v_now ELSE NULL END
                 ),
                 paid_at         = COALESCE(
                   paid_at,
                   CASE WHEN v_paid >= v_total THEN v_now ELSE NULL END
                 ),
                 updated_at      = v_now
           WHERE order_id = v_order_id;

          RETURN COALESCE(NEW, OLD);
        END;
        $body$;
        $fn$,
        v_schema
      );

      -- (2) Backfill existing rows.
      EXECUTE format(
        $sql$
        UPDATE %I.sales_orders
           SET paid_at = fully_paid_at
         WHERE paid_at IS NULL
           AND fully_paid_at IS NOT NULL
        $sql$,
        v_schema
      );
      GET DIAGNOSTICS v_count = ROW_COUNT;
      RAISE NOTICE '000306: backfilled paid_at on % rows in %.sales_orders', v_count, v_schema;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- Verify
--   SELECT COUNT(*) FILTER (WHERE paid_at IS NULL) AS null_paid,
--          COUNT(*) FILTER (WHERE paid_at IS NOT NULL) AS stamped_paid
--     FROM faitlynhair.sales_orders WHERE fully_paid_at IS NOT NULL;
--   Expected: null_paid = 0, stamped_paid > 0.
-- ============================================================
