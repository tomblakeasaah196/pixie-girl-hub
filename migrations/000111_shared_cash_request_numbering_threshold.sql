-- ============================================================
-- 000111_shared_cash_request_threshold
-- W-6 (V2.2 §6.32): application-layer wiring for Cash Request.
--   business_config.cash_request_ceo_threshold_ngn — the amount at/above
--   which a cash request escalates from Finance to the CEO (default
--   ₦100,000). Below it, Finance approval is final.
--
-- The 'cash_request' document-numbering sequence (PXG-CR / FLH-CR) is
-- already seeded per business by template/000035, so it is not repeated
-- here. Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE shared.business_config
  ADD COLUMN IF NOT EXISTS cash_request_ceo_threshold_ngn NUMERIC(14,2) NOT NULL DEFAULT 100000;
