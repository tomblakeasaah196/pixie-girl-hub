-- ============================================================
-- MIGRATION 000362 — Crowns 👑: unified Loyalty + Streak economy
-- Pixie Girl Hub · JBS Praxis · Retention (Module 6.23)
--
-- Merges the two overlapping economies into ONE canonical program:
--   • shared.loyalty_*        (spendable points, tier = earn-multiplier)
--   • {brand}.streak_star_*   (accumulate-only stars, tier = discount %)
-- …into "Crowns 👑" — the single currency for our Pixie Queens.
--
-- Design (decided with the owner):
--   • ONE currency: Crowns 👑 (integer).
--   • STATUS-ONLY: Crowns accumulate to drive a tier; they are never spent.
--     lifetime_earned never resets (7A) — so urgency lives in the STREAK,
--     which can lapse, not in Crown expiry.
--   • ONE merged tier ladder (Tiara → Coronet → Diadem → Imperial). Each tier
--     carries: a one-time "% off next purchase" voucher granted on promotion,
--     optional next-purchase free shipping, a standing lifetime discount
--     (Imperial only), an earn multiplier, and a benefits bundle.
--   • PER-BRAND wallets: a Pixie Queen at Pixie ≠ the same person at Faitlyn
--     (separate receipts) — enforced by the `business` column +
--     UNIQUE (contact_id, business), exactly like shared.loyalty_state (000007).
--   • REAL streaks (the upgrade): a monthly-purchase streak and a weekly
--     engagement streak, each with freezes + break nudges. As seeded they do
--     NOT mint Crowns (owner turned multiplier/milestone off) — they are a
--     retention signal for sales; all of that is config, flip it on any time.
--
-- Tables (8, all `shared`, business-scoped):
--   crown_tiers               — the ladder (thresholds, discounts, benefits)
--   crown_earn_rules          — CEO-configurable ways to earn Crowns
--   crown_ledger              — append-only 👑 transactions (source of truth)
--   customer_crown_state      — balance + tier (trigger-maintained, read-fast)
--   crown_streak_config       — per-brand streak definitions
--   crown_streaks             — per-customer streak state
--   crown_reward_grants       — one-time vouchers issued on tier promotion
--   crown_action_submissions  — verification queue (honor / manual earn proof)
--
-- verify-schema.js ledger: +8 shared tables → EXPECTED_SHARED 199 → 207.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CROWN TIERS — the merged ladder                                    ║
-- ║ Below the first tier's min_crowns the customer is an unranked      ║
-- ║ member (no perks). All thresholds/discounts/benefits are editable. ║
-- ╚════════════════════════════════════════════════════════════════════╝
CREATE TABLE shared.crown_tiers (
  tier_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  tier_key              TEXT        NOT NULL,                  -- 'tiara','coronet','diadem','imperial'
  tier_name             TEXT        NOT NULL,                  -- 'The Tiara'
  description           TEXT,
  -- Reach this many *lifetime* Crowns to enter the tier.
  min_crowns            INTEGER     NOT NULL CHECK (min_crowns >= 0),
  display_order         SMALLINT    NOT NULL,
  -- Promotion reward: a one-time voucher minted when the tier is first reached.
  next_purchase_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0
                        CHECK (next_purchase_discount_pct BETWEEN 0 AND 100),
  grants_free_shipping_next   BOOLEAN NOT NULL DEFAULT false,
  -- Standing lifetime discount (applied at checkout for anyone in this tier).
  lifetime_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0
                        CHECK (lifetime_discount_pct BETWEEN 0 AND 100),
  -- Earn multiplier (1.00 = neutral; kept for future tuning).
  earning_multiplier    NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  -- Standing benefits bundle, e.g.
  -- {"early_access":true,"exclusive_products":true,"birthday_bonus":true,
  --  "priority_support":true,"vip_sales":true,"extra_streak_freeze":true}
  benefits              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  badge_colour_hex      TEXT,
  badge_image_url       TEXT,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, tier_key)
);
CREATE TRIGGER trg_crown_tiers_updated_at
  BEFORE UPDATE ON shared.crown_tiers
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE UNIQUE INDEX idx_crown_tiers_order
  ON shared.crown_tiers (business, display_order) WHERE is_active = true;
