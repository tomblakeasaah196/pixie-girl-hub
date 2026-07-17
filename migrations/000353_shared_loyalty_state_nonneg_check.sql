-- ============================================================
-- MIGRATION 000353 — Non-negative loyalty balance CHECK
-- Pixie Girl Hub · JBS Praxis
--
-- P1-5: point balances had no concurrency guard. redeemPoints,
-- redeemReward, and the checkout redemption path all did
-- read-balance-then-insert with no row lock, so two concurrent
-- redemptions could both pass the balance check and drive
-- shared.customer_loyalty_state.current_balance negative. The trigger-
-- maintained balance had no CHECK constraint to catch it.
--
-- This migration is the belt-and-braces backstop: even if a caller
-- forgets to lock (getLoyaltyStateForUpdate is the new default), the DB
-- refuses to store a negative balance. The service-side locks eliminate
-- the race entirely; this constraint means a race we missed can't corrupt
-- state — it will surface as a 500 the calling code MUST handle instead
-- of silently owing the customer credit.
--
-- Idempotent: guarded by pg_constraint lookup so re-runs are safe.
-- Deferrable NOT VALID + validate later in case any historical rows are
-- already negative (repair them before validating).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'customer_loyalty_state_balance_nonneg'
  ) THEN
    ALTER TABLE shared.customer_loyalty_state
      ADD CONSTRAINT customer_loyalty_state_balance_nonneg
      CHECK (current_balance >= 0);
  END IF;
END $$;

-- ============================================================
-- No new tables. Table count unchanged.
-- ============================================================
