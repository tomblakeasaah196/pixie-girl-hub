-- ============================================================
-- 000208_shared_subscription_maintenance — Wig-maintenance add-on
-- (PD §6.23.5 / F-1 remainder)
--
-- An optional recurring maintenance fee that subscribers can opt into; it is
-- billed on top of the plan's price each cycle (see subscription.service billing
-- loop). Additive + idempotent — defaults keep every existing plan/subscriber
-- exactly as-is (fee 0, add-on off).
-- ============================================================

ALTER TABLE shared.subscription_plans
  ADD COLUMN IF NOT EXISTS maintenance_fee_ngn NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE shared.subscriptions
  ADD COLUMN IF NOT EXISTS maintenance_addon BOOLEAN NOT NULL DEFAULT false;