CREATE INDEX idx_crown_tiers_business
  ON shared.crown_tiers (business, min_crowns) WHERE is_active = true;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CROWN EARN RULES — the "ways to earn"                              ║
-- ║ verification_mode captures how we know the action is real:         ║
-- ║   auto   — a system event proves it (order paid, DOB saved, …)     ║
-- ║   honor  — one-tap "I did it" (social follows: no verifiable API)  ║
-- ║   manual — proof enters a queue, staff approves (IG tag, UGC)      ║
-- ╚════════════════════════════════════════════════════════════════════╝
CREATE TABLE shared.crown_earn_rules (
  rule_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  rule_key              TEXT        NOT NULL,
  display_name          TEXT        NOT NULL,
  description           TEXT,
  action_type           TEXT        NOT NULL
                        CHECK (action_type IN (
                          'create_account',
                          'complete_purchase',        -- flat 👑 per paid order
                          'money_spent',              -- 👑 per unit currency spent
                          'refer_friend_purchase',
                          'newsletter_subscribe',
                          'add_birthday',
                          'leave_review',
                          'social_follow',            -- with social_platform
                          'social_tag',               -- tag us + paste link (manual)
                          'ugc_upload',               -- upload your Pixie photo (manual)
                          'hair_quiz_complete',
                          'order_milestone',
                          'manual'
                        )),
  -- How Crowns are computed.
  crowns_mode           TEXT        NOT NULL DEFAULT 'flat'
                        CHECK (crowns_mode IN ('flat','per_currency')),
  crown_value           INTEGER,                                -- flat: 👑 awarded
  unit_currency_per_crown NUMERIC(14,2),                        -- per_currency: ₦ per 1 👑
  -- How we verify.
  verification_mode     TEXT        NOT NULL DEFAULT 'auto'
                        CHECK (verification_mode IN ('auto','honor','manual')),
  social_platform       TEXT        CHECK (social_platform IN ('instagram','tiktok','x','facebook','youtube',NULL)),
  -- Conditions / anti-abuse caps.
  min_order_value       NUMERIC(14,2),
  max_awards_per_customer_lifetime  INTEGER,
  max_awards_per_customer_per_month INTEGER,
  max_awards_per_customer_per_year  INTEGER,
  required_minimum_tier_key TEXT,
  eligibility_criteria  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  apply_tier_multiplier BOOLEAN     NOT NULL DEFAULT false,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  display_order         SMALLINT    NOT NULL DEFAULT 0,
  created_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, rule_key),
  CONSTRAINT crown_earn_value_present CHECK (
    (crowns_mode = 'flat'         AND crown_value IS NOT NULL AND crown_value > 0) OR
    (crowns_mode = 'per_currency' AND unit_currency_per_crown IS NOT NULL AND unit_currency_per_crown > 0)
  )
);
CREATE TRIGGER trg_crown_earn_rules_updated_at
  BEFORE UPDATE ON shared.crown_earn_rules
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX idx_crown_earn_rules_active
  ON shared.crown_earn_rules (business, action_type) WHERE is_active = true;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CROWN LEDGER — append-only 👑 transactions (source of truth)        ║
-- ║ No 'redeem' type: Crowns are status-only and are never spent.      ║
-- ╚════════════════════════════════════════════════════════════════════╝
CREATE TABLE shared.crown_ledger (
  ledger_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            UUID        NOT NULL REFERENCES shared.contacts (contact_id) ON DELETE RESTRICT,
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  transaction_type      TEXT        NOT NULL
                        CHECK (transaction_type IN ('earn','adjust_credit','adjust_debit','reversal','manual_revoke')),
  crowns                INTEGER     NOT NULL,                  -- signed: +earn, −reversal/revoke
  earn_rule_id          UUID        REFERENCES shared.crown_earn_rules (rule_id) ON DELETE SET NULL,
  earn_action_type      TEXT,                                  -- snapshot (survives rule edits)
  multiplier_used       NUMERIC(4,2),
  reference_type        TEXT,                                  -- 'sales_order','review','social_submission','manual','loyalty_backfill','streak_backfill'
  reference_id          UUID,
  description           TEXT,
  awarded_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  reverses_ledger_id    UUID        REFERENCES shared.crown_ledger (ledger_id) ON DELETE SET NULL,
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  ledger_sequence       BIGSERIAL   UNIQUE
);
CREATE INDEX idx_crown_ledger_contact
  ON shared.crown_ledger (contact_id, business, occurred_at DESC);
