-- ============================================================
-- MIGRATION 000351 — Drop the subscription billing double-writer trigger
-- Pixie Girl Hub · JBS Praxis
--
-- P0-6: the fn_subscription_handle_attempt trigger (migration 000014) and
-- the subscription.service both walked the same subscription_billing_attempts
-- row: the trigger bumped total_cycles_billed / total_amount_billed_ngn AND
-- failed_attempts_in_row, then the service did it all again. Success rows
-- were double-counted (2 cycles per real charge, 2× billed amount), and
-- decline rows over-incremented failed_attempts_in_row so the "pause after
-- 3" logic tripped after 2 real declines.
--
-- Worse, the trigger flipped status to 'past_due' on the FIRST failure while
-- claimDueForBilling only claimed status='active' — one decline permanently
-- stopped billing for that subscription, unreachable to the intended 3-
-- attempt dunning cascade.
--
-- The service is now the single writer for cycle / amount / failure counters
-- (subscription.service.runDueBilling calls repo.advanceAfterSuccess and
-- repo.recordBillingFailure). Drop both trigger and function so nothing else
-- ever writes to those columns.
-- ============================================================

DROP TRIGGER IF EXISTS trg_subscription_handle_attempt
  ON shared.subscription_billing_attempts;

DROP FUNCTION IF EXISTS shared.fn_subscription_handle_attempt();

-- ============================================================
-- No new tables. Table count unchanged.
-- ============================================================
