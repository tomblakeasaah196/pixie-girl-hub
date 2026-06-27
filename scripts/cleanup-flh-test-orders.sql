-- ============================================================================
-- HARD DELETE — Faitlynhair test/mock sales orders
-- ============================================================================
-- Removes 34 specific test orders from faitlynhair.sales_orders and everything
-- that hangs off them. Scoped strictly to the order numbers listed below — it
-- can never touch any other order because the target set is resolved once, up
-- front, from that exact IN-list.
--
-- ⚠️  RUN THE SALES REPORT EXPORT FIRST (Sales → Export Report → All time).
--     This is a HARD delete: the rows are gone, not archived.
--
-- HOW THE DELETE BEHAVES (verified against migrations/template/000019–000028):
--   • CASCADE (auto-removed with the order):
--       sales_order_lines, sales_order_discounts, sales_order_payments,
--       sales_order_state_history
--   • Would BLOCK the delete (no cascade) — so we clear them first:
--       cancellation_requests.order_id, pos_transactions.order_id
--       (and pos_void_log → pos_transactions). For these sales-channel test
--       orders these are normally empty; the deletes are harmless no-ops if so.
--   • SET NULL (rows KEPT, link cleared — NOT deleted by this script):
--       invoices.order_id, deliveries.order_id, quotations.converted_sales_order_id,
--       production custom-order links, payroll commission, campaign signups,
--       email-campaign converted_order_id.
--     → If those test orders generated invoices/deliveries you also want gone,
--       remove them separately; this script intentionally stays within the
--       orders themselves.
--
-- USAGE (psql over SSH):
--   1. psql "$DATABASE_URL" -f scripts/cleanup-flh-test-orders.sql
--   2. Read the NOTICE counts + the PRE-CHECK output, then the final verify
--      ("remaining" must be 0). The whole thing is ONE transaction with
--      ON_ERROR_STOP — any surprise blocking FK aborts and rolls back cleanly.
-- ============================================================================

\set ON_ERROR_STOP on

-- ── PRE-CHECK (read-only): what exists for these orders before we delete ────
SELECT 'sales_orders'              AS table, count(*) AS rows
  FROM faitlynhair.sales_orders so
 WHERE so.order_number IN (
   'FLH-SO-0001','FLH-SO-0002','FLH-SO-0003','FLH-SO-0004','FLH-SO-0005',
   'FLH-SO-0006','FLH-SO-0007','FLH-SO-0008','FLH-SO-0009','FLH-SO-0010',
   'FLH-SO-0011','FLH-SO-0012','FLH-SO-0013','FLH-SO-0014','FLH-SO-0015',
   'FLH-SO-0016','FLH-SO-0017','FLH-SO-0018','FLH-SO-0019','FLH-SO-0020',
   'FLH-SO-0021','FLH-SO-0022','FLH-SO-0023','FLH-SO-0024','FLH-SO-0025',
   'FLH-SO-0026','FLH-SO-0029','FLH-SO-0030','FLH-SO-0031','FLH-SO-0035',
   'FLH-SO-0036','FLH-SO-0038','FLH-SO-0042','FLH-SO-0056'
 )
UNION ALL
SELECT 'sales_order_lines', count(*) FROM faitlynhair.sales_order_lines l
  JOIN faitlynhair.sales_orders so ON so.order_id = l.order_id
 WHERE so.order_number IN (
   'FLH-SO-0001','FLH-SO-0002','FLH-SO-0003','FLH-SO-0004','FLH-SO-0005',
   'FLH-SO-0006','FLH-SO-0007','FLH-SO-0008','FLH-SO-0009','FLH-SO-0010',
   'FLH-SO-0011','FLH-SO-0012','FLH-SO-0013','FLH-SO-0014','FLH-SO-0015',
   'FLH-SO-0016','FLH-SO-0017','FLH-SO-0018','FLH-SO-0019','FLH-SO-0020',
   'FLH-SO-0021','FLH-SO-0022','FLH-SO-0023','FLH-SO-0024','FLH-SO-0025',
   'FLH-SO-0026','FLH-SO-0029','FLH-SO-0030','FLH-SO-0031','FLH-SO-0035',
   'FLH-SO-0036','FLH-SO-0038','FLH-SO-0042','FLH-SO-0056'
 )
