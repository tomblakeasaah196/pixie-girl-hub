-- ============================================================
-- MIGRATION 000288 — widen sales_channel CHECK on brand sales_orders
-- Pixie Girl Hub · V2.2 §6.4
--
-- The Sales module's product-description v2.2 channel list was pruned to
-- 6 approved channels grouped Digital/Physical:
--   Digital  : whatsapp, instagram, storefront, sales_campaign  (NEW)
--   Physical : walk_in (NEW), event
--
-- 'sales_campaign' and 'walk_in' were not in the original CHECK, so the
-- constraint is rewritten to allow the full historical set PLUS the two
-- new values. Older channel values are retained so existing rows keep
-- their tag (no history rewrite); the UI hides them from the picker.
--
-- Both brand schemas carry an identical sales_orders table (the template
-- 000019 file is applied per business), so this migration walks both
-- schemas and rewrites the CHECK where the table exists. Fully idempotent.
-- ============================================================

DO $$
DECLARE
  v_schema TEXT;
BEGIN
  FOREACH v_schema IN ARRAY ARRAY['pixiegirl','faitlynhair'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = v_schema AND table_name = 'sales_orders'
    ) THEN
      -- Drop the old constraint (name is stable from the template).
      EXECUTE format(
        'ALTER TABLE %I.sales_orders DROP CONSTRAINT IF EXISTS sales_orders_sales_channel_check',
        v_schema
      );
      -- Re-add with the two new values appended.
      EXECUTE format(
        'ALTER TABLE %I.sales_orders ADD CONSTRAINT sales_orders_sales_channel_check
           CHECK (sales_channel IN (
             ''storefront'',''pos'',''woocommerce'',''instagram'',
             ''whatsapp'',''wholesale'',''partner'',''stylist_routed'',
             ''subscription'',''phone'',''event'',''public_form'',
             ''facebook'',''tiktok'',''intercompany'',
             ''sales_campaign'',''walk_in''
           ))',
        v_schema
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- Verify
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conname = 'sales_orders_sales_channel_check';
--   Expected: both pixiegirl.sales_orders + faitlynhair.sales_orders
--             include 'sales_campaign' and 'walk_in' in the CHECK.
-- ============================================================