CREATE INDEX idx_crown_ledger_rule
  ON shared.crown_ledger (earn_rule_id, occurred_at DESC) WHERE earn_rule_id IS NOT NULL;
CREATE INDEX idx_crown_ledger_reference
  ON shared.crown_ledger (reference_type, reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX idx_crown_ledger_action_day
  ON shared.crown_ledger (business, earn_action_type, occurred_at);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CUSTOMER CROWN STATE — balance + tier (trigger-maintained)         ║
-- ╚════════════════════════════════════════════════════════════════════╝
CREATE TABLE shared.customer_crown_state (
  state_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            UUID        NOT NULL REFERENCES shared.contacts (contact_id) ON DELETE CASCADE,
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  current_crowns        INTEGER     NOT NULL DEFAULT 0,        -- displayed balance
  lifetime_earned       INTEGER     NOT NULL DEFAULT 0,        -- drives tier; never decreases
  current_tier_id       UUID        REFERENCES shared.crown_tiers (tier_id) ON DELETE SET NULL,
  next_tier_id          UUID        REFERENCES shared.crown_tiers (tier_id) ON DELETE SET NULL,
  crowns_to_next_tier   INTEGER,
  last_earn_at          TIMESTAMPTZ,
  last_tier_promotion_at TIMESTAMPTZ,
  tier_entered_at       TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, business)
);
CREATE INDEX idx_customer_crown_state_tier
  ON shared.customer_crown_state (business, current_tier_id);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CROWN STATE RECOMPUTE TRIGGER                                      ║
-- ║ Balance + tier are derived from the ledger. lifetime_earned counts ║
-- ║ only positive rows (gross earned) so it never resets — reversals   ║
-- ║ reduce the spendless current_crowns but not tier standing (7A).    ║
-- ╚════════════════════════════════════════════════════════════════════╝
CREATE OR REPLACE FUNCTION shared.fn_crown_state_recompute()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_contact   UUID;
  v_business  TEXT;
  v_current   INTEGER;
  v_lifetime  INTEGER;
  v_tier      UUID;
  v_next_tier UUID;
  v_next_min  INTEGER;
  v_to_next   INTEGER;
  v_old_tier  UUID;
BEGIN
  v_contact  := COALESCE(NEW.contact_id, OLD.contact_id);
  v_business := COALESCE(NEW.business, OLD.business);

  SELECT current_tier_id INTO v_old_tier
    FROM shared.customer_crown_state
   WHERE contact_id = v_contact AND business = v_business;

  SELECT COALESCE(SUM(crowns), 0),
         COALESCE(SUM(crowns) FILTER (WHERE crowns > 0), 0)
    INTO v_current, v_lifetime
    FROM shared.crown_ledger
   WHERE contact_id = v_contact AND business = v_business;

  -- Current tier: highest tier whose threshold the lifetime total clears.
  SELECT tier_id INTO v_tier
    FROM shared.crown_tiers
   WHERE business = v_business AND is_active = true AND min_crowns <= v_lifetime
   ORDER BY display_order DESC LIMIT 1;

  -- Next tier: the lowest tier still above the lifetime total.
  SELECT tier_id, min_crowns INTO v_next_tier, v_next_min
    FROM shared.crown_tiers
   WHERE business = v_business AND is_active = true AND min_crowns > v_lifetime
   ORDER BY display_order ASC LIMIT 1;

  v_to_next := CASE WHEN v_next_min IS NULL THEN NULL
                    ELSE GREATEST(0, v_next_min - v_lifetime) END;

  INSERT INTO shared.customer_crown_state
    (contact_id, business, current_crowns, lifetime_earned, current_tier_id,
     next_tier_id, crowns_to_next_tier, last_earn_at,
     last_tier_promotion_at, tier_entered_at, updated_at)
  VALUES
    (v_contact, v_business, v_current, v_lifetime, v_tier,
     v_next_tier, v_to_next, COALESCE(NEW.occurred_at, now()),
     CASE WHEN v_tier IS DISTINCT FROM v_old_tier THEN now() ELSE NULL END,
     CASE WHEN v_tier IS DISTINCT FROM v_old_tier THEN now() ELSE NULL END,
     now())
  ON CONFLICT (contact_id, business) DO UPDATE
    SET current_crowns       = EXCLUDED.current_crowns,
        lifetime_earned      = EXCLUDED.lifetime_earned,
        current_tier_id      = EXCLUDED.current_tier_id,
        next_tier_id         = EXCLUDED.next_tier_id,
        crowns_to_next_tier  = EXCLUDED.crowns_to_next_tier,
        last_earn_at         = EXCLUDED.last_earn_at,
        last_tier_promotion_at = CASE
          WHEN shared.customer_crown_state.current_tier_id IS DISTINCT FROM EXCLUDED.current_tier_id
            THEN now() ELSE shared.customer_crown_state.last_tier_promotion_at END,
        tier_entered_at      = CASE
          WHEN shared.customer_crown_state.current_tier_id IS DISTINCT FROM EXCLUDED.current_tier_id
            THEN now() ELSE shared.customer_crown_state.tier_entered_at END,
        updated_at           = now();

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_crown_state_recompute
  AFTER INSERT OR UPDATE OR DELETE ON shared.crown_ledger
  FOR EACH ROW EXECUTE FUNCTION shared.fn_crown_state_recompute();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CROWN STREAK CONFIG — per-brand streak definitions (the upgrade)   ║
