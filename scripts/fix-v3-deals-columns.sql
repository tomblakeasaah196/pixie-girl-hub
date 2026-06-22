-- Idempotent fix: ensure the v3 deals-engine columns exist on BOTH brand
-- schemas. Safe to run repeatedly (ADD COLUMN IF NOT EXISTS). This backfills
-- live databases that bootstrapped before migration 000048 was applied with
-- the correct {{BUSINESS}} placeholder.
--
-- Run on the server:
--   PGPASSWORD='***' psql -h localhost -U pixie_admin -d pixiedata \
--     -f scripts/fix-v3-deals-columns.sql

DO $$
DECLARE
  s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['pixiegirl', 'faitlynhair']
  LOOP
    -- sales_campaigns: delivery timeline + deal configs
    EXECUTE format($f$
      ALTER TABLE %I.sales_campaigns
        ADD COLUMN IF NOT EXISTS delivery_weeks       SMALLINT,
        ADD COLUMN IF NOT EXISTS preorder_extra_weeks SMALLINT DEFAULT 4,
        ADD COLUMN IF NOT EXISTS position_ladder      JSONB,
        ADD COLUMN IF NOT EXISTS stacking_bonus       JSONB,
        ADD COLUMN IF NOT EXISTS bulk_tiers           JSONB
    $f$, s);

    -- product_bundle_items: styled-product reference
    EXECUTE format($f$
      ALTER TABLE %I.product_bundle_items
        ADD COLUMN IF NOT EXISTS styled_id UUID
    $f$, s);

    -- sales_campaign_products: styled reference + denormalised display fields
    -- (image, both-currency prices, long + short copy — snapshotted on add).
    EXECUTE format($f$
      ALTER TABLE %I.sales_campaign_products
        ADD COLUMN IF NOT EXISTS styled_id          UUID,
        ADD COLUMN IF NOT EXISTS image_url          TEXT,
        ADD COLUMN IF NOT EXISTS regular_price_ngn  NUMERIC(14,4),
        ADD COLUMN IF NOT EXISTS regular_price_usd  NUMERIC(14,4),
        ADD COLUMN IF NOT EXISTS campaign_price_usd NUMERIC(14,4),
        ADD COLUMN IF NOT EXISTS short_description  TEXT,
        ADD COLUMN IF NOT EXISTS long_description   TEXT
    $f$, s);

    RAISE NOTICE 'v3 deals columns ensured on schema %', s;
  END LOOP;
END $$;

-- Verification — every row below should print for both schemas.
SELECT table_schema, table_name, column_name
  FROM information_schema.columns
 WHERE table_schema IN ('pixiegirl', 'faitlynhair')
   AND ( (table_name = 'sales_campaigns'
          AND column_name IN ('delivery_weeks','preorder_extra_weeks',
                              'position_ladder','stacking_bonus','bulk_tiers'))
      OR (table_name = 'product_bundle_items' AND column_name = 'styled_id')
      OR (table_name = 'sales_campaign_products'
          AND column_name IN ('styled_id','image_url','regular_price_ngn',
                              'regular_price_usd','campaign_price_usd',
                              'short_description','long_description')) )
 ORDER BY table_schema, table_name, column_name;
