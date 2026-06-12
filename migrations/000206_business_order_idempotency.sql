-- ============================================================
-- MIGRATION 000206 — Order idempotency key (H-9 / B-6)
--
-- A double-clicked / retried public checkout must not create two paid orders.
-- sales_order_payments already carries client_idempotency_key; this adds the
-- same to the order header so `createOrder` can dedupe at the source. The
-- partial UNIQUE index is the race backstop (two concurrent submits with the
-- same key → the 2nd insert raises 23505, which the service maps to "return the
-- existing order").
--
-- Applies to every brand schema + the template (000019) inherits it. Idempotent.
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_schema AS s
      FROM information_schema.tables
     WHERE table_name = 'sales_orders'
       AND table_schema NOT IN ('template')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.sales_orders ADD COLUMN IF NOT EXISTS client_idempotency_key TEXT',
      r.s
    );
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_idempotency_uidx '
      || 'ON %I.sales_orders (client_idempotency_key) '
      || 'WHERE client_idempotency_key IS NOT NULL',
      r.s
    );
  END LOOP;
END $$;
