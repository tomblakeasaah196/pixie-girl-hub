-- ============================================================
-- MIGRATION 000354 — Voucher binding + per-reward voucher expiry
-- Pixie Girl Hub · JBS Praxis
--
-- P1-6: reward vouchers had three latent failures.
--   1. Non-atomic: customer_auth/customer-retention.service.redeem burned
--      points in one transaction and minted the coupon AFTER — a mint
--      failure (COUPON_EXISTS collision) left the points spent with no
--      voucher and no compensation.
--   2. Not bound to the redeeming contact: per_customer_limit=1 was set
--      but any guest could bypass it (validateCoupon's per-customer
--      check requires a contact_id in the redemption). is_single_use was
--      written but never READ.
--   3. Never expired: no valid_to on the minted voucher, so vouchers
--      lived forever and stacked up.
--
-- Two schema changes here + service code follows in the same PR:
--   * shared.coupons.assigned_contact_id — when set, validateCoupon
--     accepts the coupon ONLY for that contact. Redirects the "voucher
--     I minted for Amina" semantics into the same predicate coupons
--     already run.
--   * shared.loyalty_rewards.voucher_expiry_days — how many days a
--     minted voucher is valid for. Default 90 days (agreed policy);
--     admins can override per reward. A NULL means no expiry (backward
--     compatibility only — the redeem flow always fills it in from this
--     column or the 90-day default).
-- ============================================================

ALTER TABLE shared.coupons
  ADD COLUMN IF NOT EXISTS assigned_contact_id UUID
    REFERENCES shared.contacts (contact_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coupons_assigned_contact
  ON shared.coupons (assigned_contact_id)
  WHERE assigned_contact_id IS NOT NULL;

ALTER TABLE shared.loyalty_rewards
  ADD COLUMN IF NOT EXISTS voucher_expiry_days SMALLINT;

-- ============================================================
-- No new tables. Table count unchanged.
-- ============================================================