-- ╚════════════════════════════════════════════════════════════════════╝
CREATE TABLE shared.crown_streak_config (
  config_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  streak_type           TEXT        NOT NULL
                        CHECK (streak_type IN ('purchase_monthly','engagement_weekly')),
  display_name          TEXT        NOT NULL,
  description           TEXT,
  -- Cadence: one qualifying action per period keeps the streak alive.
  period_unit           TEXT        NOT NULL CHECK (period_unit IN ('day','week','month')),
  period_length         SMALLINT    NOT NULL DEFAULT 1 CHECK (period_length > 0),
  grace_days            SMALLINT    NOT NULL DEFAULT 0,        -- slack after period end before it breaks
  qualifying_action     TEXT        NOT NULL CHECK (qualifying_action IN ('purchase','check_in')),
  -- Freezes: a grace token so one missed period does not reset the streak.
  freeze_allowance      SMALLINT    NOT NULL DEFAULT 1,
  -- Nudge N days before the deadline (email + in-app).
  nudge_lead_days       SMALLINT    NOT NULL DEFAULT 2,
  -- Crown rewards (OFF as seeded — owner chose no minting; flip on any time).
  awards_crowns_on_extend INTEGER   NOT NULL DEFAULT 0,        -- 👑 per maintained period (0 = off)
  milestone_bonuses     JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{"length":3,"crowns":50}]
  earn_multiplier_curve JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{"min_length":3,"multiplier":1.25}]
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, streak_type)
);
CREATE TRIGGER trg_crown_streak_config_updated_at
  BEFORE UPDATE ON shared.crown_streak_config
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CROWN STREAKS — per-customer streak state                          ║
-- ╚════════════════════════════════════════════════════════════════════╝
CREATE TABLE shared.crown_streaks (
  streak_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            UUID        NOT NULL REFERENCES shared.contacts (contact_id) ON DELETE CASCADE,
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  streak_type           TEXT        NOT NULL
                        CHECK (streak_type IN ('purchase_monthly','engagement_weekly')),
  current_length        INTEGER     NOT NULL DEFAULT 0,
  longest_length        INTEGER     NOT NULL DEFAULT 0,
  status                TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','at_risk','frozen','broken')),
  period_anchor_at      TIMESTAMPTZ,                            -- start of the current period
  last_qualified_at     TIMESTAMPTZ,                            -- last qualifying action
  current_period_qualified BOOLEAN  NOT NULL DEFAULT false,
  deadline_at           TIMESTAMPTZ,                            -- breaks if no action by here
  freezes_available     SMALLINT    NOT NULL DEFAULT 0,
  freezes_used          SMALLINT    NOT NULL DEFAULT 0,
  last_nudge_at         TIMESTAMPTZ,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  broken_at             TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, business, streak_type)
);
CREATE TRIGGER trg_crown_streaks_updated_at
  BEFORE UPDATE ON shared.crown_streaks
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
-- Scanner index: find streaks due for a nudge or a break.
CREATE INDEX idx_crown_streaks_deadline
  ON shared.crown_streaks (business, streak_type, deadline_at)
  WHERE status IN ('active','at_risk','frozen');
