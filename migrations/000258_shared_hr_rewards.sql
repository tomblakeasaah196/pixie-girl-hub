-- ============================================================
-- MIGRATION 000258 — HR rewards engine (meeting §3 "reward system")
--
-- Configurable, behaviour-based rewards the boss described: bonuses for the
-- employee who is first at work, last to leave, always punctual, or who enters
-- data promptly — plus period bonuses and salary increases. Rules are set by
-- HR; a nightly evaluator computes each employee's standing and grants a
-- reward when the threshold is met (idempotent, once per period).
--
-- Monetary rewards (fixed ₦ / % of salary) flow through the existing
-- bonuses_awarded → approve → payroll pipeline (the grant links the bonus).
-- Salary-increase rewards are recorded as PENDING grants that HR applies
-- explicitly (updating base salary + writing a contract amendment) — never a
-- silent salary change.
--
-- Shared tables with a `business` column, matching the HR phase-1 pattern
-- (hr_settings / attendance_days / performance_targets). Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.reward_rules (
  reward_rule_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business        TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  description     TEXT,
  -- What is measured over the period.
  metric          TEXT        NOT NULL CHECK (metric IN (
                    'first_in_days',    -- days this person was first to clock in
                    'last_out_days',    -- days this person was last to clock out
                    'punctual_days',    -- present, on-time working days
                    'data_entries',     -- create/update actions logged in the period
                    'styles_completed', -- completed service jobs
                    'sales_count',      -- paid orders attributed to them
                    'quality_avg')),    -- average QC rating on their jobs (1–5)
  comparator      TEXT        NOT NULL DEFAULT 'gte' CHECK (comparator IN ('gte','lte')),
  threshold       NUMERIC(12,2) NOT NULL,
  period_type     TEXT        NOT NULL DEFAULT 'month' CHECK (period_type IN ('month')),
  reward_type     TEXT        NOT NULL CHECK (reward_type IN ('fixed_ngn','pct_salary','salary_increase_pct')),
  reward_value    NUMERIC(12,2) NOT NULL CHECK (reward_value >= 0),
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_by      UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reward_rules_business
  ON shared.reward_rules (business, is_active);

CREATE TABLE IF NOT EXISTS shared.reward_grants (
  reward_grant_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business        TEXT        NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  reward_rule_id  UUID        NOT NULL REFERENCES shared.reward_rules (reward_rule_id) ON DELETE CASCADE,
  profile_id      UUID        NOT NULL REFERENCES shared.staff_profiles (profile_id) ON DELETE CASCADE,
  user_id         UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  period_year     INT         NOT NULL,
  period_month    INT         NOT NULL,
  metric          TEXT        NOT NULL,
  metric_value    NUMERIC(12,2) NOT NULL,
  reward_type     TEXT        NOT NULL,
  reward_value    NUMERIC(12,2) NOT NULL,
  amount_ngn      NUMERIC(14,2),                       -- resolved value for fixed/pct rewards
  proposed_salary_ngn NUMERIC(14,2),                   -- for salary_increase rewards
  bonus_id        UUID,                                -- soft link to {brand}.bonuses_awarded (monetary)
  -- awarded  : monetary reward — a pending-approval bonus was created
  -- pending  : salary increase awaiting HR to apply
  -- applied  : salary increase applied (base salary changed + amendment)
  -- rejected : HR declined
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('awarded','pending','applied','rejected')),
  decided_by      UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reward_rule_id, profile_id, period_year, period_month)
);
CREATE INDEX IF NOT EXISTS idx_reward_grants_business_period
  ON shared.reward_grants (business, period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_reward_grants_profile
  ON shared.reward_grants (profile_id, period_year, period_month);
