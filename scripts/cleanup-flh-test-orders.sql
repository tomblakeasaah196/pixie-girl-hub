-- ============================================================================
-- HARD DELETE — Faitlynhair test/mock sales orders (+ their downstream graph)
-- ============================================================================
-- Removes 34 specific test orders from faitlynhair.sales_orders and the mock
-- artifacts that hang off them (invoices, deliveries, POS), so the reports that
-- read live from those tables stop showing mock data. Scoped strictly to the
-- order numbers listed below — the target set is resolved ONCE, up front, into a
-- temp table, and every delete joins that set, so the blast radius is exactly
-- these order numbers and nothing else.
--
-- ⚠️  HARD delete: rows are gone, not archived. Export the Sales report first.
--
-- ----------------------------------------------------------------------------
-- HOW TO RUN  (psql over SSH; you are already `sudo -u postgres psql -d pixiedata`)
-- ----------------------------------------------------------------------------
--   1) PREVIEW (read-only — deletes NOTHING, just prints what exists):
--        \i scripts/cleanup-flh-test-orders.sql
--      …or from the shell:
--        sudo -u postgres psql -d pixiedata -f scripts/cleanup-flh-test-orders.sql
--
--   2) EXECUTE (actually delete, full cleanup incl. invoices/deliveries/POS):
--        sudo -u postgres psql -d pixiedata -v confirm=DELETE \
--          -f scripts/cleanup-flh-test-orders.sql
--
--   2b) EXECUTE, but keep invoices/deliveries (orders only; their order_id is
--       just set NULL by the FK, the rows stay):
--        sudo -u postgres psql -d pixiedata -v confirm=DELETE -v keep_downstream=yes \
--          -f scripts/cleanup-flh-test-orders.sql
--
-- The destructive part runs inside ONE transaction with `ON_ERROR_STOP on` and
-- commits itself on success. There is NO manual COMMIT to forget — if anything
-- goes wrong (or the post-delete check is not exactly 0) it ROLLS BACK and
-- aborts. This is the fix for the earlier attempt, which left COMMIT to the
-- operator and was never committed (the `*` in the `pixiedata=*#` prompt).
--
-- VERIFIED against migrations/template/000019–000028:
--   • CASCADE (auto-removed): sales_order_lines, sales_order_discounts,
--       sales_order_payments, sales_order_state_history; invoice_lines,
--       invoice_payments, invoice_reminders; delivery_items, delivery_attempts,
--       delivery_state_history, delivery_proofs; pos_payment_splits.
--   • BLOCKING (no cascade → cleared first): cancellation_requests,
--       pos_transactions (+ pos_void_log), credit_notes (+ credit_note_lines)
--       and pay_on_delivery_collections.
--   • SET NULL (rows KEPT, link cleared — NOT deleted): quotations,
--       payroll commissions, production custom-order links, sales_campaign_signups,
--       email-campaign converted_order_id, courier_webhook_events, receipts.
--       (In `keep_downstream=yes` mode, invoices + deliveries fall here too.)
-- ============================================================================

\set ON_ERROR_STOP on

-- ── Resolve flags (defaults when not passed on the command line) ─────────────
\if :{?confirm}
\else
  \set confirm PREVIEW
\endif
\if :{?keep_downstream}
\else
  \set keep_downstream no
\endif

SELECT CASE WHEN :'confirm' = 'DELETE' THEN 'yes' ELSE 'no' END AS do_delete \gset
SELECT CASE WHEN lower(:'keep_downstream') IN ('yes','y','true','1')
            THEN 'no' ELSE 'yes' END                            AS do_downstream \gset

-- ── Resolve the target order_ids ONCE (used by preview AND delete) ───────────
DROP TABLE IF EXISTS _flh_targets;
CREATE TEMP TABLE _flh_targets AS
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

-- ── Safety rail: must match between 1 and 34 of the listed orders ────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _flh_targets;
  RAISE NOTICE '── Matched % target order(s) of the 34 listed ──', n;
  IF n = 0 THEN
    RAISE EXCEPTION 'No matching orders found — wrong database/schema? Aborting.';
  ELSIF n > 34 THEN
    RAISE EXCEPTION 'Matched % orders, more than the 34 listed — aborting.', n;
  END IF;
END $$;