CREATE INDEX idx_crown_streaks_contact
  ON shared.crown_streaks (contact_id, business);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CROWN REWARD GRANTS — one-time vouchers minted on tier promotion   ║
-- ║ (The standing lifetime discount is a property of the tier itself,  ║
-- ║  applied at checkout — it is NOT a grant.)                         ║
-- ╚════════════════════════════════════════════════════════════════════╝
CREATE TABLE shared.crown_reward_grants (
  grant_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            UUID        NOT NULL REFERENCES shared.contacts (contact_id) ON DELETE CASCADE,
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  source_type           TEXT        NOT NULL DEFAULT 'tier_promotion'
                        CHECK (source_type IN ('tier_promotion','manual','streak')),
  tier_id               UUID        REFERENCES shared.crown_tiers (tier_id) ON DELETE SET NULL,
  grant_type            TEXT        NOT NULL
                        CHECK (grant_type IN ('next_purchase_discount','free_shipping_next')),
  discount_pct          NUMERIC(5,2),                           -- for next_purchase_discount
  status                TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','redeemed','expired','revoked')),
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ,
  redeemed_order_id     UUID,                                   -- soft FK to {brand}.sales_orders
  redeemed_at           TIMESTAMPTZ,
  notes                 TEXT
);
CREATE INDEX idx_crown_reward_grants_active
  ON shared.crown_reward_grants (contact_id, business, status);
CREATE INDEX idx_crown_reward_grants_business
  ON shared.crown_reward_grants (business, grant_type, status);
