-- ============================================================
-- 000115_business_stripe_payment_method
-- Adds 'stripe_card' (international cards) + 'nomba_online' (Nomba checkout, vs
-- the existing 'nomba_terminal' POS) to the per-brand
-- sales_order_payments.method CHECK so every gateway resolves in Sales.
-- (provider is free-text — 'stripe' needs no schema change.)
--
-- Per-brand: rewrites the inline-named CHECK (sales_order_payments_method_check)
-- on every brand schema that has the table. Idempotent: DROP IF EXISTS then ADD.
-- The template (000019) is updated separately so new brands include it.
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_schema
      FROM information_schema.tables
     WHERE table_name = 'sales_order_payments'
       AND table_schema NOT IN ('template', 'information_schema', 'pg_catalog')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.sales_order_payments DROP CONSTRAINT IF EXISTS sales_order_payments_method_check',
      r.table_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.sales_order_payments ADD CONSTRAINT sales_order_payments_method_check ' ||
      'CHECK (method IN (''paystack_card'',''paystack_transfer'',''paystack_ussd'',' ||
      '''opay'',''nomba_terminal'',''nomba_online'',''bank_transfer'',''cash'',''pos_card'',' ||
      '''pay_on_delivery'',''wallet'',''points'',''subscription_recurring'',''stripe_card''))',
      r.table_schema
    );
  END LOOP;
END$$;
