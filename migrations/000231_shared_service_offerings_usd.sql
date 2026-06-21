-- ============================================================
-- 000231 — Service Catalogue: USD pricing (dual-currency)
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- Services (shared.service_offerings) carry a Naira price; add the USD
-- counterparts so a service can be priced in both currencies (set manually,
-- never auto-converted). Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE shared.service_offerings
  ADD COLUMN IF NOT EXISTS base_price_usd       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS compare_at_price_usd NUMERIC(14,2);

-- ============================================================
-- Verify:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_schema = 'shared' AND table_name = 'service_offerings'
--       AND column_name LIKE '%_usd';            -- two rows
-- ============================================================
