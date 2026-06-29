-- ============================================================
-- MIGRATION 000246 — Retention economy engine (Module 6.23)
-- Pixie Girl Hub · JBS Praxis
--
-- Makes the loyalty + referral *economy* config-driven, closing the
-- "you can't change the programme without code" gap:
--
--   loyalty_earn_rules         — HOW points are earned (purchase, review,
--                                referral, milestone, social-share, bonus).
--                                Replaces the hardcoded 1pt/₦100 rule.
--   loyalty_rewards            — WHAT points buy (order discount, free
--                                shipping, free product, gift). The redemption
--                                catalogue.
--   loyalty_reward_redemptions — append-only log of catalogue redemptions.
--   referral_program_settings  — per-business referral rules (friend discount,
--                                default reward, anti-fraud, reward trigger).
--   referral_reward_tiers      — the tiered referrer ladder (after 1/5/10…).
--
-- All five live in `shared` because loyalty + referral state is shared
-- across the two brands (see 000007) — one balance, one referral code.
-- Brand-specific targets (a free product/variant) are stored as soft FK
-- UUIDs, exactly like shared.coupons.applies_to_products.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ LOYALTY EARN RULES — config-driven point earning                   ║
-- ╚════════════════════════════════════════════════════════════════════╝
CREATE TABLE shared.loyalty_earn_rules (
  rule_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  rule_key              TEXT        NOT NULL,
  display_name          TEXT        NOT NULL,
  description           TEXT,
  -- Earn-action; aligned with shared.loyalty_ledger.transaction_type earns.
  action_type           TEXT        NOT NULL
                        CHECK (action_type IN ('earned_purchase','earned_review','earned_referral',
                                               'earned_milestone','earned_social_share','earned_bonus')),
  -- How the points are computed.
  points_mode           TEXT        NOT NULL DEFAULT 'flat'
                        CHECK (points_mode IN ('flat','per_currency')),
  points_value          INTEGER,                                -- flat: points awarded
  currency_per_point    NUMERIC(14,2),                          -- per_currency: ₦ per 1 point (e.g. 100)
  apply_tier_multiplier BOOLEAN     NOT NULL DEFAULT true,      -- scale by the customer's tier multiplier
  -- Conditions / caps.
  min_order_value       NUMERIC(14,2),                          -- only earn above this order value
  max_awards_per_customer_lifetime INTEGER,
  rate_limit_days       SMALLINT,                               -- with max_per_window, throttles repeat earns
  max_per_window        SMALLINT,
  points_expire_days    INTEGER,                                -- sets loyalty_ledger.expires_at on the earn
  eligibility_criteria  JSONB       NOT NULL DEFAULT '{}'::jsonb,-- declarative predicate (segment, first_time…)
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  display_order         SMALLINT    NOT NULL DEFAULT 0,
  created_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, rule_key),
  CONSTRAINT loyalty_earn_value_present CHECK (
    (points_mode = 'flat'         AND points_value IS NOT NULL) OR
    (points_mode = 'per_currency' AND currency_per_point IS NOT NULL AND currency_per_point > 0)
  )
);
CREATE TRIGGER trg_loyalty_earn_rules_updated_at
  BEFORE UPDATE ON shared.loyalty_earn_rules
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_loyalty_earn_rules_active
  ON shared.loyalty_earn_rules (business, action_type) WHERE is_active = true;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ LOYALTY REWARDS — the redemption catalogue                         ║
-- ╚════════════════════════════════════════════════════════════════════╝
CREATE TABLE shared.loyalty_rewards (
  reward_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  reward_key            TEXT        NOT NULL,
  display_name          TEXT        NOT NULL,
  description           TEXT,
  reward_type           TEXT        NOT NULL
                        CHECK (reward_type IN ('order_discount','free_shipping','free_product','gift')),
  points_cost           INTEGER     NOT NULL CHECK (points_cost > 0),
  -- order_discount.
  discount_type         TEXT        CHECK (discount_type IN ('percentage','fixed_amount')),
  discount_value        NUMERIC(14,4),
  max_discount_value    NUMERIC(14,2),                          -- cap for percentage
  -- free_product (soft FK — UUID only, like coupons.applies_to_products).
  free_product_id       UUID,
  free_variant_id       UUID,
  -- gift.
  gift_description      TEXT,
  -- Gating + limits.
  min_tier_id           UUID        REFERENCES shared.loyalty_tiers (tier_id) ON DELETE SET NULL,
  max_redemptions_per_customer INTEGER,
  total_redemption_limit INTEGER,
  total_redeemed        INTEGER     NOT NULL DEFAULT 0,
  valid_from            TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to              TIMESTAMPTZ,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  display_order         SMALLINT    NOT NULL DEFAULT 0,
  metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, reward_key)
);
CREATE TRIGGER trg_loyalty_rewards_updated_at
  BEFORE UPDATE ON shared.loyalty_rewards
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_loyalty_rewards_active
  ON shared.loyalty_rewards (business, display_order) WHERE is_active = true;

