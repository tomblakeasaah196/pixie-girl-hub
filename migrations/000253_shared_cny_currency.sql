-- ============================================================
-- MIGRATION 000253 — Add CNY (Chinese Yuan) trading currency
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- The launch seed (000015) only inserted NGN, USD, GBP, EUR, CAD, GHS. But the
-- business imports hair from China and prices suppliers / purchase orders in
-- Chinese Yuan — the purchasing UI even DEFAULTS the trading currency to CNY.
--
-- Because {{BUSINESS}}.suppliers.default_currency (and po / supplier-invoice
-- currency columns) carry an FK to shared.currencies, creating a supplier or PO
-- in CNY raised a 23503 foreign-key violation, surfaced to the client as a
-- 409 REFERENCE_INVALID ("Referenced record not found"). Seeding CNY closes the
-- gap so the currency the UI offers actually exists.
--
-- Idempotent: ON CONFLICT DO NOTHING.
-- ============================================================

INSERT INTO shared.currencies
  (currency_code, display_name, symbol, decimal_places, rounding_unit, is_settlement, is_active, display_order)
VALUES
  ('CNY', 'Chinese Yuan', '¥', 2, 1, false, true, 7)
ON CONFLICT (currency_code) DO NOTHING;
