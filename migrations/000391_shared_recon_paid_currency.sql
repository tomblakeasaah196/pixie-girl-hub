-- ============================================================
-- MIGRATION 000391 — currency on the payment reconciliation queue
-- Pixie Girl Hub · Nomba NGN/USD reconciliation
--
-- shared.pos_terminal_reconciliation only knew amount_ngn. A USD Nomba capture
-- that could not be placed was parked with amount_ngn = 0 and the dollars in
-- the free-text note — so "Match" credited the order ₦0 (rejected by the
-- payments CHECK) or a Naira figure with the dollar truth lost.
--
--   paid_currency — the currency the customer actually paid (NULL/NGN = Naira)
--   paid_amount   — that amount in the paid currency's major units
--
-- Match converts a USD row at the TARGET order's locked rate and records the
-- dollars on the payment. Additive + idempotent.
-- ============================================================

ALTER TABLE shared.pos_terminal_reconciliation
  ADD COLUMN IF NOT EXISTS paid_currency TEXT,
  ADD COLUMN IF NOT EXISTS paid_amount   NUMERIC(18,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pos_terminal_reconciliation_paid_currency_check'
  ) THEN
    ALTER TABLE shared.pos_terminal_reconciliation
      ADD CONSTRAINT pos_terminal_reconciliation_paid_currency_check
      CHECK (paid_currency IS NULL OR paid_currency IN ('NGN', 'USD'));
  END IF;
END $$;