CREATE TABLE shared.loyalty_reward_redemptions (
  redemption_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id             UUID        NOT NULL REFERENCES shared.loyalty_rewards (reward_id) ON DELETE RESTRICT,
  contact_id            UUID        NOT NULL REFERENCES shared.contacts (contact_id) ON DELETE CASCADE,
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  points_spent          INTEGER     NOT NULL,
  -- The matching 'redeemed' loyalty_ledger row (audit trail).
  ledger_id             UUID        REFERENCES shared.loyalty_ledger (ledger_id) ON DELETE SET NULL,
  reference_type        TEXT,                                    -- 'sales_order','pos_transaction','storefront_order','manual'
  reference_id          UUID,
  fulfilment            JSONB       NOT NULL DEFAULT '{}'::jsonb,-- {discount_ngn, free_variant_id, …}
  status                TEXT        NOT NULL DEFAULT 'applied'
                        CHECK (status IN ('applied','reversed','pending','rejected')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_loyalty_reward_redemptions_contact
  ON shared.loyalty_reward_redemptions (contact_id, created_at DESC);
CREATE INDEX idx_loyalty_reward_redemptions_reward
  ON shared.loyalty_reward_redemptions (reward_id, created_at DESC);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ REFERRAL PROGRAMME — config-driven rules + tiered ladder           ║
-- ╚════════════════════════════════════════════════════════════════════╝
CREATE TABLE shared.referral_program_settings (
  business              TEXT        PRIMARY KEY REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  -- When the referrer reward fires.
  reward_on             TEXT        NOT NULL DEFAULT 'full_settlement'
                        CHECK (reward_on IN ('order_placed','full_settlement')),
  -- Friend (referred customer) incentive.
  friend_discount_type  TEXT        CHECK (friend_discount_type IN ('percentage','fixed_amount')),
  friend_discount_value NUMERIC(14,4),
  friend_min_order_value NUMERIC(14,2),
  -- Default referrer reward when no ladder rung matches.
  default_referrer_points INTEGER   NOT NULL DEFAULT 500,
  default_referrer_credit_ngn NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- A referred order must be at least this much to qualify.
  min_qualifying_order_ngn NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Anti-fraud toggles evaluated at redemption time.
  anti_fraud            JSONB       NOT NULL DEFAULT
                        '{"block_self_referral":true,"flag_device_match":true,"flag_payment_match":true}'::jsonb,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL
);
CREATE TRIGGER trg_referral_program_settings_updated_at
  BEFORE UPDATE ON shared.referral_program_settings
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

CREATE TABLE shared.referral_reward_tiers (
  tier_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  display_name          TEXT,
  -- The rung applies once the referrer has at least this many successful referrals.
  min_successful_referrals INTEGER  NOT NULL CHECK (min_successful_referrals >= 1),
  referrer_points       INTEGER     NOT NULL DEFAULT 0,
  referrer_credit_ngn   NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, min_successful_referrals)
);
CREATE TRIGGER trg_referral_reward_tiers_updated_at
  BEFORE UPDATE ON shared.referral_reward_tiers
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_referral_reward_tiers_business
  ON shared.referral_reward_tiers (business, min_successful_referrals DESC) WHERE is_active = true;

-- ============================================================
-- NB: per-business default rows (earn rules, rewards, referral settings +
-- ladder) are seeded by the per-brand bootstrap via the template migration
-- 000066, because shared.business_config has no rows yet at db:migrate:shared
-- time (businesses are provisioned later by scripts/bootstrap-business.js).
-- This file only creates the (empty) shared tables.
-- ============================================================
-- Verify
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'shared'
-- AND table_name IN ('loyalty_earn_rules','loyalty_rewards','loyalty_reward_redemptions',
--                     'referral_program_settings','referral_reward_tiers');
-- Expected: 5 rows
-- ============================================================