UNION ALL
SELECT 'sales_order_payments', count(*) FROM faitlynhair.sales_order_payments p
  JOIN faitlynhair.sales_orders so ON so.order_id = p.order_id
 WHERE so.order_number IN (
   'FLH-SO-0001','FLH-SO-0002','FLH-SO-0003','FLH-SO-0004','FLH-SO-0005',
   'FLH-SO-0006','FLH-SO-0007','FLH-SO-0008','FLH-SO-0009','FLH-SO-0010',
   'FLH-SO-0011','FLH-SO-0012','FLH-SO-0013','FLH-SO-0014','FLH-SO-0015',
   'FLH-SO-0016','FLH-SO-0017','FLH-SO-0018','FLH-SO-0019','FLH-SO-0020',
   'FLH-SO-0021','FLH-SO-0022','FLH-SO-0023','FLH-SO-0024','FLH-SO-0025',
   'FLH-SO-0026','FLH-SO-0029','FLH-SO-0030','FLH-SO-0031','FLH-SO-0035',
   'FLH-SO-0036','FLH-SO-0038','FLH-SO-0042','FLH-SO-0056'
 )
UNION ALL
SELECT 'cancellation_requests', count(*) FROM faitlynhair.cancellation_requests c
  JOIN faitlynhair.sales_orders so ON so.order_id = c.order_id
 WHERE so.order_number IN (
   'FLH-SO-0001','FLH-SO-0002','FLH-SO-0003','FLH-SO-0004','FLH-SO-0005',
   'FLH-SO-0006','FLH-SO-0007','FLH-SO-0008','FLH-SO-0009','FLH-SO-0010',
   'FLH-SO-0011','FLH-SO-0012','FLH-SO-0013','FLH-SO-0014','FLH-SO-0015',
   'FLH-SO-0016','FLH-SO-0017','FLH-SO-0018','FLH-SO-0019','FLH-SO-0020',
   'FLH-SO-0021','FLH-SO-0022','FLH-SO-0023','FLH-SO-0024','FLH-SO-0025',
   'FLH-SO-0026','FLH-SO-0029','FLH-SO-0030','FLH-SO-0031','FLH-SO-0035',
   'FLH-SO-0036','FLH-SO-0038','FLH-SO-0042','FLH-SO-0056'
 )
UNION ALL
SELECT 'pos_transactions', count(*) FROM faitlynhair.pos_transactions pt
  JOIN faitlynhair.sales_orders so ON so.order_id = pt.order_id
 WHERE so.order_number IN (
   'FLH-SO-0001','FLH-SO-0002','FLH-SO-0003','FLH-SO-0004','FLH-SO-0005',
   'FLH-SO-0006','FLH-SO-0007','FLH-SO-0008','FLH-SO-0009','FLH-SO-0010',
   'FLH-SO-0011','FLH-SO-0012','FLH-SO-0013','FLH-SO-0014','FLH-SO-0015',
   'FLH-SO-0016','FLH-SO-0017','FLH-SO-0018','FLH-SO-0019','FLH-SO-0020',
   'FLH-SO-0021','FLH-SO-0022','FLH-SO-0023','FLH-SO-0024','FLH-SO-0025',
   'FLH-SO-0026','FLH-SO-0029','FLH-SO-0030','FLH-SO-0031','FLH-SO-0035',
   'FLH-SO-0036','FLH-SO-0038','FLH-SO-0042','FLH-SO-0056'
 )
