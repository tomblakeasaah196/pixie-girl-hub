-- ============================================================
-- 000364_shared_sales_order_status_lifecycle
--
-- Collapse the sales-order status vocabulary to the 7 states the
-- business actually runs, plus the cancellation/refund side-states:
--
--   pending_payment → partially_paid → paid → assigned
--     → order_ready → dispatched → completed
--
-- WHY. The old CHECK carried a dozen fulfilment states (in_production,
-- with_stylist, awaiting_dispatch, ready_for_dispatch, in_transit,
-- out_for_delivery, delivered, …) that no code path ever wrote — the
-- order sat frozen at 'paid' while fulfilment happened on the deliveries
-- and service_jobs tables. There is no manufacturing here; this is a
-- styling business. This migration remaps any legacy rows onto the new
-- vocabulary and then swaps the CHECK constraint.
--
-- Legacy → new mapping:
--   in_production      → assigned      (deposit-cleared / being worked)
--   with_stylist       → assigned
--   awaiting_dispatch  → order_ready   (paid, packed, queued for courier)
--   ready_for_dispatch → order_ready
--   in_transit         → dispatched
--   out_for_delivery   → dispatched
--   delivered          → completed
--   returned           → refunded      (out of the happy path)
--
-- Kept as-is: draft, pending_payment, paid, cancellation_requested,
-- cancelled, refunded, failed.
--
-- Idempotent: the remap only touches rows still on a legacy value, and
-- the constraint swap drops any existing status CHECK first. Re-running
-- is a no-op. Applies to every brand schema (template excluded — the
-- template file itself is updated in the same PR for fresh bootstraps).
-- ============================================================

BEGIN;

DO $$
DECLARE
  r  RECORD;
  cc RECORD;
BEGIN
  FOR r IN
    SELECT table_schema AS s
      FROM information_schema.tables
     WHERE table_name = 'sales_orders'
       AND table_schema NOT IN ('template')
  LOOP
    -- 1) Drop the old CHECK constraint(s) FIRST — the remap below writes values
    --    ('assigned', 'order_ready') the old constraint doesn't permit, so it
    --    must be gone before the UPDATE runs.
    FOR cc IN
      SELECT tc.constraint_name AS cname
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
       WHERE tc.table_schema = r.s
         AND tc.table_name = 'sales_orders'
         AND tc.constraint_type = 'CHECK'
         AND ccu.column_name = 'status'
    LOOP
      EXECUTE format('ALTER TABLE %I.sales_orders DROP CONSTRAINT %I', r.s, cc.cname);
    END LOOP;

    -- 2) Remap legacy fulfilment statuses onto the new 7-state model.
    EXECUTE format($f$
      UPDATE %I.sales_orders SET status = CASE status
        WHEN 'in_production'      THEN 'assigned'
        WHEN 'with_stylist'       THEN 'assigned'
        WHEN 'awaiting_dispatch'  THEN 'order_ready'
        WHEN 'ready_for_dispatch' THEN 'order_ready'
        WHEN 'in_transit'         THEN 'dispatched'
        WHEN 'out_for_delivery'   THEN 'dispatched'
        WHEN 'delivered'          THEN 'completed'
        WHEN 'returned'           THEN 'refunded'
        ELSE status END
      WHERE status IN ('in_production','with_stylist','awaiting_dispatch',
                       'ready_for_dispatch','in_transit','out_for_delivery',
                       'delivered','returned')
    $f$, r.s);

    -- 3) Add the new lifecycle constraint.
    EXECUTE format($f$
      ALTER TABLE %I.sales_orders
        ADD CONSTRAINT sales_orders_status_check
        CHECK (status IN (
          'draft',
          'pending_payment',
          'partially_paid',
          'paid',
          'assigned',
          'order_ready',
          'dispatched',
          'completed',
          'cancellation_requested',
          'cancelled',
          'refunded',
          'failed'
        ))
    $f$, r.s);

    -- 4) Rebuild the dispatch-queue partial indexes so they track the new
    --    "packed, waiting for courier" state (order_ready) instead of the
    --    retired awaiting_dispatch. Both historical index names are handled.
    EXECUTE format('DROP INDEX IF EXISTS %I.idx_%s_dispatch_queue', r.s, r.s);
    EXECUTE format('DROP INDEX IF EXISTS %I.idx_%s_sales_orders_dispatch_queue', r.s, r.s);
    EXECUTE format($f$
      CREATE INDEX idx_%s_dispatch_queue
        ON %I.sales_orders (paid_at)
        WHERE status = 'order_ready' AND order_type = 'dispatch'
    $f$, r.s, r.s);
  END LOOP;
END $$;

COMMIT;
