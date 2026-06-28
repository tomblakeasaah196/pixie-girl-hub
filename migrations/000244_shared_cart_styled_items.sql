-- ============================================================
-- 000244 — Storefront cart lines: styled variants + bundles
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- The original cart_items (000010) only modelled a base product variant
-- (product_id + variant_id). The Storefront Website sells STYLED variants
-- (styled_product_variants) and bundles (bundle_offers), and supports a
-- "buy unstyled / raw" toggle. Add those axes so a persistent guest cart can
-- hold what the website actually sells. Soft FKs to brand-schema tables are
-- validated in the service (the cart row's `business` column says which schema).
--
-- product_id is relaxed to NULL because a bundle line has no single product; a
-- CHECK guarantees every line still points at SOMETHING sellable.
-- ============================================================

ALTER TABLE shared.cart_items
  ADD COLUMN IF NOT EXISTS styled_variant_id UUID,
  ADD COLUMN IF NOT EXISTS bundle_id         UUID,
  ADD COLUMN IF NOT EXISTS unstyled          BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE shared.cart_items ALTER COLUMN product_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cart_item_has_target'
  ) THEN
    ALTER TABLE shared.cart_items
      ADD CONSTRAINT cart_item_has_target
      CHECK (product_id IS NOT NULL
             OR styled_variant_id IS NOT NULL
             OR bundle_id IS NOT NULL);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_cart_items_styled_variant
  ON shared.cart_items (styled_variant_id) WHERE styled_variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cart_items_bundle
  ON shared.cart_items (bundle_id) WHERE bundle_id IS NOT NULL;

-- ============================================================
-- Verify:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_schema='shared' AND table_name='cart_items'
--       AND column_name IN ('styled_variant_id','bundle_id','unstyled');  -- 3 rows
-- ============================================================
