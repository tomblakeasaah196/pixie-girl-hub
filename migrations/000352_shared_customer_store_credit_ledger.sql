-- ============================================================
-- MIGRATION 000352 — Customer store-credit ledger
-- Pixie Girl Hub · JBS Praxis
--
-- P1-7: referral_program_settings.referrer_credit_ngn (and its per-tier
-- twin on the ladder) was collected via the retention admin but never
-- created a real balance anywhere — retention.service.redeemReferral only
-- bumped referrals.total_rewards_value, a display counter with no
-- financial meaning. Referrers were promised "₦X credit" that was, in
-- effect, a phantom number.
--
-- This table is the append-only ledger of every store-credit movement:
--   * earned_referral   — a friend's order settled; credit accrues here
--   * order_redeemed    — spent at checkout on a future order (future PR)
--   * manual_adjustment — CEO / support correction
--   * expiry            — configurable lapse (future policy)
--   * reversal          — matched compensating entry on refund/cancel
--
-- Balance is SUM(amount_ngn) per (contact_id, business). The service
-- surface + storefront checkout wiring for SPENDING credit ship in a
-- follow-up; landing this table + the accrual path from redeemReferral
-- turns the phantom number into a real, auditable balance.
-- ============================================================

CREATE TABLE shared.customer_store_credit_ledger (
  entry_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            UUID        NOT NULL REFERENCES shared.contacts (contact_id) ON DELETE CASCADE,
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  amount_ngn            NUMERIC(14,2) NOT NULL,        -- positive = credit granted; negative = spent / reversed
  transaction_type      TEXT        NOT NULL
                        CHECK (transaction_type IN (
                          'earned_referral',
                          'order_redeemed',
                          'manual_adjustment',
                          'reversal',
                          'expiry'
                        )),
  reference_type        TEXT,                          -- 'referral_redemption','sales_order','manual'
  reference_id          UUID,
  notes                 TEXT,
  created_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT store_credit_nonzero CHECK (amount_ngn <> 0)
);

CREATE INDEX idx_customer_store_credit_ledger_contact
  ON shared.customer_store_credit_ledger (business, contact_id, created_at DESC);

CREATE INDEX idx_customer_store_credit_ledger_ref
  ON shared.customer_store_credit_ledger (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- ============================================================
-- +1 table. db:verify count updated in scripts/verify-schema.js.
-- ============================================================
