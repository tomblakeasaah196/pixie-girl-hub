-- ============================================================
-- MIGRATION 000389 — shared.smartcomm_order_links.currency
-- Pixie Girl Hub · Nomba NGN/USD: ₦/$ choice on IG/WhatsApp order links
--
-- Staff now choose the currency an order link charges in when they share it
-- (owner decision, Sept 2026 — Nomba charges Naira or US Dollars only). The
-- /o/<slug> page shows the cart in that currency and the order it places is
-- charged in it (USD priced by the catalogue USD engine). Existing links keep
-- charging Naira, exactly as before. Idempotent.
-- ============================================================

ALTER TABLE shared.smartcomm_order_links
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NGN';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'smartcomm_order_links_currency_check'
  ) THEN
    ALTER TABLE shared.smartcomm_order_links
      ADD CONSTRAINT smartcomm_order_links_currency_check
      CHECK (currency IN ('NGN', 'USD'));
  END IF;
END $$;
