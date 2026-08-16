-- ============================================================
-- MIGRATION 000379 — Order amendments (Change Order)
-- Pixie Girl Hub · V2.2 §6.2
--
-- Applies template 000093 to every EXISTING brand schema, and seeds the
-- `order_amended` timeline event code so an amendment shows up on the
-- customer-facing order tracker alongside "Payment Received" and "Out for
-- Delivery".
--
-- Background: an order recorded against the wrong product had no correct
-- repair path. Cancelling forfeits any deposit to Other Income (policy Q7),
-- burns the order number, orphans the invoice and loses the customer's
-- history; a hand-edit in SQL leaves stock, the GL, the invoice, the Studio
-- job and the delivery all disagreeing. This adds the audit spine for
-- amending in place — see src/modules/sales/amendment.service.js and
-- docs/ORDER_AMENDMENTS.md.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS +
-- ON CONFLICT DO NOTHING, and it discovers brand schemas dynamically (so a
-- third business provisioned later is covered by the template, and any brand
-- that exists today is covered here).
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_schema AS s
      FROM information_schema.tables
     WHERE table_name = 'sales_orders'
       AND table_schema NOT IN ('template', 'shared', 'public')
  LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I.sales_order_amendments (
        amendment_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id              UUID        NOT NULL
                                REFERENCES %I.sales_orders (order_id) ON DELETE CASCADE,
        amendment_number      SMALLINT    NOT NULL,
        reason                TEXT        NOT NULL,
        reason_category       TEXT        NOT NULL DEFAULT 'other'
                              CHECK (reason_category IN (
                                'wrong_item','customer_change','price_correction',
                                'delivery_change','stock_substitution','other'
                              )),
        subtotal_before_ngn   NUMERIC(14,2) NOT NULL,
        discount_before_ngn   NUMERIC(14,2) NOT NULL,
        tax_before_ngn        NUMERIC(14,2) NOT NULL,
        shipping_before_ngn   NUMERIC(14,2) NOT NULL,
        total_before_ngn      NUMERIC(14,2) NOT NULL,
        subtotal_after_ngn    NUMERIC(14,2) NOT NULL,
        discount_after_ngn    NUMERIC(14,2) NOT NULL,
        tax_after_ngn         NUMERIC(14,2) NOT NULL,
        shipping_after_ngn    NUMERIC(14,2) NOT NULL,
        total_after_ngn       NUMERIC(14,2) NOT NULL,
        difference_ngn        NUMERIC(14,2) GENERATED ALWAYS AS
                                (total_after_ngn - total_before_ngn) STORED,
        amount_paid_ngn       NUMERIC(14,2) NOT NULL DEFAULT 0,
        balance_after_ngn     NUMERIC(14,2) NOT NULL DEFAULT 0,
        lines_before          JSONB       NOT NULL DEFAULT '[]'::jsonb,
        lines_after           JSONB       NOT NULL DEFAULT '[]'::jsonb,
        line_changes          JSONB       NOT NULL DEFAULT '[]'::jsonb,
        delivery_before       JSONB,
        delivery_after        JSONB,
        effects               JSONB       NOT NULL DEFAULT '{}'::jsonb,
        order_status_before   TEXT        NOT NULL,
        revenue_recognised    BOOLEAN     NOT NULL DEFAULT false,
        journal_entry_id      UUID,
        customer_notified     BOOLEAN     NOT NULL DEFAULT false,
        amended_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
        amended_by_name       TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT sales_order_amendment_seq_uq UNIQUE (order_id, amendment_number)
      )
    $sql$, r.s, r.s);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_sales_order_amendments_order
         ON %I.sales_order_amendments (order_id, amendment_number DESC)',
      r.s, r.s);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_sales_order_amendments_recent
         ON %I.sales_order_amendments (created_at DESC)',
      r.s, r.s);

    EXECUTE format(
      'ALTER TABLE %I.sales_orders
         ADD COLUMN IF NOT EXISTS amendment_count SMALLINT NOT NULL DEFAULT 0,
         ADD COLUMN IF NOT EXISTS last_amended_at TIMESTAMPTZ',
      r.s);

    RAISE NOTICE '000379: sales_order_amendments ready in %', r.s;
  END LOOP;
END $$;

-- ── Timeline vocabulary ──────────────────────────────────
-- The customer-facing tracker reads shared.timeline_event_codes; an unknown
-- code is REJECTED by the FK on order_timeline_events, so the amendment's
-- timeline entry needs its code seeded first. Customer-visible by default:
-- "we changed your order" is exactly the kind of thing a buyer should see on
-- her own tracker, and the payload the service records is deliberately
-- money-and-item only (no costs, no internal notes).
INSERT INTO shared.timeline_event_codes
  (code, default_label, applies_to_order_types, stage_group,
   default_customer_visible, display_order, is_system_code)
VALUES
  ('order_amended', 'Order Updated',
   '{physical,custom,service,subscription}', 'ordered', true, 35, true)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Verify:
--   SELECT table_schema FROM information_schema.tables
--    WHERE table_name = 'sales_order_amendments';
--   -- expected: one row per brand schema (pixiegirl, faitlynhair, …)
--
--   SELECT code, default_label FROM shared.timeline_event_codes
--    WHERE code = 'order_amended';
-- ============================================================