-- One promotion voucher of a kind per tier per customer (idempotent promotion).
CREATE UNIQUE INDEX idx_crown_reward_grants_tier_once
  ON shared.crown_reward_grants (contact_id, business, tier_id, grant_type)
  WHERE source_type = 'tier_promotion';

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CROWN ACTION SUBMISSIONS — verification queue                      ║
-- ║ honor  → auto_approved on submit (capped)                          ║
-- ║ manual → pending until a staffer approves (IG tag link, UGC photo) ║
-- ╚════════════════════════════════════════════════════════════════════╝
CREATE TABLE shared.crown_action_submissions (
  submission_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            UUID        NOT NULL REFERENCES shared.contacts (contact_id) ON DELETE CASCADE,
  business              TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  earn_rule_id          UUID        REFERENCES shared.crown_earn_rules (rule_id) ON DELETE SET NULL,
  action_type           TEXT        NOT NULL,
  verification_mode     TEXT        NOT NULL CHECK (verification_mode IN ('honor','manual')),
  -- Proof captured from the customer.
  social_platform       TEXT,
  social_handle         TEXT,
  proof_url             TEXT,                                   -- e.g. the Instagram tag post link
  media_asset_id        UUID,                                   -- soft FK to shared.media_assets (UGC)
  note                  TEXT,
  -- Review lifecycle.
  status                TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','auto_approved')),
  reviewed_by           UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  reviewed_at           TIMESTAMPTZ,
  review_note           TEXT,
  -- Award linkage (set once approved).
  crowns_awarded        INTEGER,
  ledger_id             UUID        REFERENCES shared.crown_ledger (ledger_id) ON DELETE SET NULL,
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_crown_submissions_queue
  ON shared.crown_action_submissions (business, status, submitted_at)
  WHERE status = 'pending';
CREATE INDEX idx_crown_submissions_contact
  ON shared.crown_action_submissions (contact_id, business, submitted_at DESC);

-- ============================================================
-- SEEDS — applied to every active brand (Pixie Girl + Faitlynhair).
-- Wallets stay separate; only the config/copy is shared. Our clients are
-- "Pixie Queens" in BOTH brands, so the copy says so.
-- ============================================================
DO $seed$
DECLARE
  b TEXT;
BEGIN
  FOR b IN SELECT business_key FROM shared.business_config WHERE is_active = true LOOP

    -- ── Tier ladder ─────────────────────────────────────────
    -- Below 1,000👑 = unranked member (no perks). Tiers 1-3 give a one-time
    -- "% off next purchase" voucher on promotion; Imperial adds 5% lifetime.
    INSERT INTO shared.crown_tiers
      (business, tier_key, tier_name, description, min_crowns, display_order,
       next_purchase_discount_pct, grants_free_shipping_next, lifetime_discount_pct,
       earning_multiplier, benefits, badge_colour_hex)
    VALUES
      (b, 'tiara',    'The Tiara',
       'Your first crown. 5% off your next purchase, early access to drops, and members-only styles.',
       1000, 1, 5.00,  false, 0.00, 1.00,
       '{"early_access":true,"exclusive_products":true}'::jsonb, '#E8C4C4'),
      (b, 'coronet',  'The Coronet',
       '10% off your next purchase, plus birthday bonus Crowns each year.',
       2500, 2, 10.00, false, 0.00, 1.00,
       '{"early_access":true,"exclusive_products":true,"birthday_bonus":true}'::jsonb, '#D9A7A7'),
      (b, 'diadem',   'The Diadem',
       '15% off your next purchase with free shipping, priority support, and VIP-only sales.',
       5000, 3, 15.00, true,  0.00, 1.00,
       '{"early_access":true,"exclusive_products":true,"birthday_bonus":true,"free_shipping_next":true,"priority_support":true,"vip_sales":true}'::jsonb, '#B96A6A'),
      (b, 'imperial', 'The Imperial',
       'Our highest honour: 20% off your next purchase (free shipping) and a standing 5% lifetime discount forever.',
       10000, 4, 20.00, true, 5.00, 1.00,
       '{"early_access":true,"exclusive_products":true,"birthday_bonus":true,"free_shipping_next":true,"priority_support":true,"vip_sales":true,"extra_streak_freeze":true}'::jsonb, '#690909');

    -- ── Earn rules (chronological display order; account first) ──
    INSERT INTO shared.crown_earn_rules
      (business, rule_key, display_name, description, action_type,
       crowns_mode, crown_value, unit_currency_per_crown, verification_mode,
       social_platform, min_order_value,
       max_awards_per_customer_lifetime, max_awards_per_customer_per_month,
       display_order)
    VALUES
      (b, 'create_account',      'Create an account',
       'Join free as a Pixie Queen and start earning Crowns.',
       'create_account',       'flat', 10,  NULL, 'auto', NULL, NULL, 1,    NULL, 10),
      (b, 'complete_purchase',   'Complete a purchase',
       'Earn 500👑 every time you complete a purchase.',
       'complete_purchase',    'flat', 500, NULL, 'auto', NULL, NULL, NULL, NULL, 20),
      (b, 'money_spent',         'Money spent',
       'Earn 1👑 for every ₦1,000 you spend.',
       'money_spent',          'per_currency', NULL, 1000, 'auto', NULL, NULL, NULL, NULL, 30),
      (b, 'refer_friend',        'Refer a friend who buys',
       'Earn 50👑 when a friend you referred makes their first purchase.',
       'refer_friend_purchase','flat', 50,  NULL, 'auto', NULL, NULL, NULL, NULL, 40),
      (b, 'newsletter_subscribe','Subscribe to newsletter',
       'Earn 50👑 when you opt in to our newsletter.',
       'newsletter_subscribe', 'flat', 50,  NULL, 'auto', NULL, NULL, 1,    NULL, 50),
      (b, 'add_birthday',        'Tell us your birthday',
       'Earn 20👑 when you add your birthday to your profile.',
       'add_birthday',         'flat', 20,  NULL, 'auto', NULL, NULL, 1,    NULL, 60),
      (b, 'leave_review',        'Leave a verified review',
       'Earn 50👑 for each verified-purchase review you leave.',
       'leave_review',         'flat', 50,  NULL, 'auto', NULL, NULL, NULL, NULL, 70),
      (b, 'follow_instagram',    'Follow on Instagram',
       'Earn 20👑 for following us on Instagram.',
       'social_follow',        'flat', 20,  NULL, 'honor', 'instagram', NULL, 1, NULL, 80),
      (b, 'follow_tiktok',       'Follow on TikTok',
       'Earn 20👑 for following us on TikTok.',
       'social_follow',        'flat', 20,  NULL, 'honor', 'tiktok',    NULL, 1, NULL, 90),
      (b, 'tag_us_instagram',    'Tag us on Instagram',
       'Tag us on Instagram and paste the link — earn 30👑 once approved.',
       'social_tag',           'flat', 30,  NULL, 'manual', 'instagram', NULL, NULL, 1, 100),
      (b, 'upload_your_pixie',   'Upload how you rocked the Pixie',
       'Upload a photo of your look — earn 100👑 once approved.',
       'ugc_upload',           'flat', 100, NULL, 'manual', NULL, NULL, NULL, 1, 110),
      (b, 'subscribe_youtube',   'Subscribe on YouTube',
       'Earn 20👑 for subscribing to our YouTube channel.',
       'social_follow',        'flat', 20,  NULL, 'honor', 'youtube',   NULL, 1, NULL, 120);

    -- ── Streak configs (two run in parallel; no Crown minting as seeded) ──
    INSERT INTO shared.crown_streak_config
      (business, streak_type, display_name, description, period_unit, period_length,
       grace_days, qualifying_action, freeze_allowance, nudge_lead_days,
       awards_crowns_on_extend, milestone_bonuses, earn_multiplier_curve)
    VALUES
      (b, 'purchase_monthly', 'Monthly Purchase Streak',
       'Order at least once each month to keep your streak alive.',
       'month', 1, 5, 'purchase', 1, 2, 0, '[]'::jsonb, '[]'::jsonb),
      (b, 'engagement_weekly', 'Weekly Check-in Streak',
       'Check in each week to keep your streak alive.',
       'week', 1, 1, 'check_in', 1, 2, 0, '[]'::jsonb, '[]'::jsonb);

  END LOOP;
END
$seed$;

-- ============================================================
-- BACKFILL (9A "convert & merge") — fold both legacy economies into Crowns
-- at 1:1. Only positive earns carry over (Crowns are status-only, so legacy
-- redemptions/expiries don't apply). Idempotent via reference tag + NOT EXISTS.
-- The recompute trigger materialises each customer's balance + tier as it goes.
-- ============================================================
DO $backfill$
DECLARE
  b TEXT;
BEGIN
  -- Legacy loyalty points (shared, business-scoped) → Crowns.
  IF to_regclass('shared.loyalty_ledger') IS NOT NULL THEN
    INSERT INTO shared.crown_ledger
      (contact_id, business, transaction_type, crowns, earn_action_type,
       reference_type, reference_id, description, occurred_at)
    SELECT ll.contact_id, ll.business, 'earn', ll.points, ll.transaction_type,
           'loyalty_backfill', ll.ledger_id,
           'Migrated from loyalty points (1:1)', ll.created_at
      FROM shared.loyalty_ledger ll
     WHERE ll.points > 0
       AND ll.transaction_type LIKE 'earned_%'
       AND ll.business IN (SELECT business_key FROM shared.business_config WHERE is_active = true)
       AND NOT EXISTS (
             SELECT 1 FROM shared.crown_ledger cl
              WHERE cl.reference_type = 'loyalty_backfill'
                AND cl.reference_id = ll.ledger_id);
  END IF;

  -- Legacy Streak Stars (per-brand schema) → Crowns.
  FOR b IN SELECT business_key FROM shared.business_config WHERE is_active = true LOOP
    IF to_regclass(format('%I.streak_star_ledger', b)) IS NOT NULL THEN
      EXECUTE format($q$
        INSERT INTO shared.crown_ledger
          (contact_id, business, transaction_type, crowns, earn_action_type,
           reference_type, reference_id, description, occurred_at)
        SELECT sl.contact_id, %L, 'earn', sl.stars, sl.earn_action_type,
               'streak_backfill', sl.entry_id,
               'Migrated from Streak Stars (1:1)', sl.occurred_at
          FROM %I.streak_star_ledger sl
         WHERE sl.stars > 0
           AND NOT EXISTS (
                 SELECT 1 FROM shared.crown_ledger cl
                  WHERE cl.reference_type = 'streak_backfill'
                    AND cl.reference_id = sl.entry_id)
      $q$, b, b);
    END IF;
  END LOOP;
END
$backfill$;

-- ============================================================
-- After 000362: +8 shared tables
--   crown_tiers, crown_earn_rules, crown_ledger, customer_crown_state,
--   crown_streak_config, crown_streaks, crown_reward_grants,
--   crown_action_submissions
-- ============================================================
