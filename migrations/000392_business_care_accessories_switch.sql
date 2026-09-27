-- ============================================================
-- MIGRATION 000392 — Care & Accessories on/off switch
-- Pixie Girl Hub · PXG Care & Accessories
--
-- Applies template 000099 to the EXISTING brand schemas: adds
-- catalogue_config.care_accessories_enabled (default ON), the Catalogue →
-- Config switch that replaces the FEATURE_PXG_CARE_ACCESSORIES_ENABLED .env
-- variable. The gate reads it for pixiegirl only. Idempotent.
-- ============================================================

DO $$
DECLARE
  v_schema TEXT;
BEGIN
  FOREACH v_schema IN ARRAY ARRAY['pixiegirl','faitlynhair'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = v_schema AND table_name = 'catalogue_config'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.catalogue_config
           ADD COLUMN IF NOT EXISTS care_accessories_enabled BOOLEAN NOT NULL DEFAULT true',
        v_schema
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- Verify
--   SELECT table_schema, column_name, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'catalogue_config'
--      AND column_name = 'care_accessories_enabled';
--   Expected: present in pixiegirl + faitlynhair, default true.
-- ============================================================
