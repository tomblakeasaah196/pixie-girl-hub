-- ============================================================
-- MIGRATION 000239 — Zero VAT rate (owner decision)
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- The business does not charge VAT on sales. shared.business_config.vat_rate
-- shipped with a NOT NULL DEFAULT of 0.075 (7.5%), and the provisioning service
-- defaulted new brands to 0.075 as well — so every brand silently carried a
-- 7.5% VAT that createOrder added on top of the price the buyer saw on the
-- campaign checkout page. That made the order total (and the gateway charge)
-- ~7.5% higher than the "Pay ₦X" figure on the landing page.
--
-- Owner instruction: "If the VAT rate is 0, let it always be 0 — both brands."
--
-- This migration:
--   1. Flips the column DEFAULT from 0.075 → 0 so any future brand provisions
--      at 0% unless explicitly told otherwise.
--   2. Backfills every existing business_config row to 0 (idempotent).
--
-- NOTE: this fixes pricing for orders created from here on. Orders already in
-- the table keep their stored totals (which still include the old 7.5%). Those
-- are handled separately (cancel/recreate the unpaid ones; reconcile/refund any
-- that were actually paid VAT-inclusive at the gateway).
-- ============================================================

ALTER TABLE shared.business_config
  ALTER COLUMN vat_rate SET DEFAULT 0;

UPDATE shared.business_config
   SET vat_rate = 0
 WHERE vat_rate IS DISTINCT FROM 0;

COMMENT ON COLUMN shared.business_config.vat_rate IS
  'Default sales VAT rate for the brand (NUMERIC fraction, e.g. 0.075 = 7.5%). '
  'Owner decision: 0 = no VAT charged. Per-product overrides live on '
  'products.vat_rate (NULL = use this business default).';
