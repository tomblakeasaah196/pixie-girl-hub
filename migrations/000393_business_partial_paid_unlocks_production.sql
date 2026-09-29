-- ============================================================
-- MIGRATION 000393 — partial payment unlocks production, same as a deposit
-- Pixie Girl Hub · Stylist Studio + Stock (owner directive 2026-09-29)
--
-- Before: `deposit_met_at` only ever stamped for `payment_model =
-- 'deposit_triggered'` orders once accumulated payments crossed
-- `required_deposit_ngn`. Every other order (the common case — a straight
-- stock sale, or a layaway/instalment plan) never got a "committed" moment
-- until the FULL balance cleared — so a part-paid order's styling job never
-- opened, and it never showed up in the Stylist Studio to be assigned.
--
-- Owner directive: "once an order is even partially paid... we can be able
-- to have it in the stylist studio and be able to assign it... include
-- partially paid please... meaning the stock considers it as a sale at once."
--
-- After: `deposit_met_at` stamps the moment ANY payment lands on the order
-- (v_paid > 0), for every payment_model — it is now "first money in", not
-- "the configured deposit threshold". The application layer
-- (sales.service.js addPayment) reads this same crossing to open the Studio
-- job and draw stock as a real sale (see sales.service.js / order-status.js
-- comments). `required_deposit_ngn` / the Flexi Pay minimum-first-payment
-- settings are unchanged — they still gate how much a buyer must pay to be
-- accepted at all; they just no longer gate when production starts.
--
-- Backfill: any order already sitting at partially_paid or paid with
-- deposit_met_at still NULL (because it never reached the old threshold, or
-- predates this change) is stamped now, using its earliest captured/
-- authorised payment's timestamp — so the order-amendment "committed to
-- production" gate and any report reading deposit_met_at see the true first-
-- payment moment retroactively, not today's migration run time.
--
-- Idempotent. CREATE OR REPLACE FUNCTION handles the trigger body; the
-- backfill UPDATE only ever touches rows where deposit_met_at IS NULL.
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
      -- (1) Reinstall the trigger function: deposit_met_at stamps on ANY
      -- payment, for every payment_model — not just deposit_triggered orders
      -- past their required_deposit_ngn.
      EXECUTE format(
        $fn$
        CREATE OR REPLACE FUNCTION %1$I.fn_sales_order_recompute_paid()
        RETURNS TRIGGER
        LANGUAGE plpgsql AS $body$
        DECLARE
          v_order_id UUID;
          v_paid     NUMERIC(14,2);
          v_total    NUMERIC(14,2);
          v_last_pay TIMESTAMPTZ;
          v_now      TIMESTAMPTZ := now();
        BEGIN
          v_order_id := COALESCE(NEW.order_id, OLD.order_id);

          SELECT COALESCE(SUM(amount_ngn),0), MAX(recorded_at)
            INTO v_paid, v_last_pay
            FROM %1$I.sales_order_payments
           WHERE order_id = v_order_id
             AND status IN ('captured','authorised');

          SELECT total_ngn
            INTO v_total
            FROM %1$I.sales_orders
           WHERE order_id = v_order_id;

          UPDATE %1$I.sales_orders
             SET amount_paid_ngn = v_paid,
                 last_payment_at = COALESCE(v_last_pay, last_payment_at),
                 -- Any money in commits the order to production — the
                 -- Stylist Studio job opens and stock is drawn as a sale on
                 -- this same crossing (sales.service.js addPayment).
                 deposit_met_at  = COALESCE(
                   deposit_met_at,
                   CASE WHEN v_paid > 0 THEN v_now ELSE NULL END
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

      -- (2) Backfill: stamp deposit_met_at retroactively on every order that
      -- already has money on it but never crossed the old threshold. Uses the
      -- order's own earliest captured/authorised payment as the timestamp,
      -- falling back to the order's updated_at when (for any reason) no
      -- payment row is found for an order the trigger already shows as paid.
      EXECUTE format(
        $sql$
        UPDATE %1$I.sales_orders so
           SET deposit_met_at = COALESCE(
                 (SELECT MIN(sop.recorded_at)
                    FROM %1$I.sales_order_payments sop
                   WHERE sop.order_id = so.order_id
                     AND sop.status IN ('captured','authorised')),
                 so.updated_at
               )
         WHERE so.deposit_met_at IS NULL
           AND so.amount_paid_ngn > 0
        $sql$,
        v_schema
      );
      GET DIAGNOSTICS v_count = ROW_COUNT;
      RAISE NOTICE '000393: backfilled deposit_met_at on % rows in %.sales_orders', v_count, v_schema;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- Verify
--   SELECT status, count(*), count(*) FILTER (WHERE deposit_met_at IS NOT NULL)
--     FROM faitlynhair.sales_orders
--    WHERE amount_paid_ngn > 0
--    GROUP BY status;
--   Expected: every row with amount_paid_ngn > 0 now has deposit_met_at set.
-- ============================================================