-- ── PRE-CHECK (read-only): what exists for these orders right now ────────────
SELECT 'sales_orders'           AS "table", count(*) AS rows FROM _flh_targets
UNION ALL SELECT 'sales_order_lines',    count(*) FROM faitlynhair.sales_order_lines     x JOIN _flh_targets t ON t.order_id = x.order_id
UNION ALL SELECT 'sales_order_payments', count(*) FROM faitlynhair.sales_order_payments  x JOIN _flh_targets t ON t.order_id = x.order_id
UNION ALL SELECT 'sales_order_discounts',count(*) FROM faitlynhair.sales_order_discounts x JOIN _flh_targets t ON t.order_id = x.order_id
UNION ALL SELECT 'cancellation_requests',count(*) FROM faitlynhair.cancellation_requests x JOIN _flh_targets t ON t.order_id = x.order_id
UNION ALL SELECT 'pos_transactions',     count(*) FROM faitlynhair.pos_transactions      x JOIN _flh_targets t ON t.order_id = x.order_id
UNION ALL SELECT 'invoices',             count(*) FROM faitlynhair.invoices              x JOIN _flh_targets t ON t.order_id = x.order_id
UNION ALL SELECT 'deliveries',           count(*) FROM faitlynhair.deliveries            x JOIN _flh_targets t ON t.order_id = x.order_id
ORDER BY 1;

-- ── Branch on confirm flag ───────────────────────────────────────────────────
\if :do_delete

BEGIN;

\if :do_downstream
  -- ── INVOICE branch (credit notes block invoices → clear them first) ──
  DELETE FROM faitlynhair.credit_note_lines cnl
   USING faitlynhair.credit_notes cn, faitlynhair.invoices iv, _flh_targets t
   WHERE cnl.credit_note_id = cn.credit_note_id
     AND cn.invoice_id = iv.invoice_id
     AND iv.order_id = t.order_id;

  DELETE FROM faitlynhair.credit_notes cn
   USING faitlynhair.invoices iv, _flh_targets t
   WHERE cn.invoice_id = iv.invoice_id
     AND iv.order_id = t.order_id;

  DELETE FROM faitlynhair.receipts r
   USING faitlynhair.invoices iv, _flh_targets t
   WHERE r.invoice_id = iv.invoice_id
     AND iv.order_id = t.order_id;

  DELETE FROM faitlynhair.invoices iv
   USING _flh_targets t
   WHERE iv.order_id = t.order_id;
  --   ↳ cascades: invoice_lines, invoice_payments, invoice_reminders

  -- ── DELIVERY branch (POD collections block deliveries → clear first) ──
  DELETE FROM faitlynhair.pay_on_delivery_collections pc
   USING faitlynhair.deliveries d, _flh_targets t
   WHERE pc.delivery_id = d.delivery_id
     AND d.order_id = t.order_id;

  DELETE FROM faitlynhair.deliveries d
   USING _flh_targets t
   WHERE d.order_id = t.order_id;
  --   ↳ cascades: delivery_items, delivery_attempts, delivery_state_history, delivery_proofs
\endif

-- ── BLOCKERS (no cascade on sales_orders → must clear, both modes) ──
DELETE FROM faitlynhair.pos_void_log v
 USING faitlynhair.pos_transactions p, _flh_targets t
 WHERE v.transaction_id = p.transaction_id
   AND p.order_id = t.order_id;

DELETE FROM faitlynhair.pos_transactions p
 USING _flh_targets t
 WHERE p.order_id = t.order_id;
--   ↳ cascades: pos_payment_splits

DELETE FROM faitlynhair.cancellation_requests c
 USING _flh_targets t
 WHERE c.order_id = t.order_id;

-- ── The orders themselves ──
DELETE FROM faitlynhair.sales_orders o
 USING _flh_targets t
 WHERE o.order_id = t.order_id;
--   ↳ cascades: sales_order_lines, sales_order_discounts, sales_order_payments, sales_order_state_history
--   ↳ SET NULL: quotations, commissions, production custom orders, campaign signups, email recipients
--               (+ invoices, deliveries when keep_downstream=yes)

-- ── Post-delete guard: must be exactly 0, else roll back ──
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM faitlynhair.sales_orders o
    JOIN _flh_targets t ON t.order_id = o.order_id;
  IF n <> 0 THEN
    RAISE EXCEPTION 'Post-delete check failed: % target order(s) remain — rolling back.', n;
  END IF;
  RAISE NOTICE '✔ All target orders removed. Committing.';
END $$;

SELECT count(*) AS remaining_target_orders
  FROM faitlynhair.sales_orders o
  JOIN _flh_targets t ON t.order_id = o.order_id;

COMMIT;
\echo '======================================================================'
\echo ' ✔ DONE — deletion committed. Mock orders (and chosen artifacts) gone.'
\echo '======================================================================'

\else

\echo '======================================================================'
\echo ' PREVIEW ONLY — nothing was deleted.'
\echo ' Re-run with   -v confirm=DELETE   to perform the deletion.'
\echo '======================================================================'

\endif