UNION ALL
SELECT 'invoices (SET NULL, kept)', count(*) FROM faitlynhair.invoices iv
  JOIN faitlynhair.sales_orders so ON so.order_id = iv.order_id
 WHERE so.order_number IN (
   'FLH-SO-0001','FLH-SO-0002','FLH-SO-0003','FLH-SO-0004','FLH-SO-0005',
   'FLH-SO-0006','FLH-SO-0007','FLH-SO-0008','FLH-SO-0009','FLH-SO-0010',
   'FLH-SO-0011','FLH-SO-0012','FLH-SO-0013','FLH-SO-0014','FLH-SO-0015',
   'FLH-SO-0016','FLH-SO-0017','FLH-SO-0018','FLH-SO-0019','FLH-SO-0020',
   'FLH-SO-0021','FLH-SO-0022','FLH-SO-0023','FLH-SO-0024','FLH-SO-0025',
   'FLH-SO-0026','FLH-SO-0029','FLH-SO-0030','FLH-SO-0031','FLH-SO-0035',
   'FLH-SO-0036','FLH-SO-0038','FLH-SO-0042','FLH-SO-0056'
 );

-- ── TRANSACTIONAL DELETE ────────────────────────────────────────────────────
BEGIN;

-- Resolve the target order_ids ONCE. Every delete below joins this set, so the
-- blast radius is exactly these order numbers — nothing else can be touched.
CREATE TEMP TABLE _flh_cleanup_targets ON COMMIT DROP AS
SELECT order_id, order_number
  FROM faitlynhair.sales_orders
 WHERE order_number IN (
   'FLH-SO-0001','FLH-SO-0002','FLH-SO-0003','FLH-SO-0004','FLH-SO-0005',
   'FLH-SO-0006','FLH-SO-0007','FLH-SO-0008','FLH-SO-0009','FLH-SO-0010',
   'FLH-SO-0011','FLH-SO-0012','FLH-SO-0013','FLH-SO-0014','FLH-SO-0015',
   'FLH-SO-0016','FLH-SO-0017','FLH-SO-0018','FLH-SO-0019','FLH-SO-0020',
   'FLH-SO-0021','FLH-SO-0022','FLH-SO-0023','FLH-SO-0024','FLH-SO-0025',
   'FLH-SO-0026','FLH-SO-0029','FLH-SO-0030','FLH-SO-0031','FLH-SO-0035',
   'FLH-SO-0036','FLH-SO-0038','FLH-SO-0042','FLH-SO-0056'
 );

-- Safety rails: must match at least one and never more than the 34 listed.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _flh_cleanup_targets;
  RAISE NOTICE 'Target orders matched for deletion: %', n;
  IF n = 0 THEN
    RAISE EXCEPTION 'Aborting: no matching orders found (wrong DB/schema?).';
  END IF;
  IF n > 34 THEN
    RAISE EXCEPTION 'Aborting: matched % orders, more than the 34 listed.', n;
  END IF;
END $$;

-- 1) pos_void_log → pos_transactions (blocking child of a blocking child).
DELETE FROM faitlynhair.pos_void_log v
 USING faitlynhair.pos_transactions p, _flh_cleanup_targets t
 WHERE v.transaction_id = p.transaction_id
   AND p.order_id = t.order_id;

-- 2) pos_transactions (FK to sales_orders has no cascade → would block).
DELETE FROM faitlynhair.pos_transactions p
 USING _flh_cleanup_targets t
 WHERE p.order_id = t.order_id;

-- 3) cancellation_requests (FK to sales_orders has no cascade → would block).
DELETE FROM faitlynhair.cancellation_requests c
 USING _flh_cleanup_targets t
 WHERE c.order_id = t.order_id;

-- 4) The orders. CASCADE clears lines, discounts, payments, state_history.
DELETE FROM faitlynhair.sales_orders o
 USING _flh_cleanup_targets t
 WHERE o.order_id = t.order_id;

-- Verify: must be 0. (Temp rows persist until COMMIT, so this re-checks the
-- exact target set against what's left in sales_orders.)
SELECT count(*) AS remaining
  FROM faitlynhair.sales_orders o
  JOIN _flh_cleanup_targets t ON t.order_id = o.order_id;

COMMIT;
-- If anything above looked wrong, run ROLLBACK; instead of relying on COMMIT.
