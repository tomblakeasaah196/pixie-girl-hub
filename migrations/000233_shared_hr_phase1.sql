-- ============================================================
-- MIGRATION 000233 — HR system Phase 1 (foundation & self-service)
-- Pixie Girl Hub · JBS Praxis · V2.2 HR build
--
-- Implements the HR design captured in the June 2026 meeting
-- (docs/PixieGirl_Hub_Meeting_Notes_Transcript.docx §3) that the
-- existing Pass-1/Pass-2 HR tables did not cover:
--
--   shared.hr_settings          — per-brand HR config: lateness deduction
--                                 tiers, grace, working days, earnings
--                                 tracker toggle, CEO payout PIN (hashed),
--                                 payout provider, onboarding checklist.
--   shared.attendance_days      — one reconciled row per staff per day
--                                 (present/late/absent/leave) with the
--                                 lateness minutes + deduction it produced.
--   shared.hr_queries           — formal queries raised against a staff
--                                 member. Every lateness auto-generates one
--                                 (meeting §3, answer #3): respond → HR can
--                                 waive (salary restored) or uphold (deducts
--                                 from net pay); ignored → reminder after N
--                                 days while the deduction shows on the slip.
--   shared.staff_earnings_daily — daily snapshot of the real-time earnings
--                                 tracker (answer #1 = live calc + history
--                                 snapshot) for audit / reconciliation.
--   shared.performance_targets  — monthly per-staff target + live countdown
--                                 ("20 styles away from your bonus"; meeting
--                                 §3.3, answer #4). Progress is auto-sourced
--                                 from Sales (sales reps) and the future
--                                 Operations module (stylists; answer #5/#6).
--
--   staff_profiles.additional_businesses — cross-brand staff (answer #12):
--                                 a profile's `business` is the primary brand
--                                 that owns its payroll/books; staff who work
--                                 for both brands (systems engineer, CEO PA,
--                                 etc.) list the extra brand keys here for
--                                 visibility/access. Payroll always runs on
--                                 the primary `business`.
--
-- All objects are additive and idempotent (IF NOT EXISTS / DROP TRIGGER
-- IF EXISTS), so re-running this — or the schema-repair pass — is a no-op.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ CROSS-BRAND STAFF                                                   ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.staff_profiles
  ADD COLUMN IF NOT EXISTS additional_businesses TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN shared.staff_profiles.additional_businesses IS
  'Extra brand keys this employee also works for. `business` remains the '
  'primary brand that owns payroll/books; these grant cross-brand HR '
  'visibility/access (answer #12). Payroll always runs on `business`.';

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ HR SETTINGS (per brand)                                             ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS shared.hr_settings (
  business                    TEXT        PRIMARY KEY
                              REFERENCES shared.business_config (business_key) ON DELETE CASCADE,

  -- ── Lateness & deductions (meeting §3.1 / answer #2, #3) ──
  -- Tiers are ordered, "first match from the top after N minutes late".
  -- Default mirrors the meeting: 1h=10%, 2h=20%, 3h=30%.
  lateness_enabled            BOOLEAN     NOT NULL DEFAULT true,
  lateness_tiers              JSONB       NOT NULL DEFAULT
    '[{"after_minutes":60,"deduction_pct":10},
      {"after_minutes":120,"deduction_pct":20},
      {"after_minutes":180,"deduction_pct":30}]'::jsonb,
  -- Every lateness auto-raises a query the employee must answer (answer #3).
  lateness_auto_query         BOOLEAN     NOT NULL DEFAULT true,
  -- If the query is ignored, remind after this many days; the deduction keeps
  -- showing on the running salary until waived.
  lateness_query_reminder_days SMALLINT   NOT NULL DEFAULT 2,
  default_grace_minutes       SMALLINT    NOT NULL DEFAULT 0,
  default_expected_start_time TEXT,                                 -- 'HH:MM'
  -- Days that count as working days when pro-rating salary & expecting clock-in.
  working_days                TEXT[]      NOT NULL DEFAULT '{mon,tue,wed,thu,fri}',

  -- ── Real-time earnings tracker (meeting §3.1 / answer #1) ──
  earnings_tracker_enabled    BOOLEAN     NOT NULL DEFAULT true,

  -- ── CEO payout authorisation (meeting §3.4 / answer #8) ──
  -- A dedicated payout PIN (hashed), set from the HR Settings tab, required
  -- at the "Pay" step on top of the workflow approval. Separate from the
  -- login PIN on shared.users.
  payout_pin_hash             TEXT,
  payout_pin_set_at           TIMESTAMPTZ,
  payout_require_pin          BOOLEAN     NOT NULL DEFAULT true,
  -- Disbursement provider (answer #7 = Nomba confirmed).
  payout_provider             TEXT        NOT NULL DEFAULT 'nomba'
                              CHECK (payout_provider IN ('nomba','flutterwave','manual')),

  -- ── Onboarding (meeting §3.7 / answer #9) ──
  -- Default checklist applied to every new hire's onboarding wizard, e.g.
  -- [{"key":"contract","label":"Sign contract"},{"key":"sop","label":"Read SOPs"}]
  onboarding_checklist        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Optional default contract template document used by contract generation.
  contract_template_doc_id    UUID        REFERENCES shared.documents (document_id) ON DELETE SET NULL,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_hr_settings_updated_at ON shared.hr_settings;
CREATE TRIGGER trg_hr_settings_updated_at
  BEFORE UPDATE ON shared.hr_settings
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- Seed a default settings row for every existing brand (defaults fill the rest).
INSERT INTO shared.hr_settings (business)
  SELECT business_key FROM shared.business_config
  ON CONFLICT (business) DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ ATTENDANCE DAYS (reconciled, one row per staff per day)            ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- staff_clock_events is the append-only raw truth; this is the reconciled
-- daily ledger the dashboards and payroll read. Built by the reconcile job
-- (HrHub "Reconcile today" / nightly cron).

CREATE TABLE IF NOT EXISTS shared.attendance_days (
  day_id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL
                        REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  profile_id            UUID        NOT NULL
                        REFERENCES shared.staff_profiles (profile_id) ON DELETE CASCADE,
  work_date             DATE        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'absent'
                        CHECK (status IN ('present','late','absent','on_leave',
                                          'off','remote','holiday','weekend')),
  expected_start_time   TEXT,                                       -- 'HH:MM' snapshot
  first_clock_in_at     TIMESTAMPTZ,
  minutes_late          INTEGER     NOT NULL DEFAULT 0,
  is_late               BOOLEAN     NOT NULL DEFAULT false,
  -- Money at stake from this day's lateness (computed from the daily rate).
  daily_rate_ngn        NUMERIC(14,2) NOT NULL DEFAULT 0,
  deduction_pct         NUMERIC(5,2)  NOT NULL DEFAULT 0,
  deduction_ngn         NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Waiver state — when the linked query is waived, justified=true and the
  -- deduction is zeroed back out of the running salary (answer #3).
  justified             BOOLEAN     NOT NULL DEFAULT false,
  -- Links
  query_id              UUID,                                       -- FK wired below
  leave_id              UUID        REFERENCES shared.leave_requests (leave_id) ON DELETE SET NULL,
  clock_event_id        UUID        REFERENCES shared.staff_clock_events (event_id) ON DELETE SET NULL,
  -- Audit
  reconciled_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciled_by         UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, work_date)
);

DROP TRIGGER IF EXISTS trg_attendance_days_updated_at ON shared.attendance_days;
CREATE TRIGGER trg_attendance_days_updated_at
  BEFORE UPDATE ON shared.attendance_days
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_attendance_days_profile
  ON shared.attendance_days (profile_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_days_business_date
  ON shared.attendance_days (business, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_days_unjustified_late
  ON shared.attendance_days (profile_id, work_date)
  WHERE is_late = true AND justified = false;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ HR QUERIES                                                          ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS shared.hr_queries (
  query_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL
                        REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  profile_id            UUID        NOT NULL
                        REFERENCES shared.staff_profiles (profile_id) ON DELETE CASCADE,
  query_type            TEXT        NOT NULL DEFAULT 'other'
                        CHECK (query_type IN ('lateness','absence','offsite_clockin',
                                              'conduct','performance','other')),
  severity              TEXT        NOT NULL DEFAULT 'normal'
                        CHECK (severity IN ('low','normal','high')),
  subject               TEXT        NOT NULL,
  details               TEXT,
  -- 'auto' = system-raised by the lateness reconciler; 'manual' = HR raised it.
  source                TEXT        NOT NULL DEFAULT 'manual'
                        CHECK (source IN ('auto','manual')),
  status                TEXT        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','responded','waived','upheld','closed')),
  -- Link to the lateness day that triggered it + the money at stake.
  attendance_day_id     UUID        REFERENCES shared.attendance_days (day_id) ON DELETE SET NULL,
  deduction_pct         NUMERIC(5,2),
  deduction_ngn         NUMERIC(14,2),
  -- Employee side
  employee_response     TEXT,
  responded_at          TIMESTAMPTZ,
  -- HR resolution
  resolution            TEXT        CHECK (resolution IN ('waived','upheld',NULL)),
  resolution_note       TEXT,
  resolved_by           UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  resolved_at           TIMESTAMPTZ,
  -- Reminder cadence for ignored queries (answer #3)
  remind_after          DATE,
  reminder_count        SMALLINT    NOT NULL DEFAULT 0,
  last_reminded_at      TIMESTAMPTZ,
  -- Audit
  raised_by             UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_hr_queries_updated_at ON shared.hr_queries;
CREATE TRIGGER trg_hr_queries_updated_at
  BEFORE UPDATE ON shared.hr_queries
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_hr_queries_profile
  ON shared.hr_queries (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_queries_business_status
  ON shared.hr_queries (business, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_queries_open_reminder
  ON shared.hr_queries (remind_after)
  WHERE status = 'open';

-- One auto lateness query per attendance day (manual queries are unconstrained).
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_queries_auto_day
  ON shared.hr_queries (attendance_day_id)
  WHERE source = 'auto' AND attendance_day_id IS NOT NULL;

-- Wire the deferred attendance_days → hr_queries FK now both tables exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_attendance_days_query'
  ) THEN
    ALTER TABLE shared.attendance_days
      ADD CONSTRAINT fk_attendance_days_query
      FOREIGN KEY (query_id) REFERENCES shared.hr_queries (query_id) ON DELETE SET NULL;
  END IF;
END $$;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ DAILY EARNINGS SNAPSHOT                                             ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- The dashboard computes "today" live; this persists the per-day figure so
-- month-to-date history is auditable and survives salary changes mid-month.

CREATE TABLE IF NOT EXISTS shared.staff_earnings_daily (
  earning_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL
                        REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  profile_id            UUID        NOT NULL
                        REFERENCES shared.staff_profiles (profile_id) ON DELETE CASCADE,
  work_date             DATE        NOT NULL,
  -- Snapshot of the salary basis on this day.
  base_salary_ngn       NUMERIC(14,2) NOT NULL DEFAULT 0,
  daily_rate_ngn        NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- What was actually earned this day after lateness deduction.
  earned_ngn            NUMERIC(14,2) NOT NULL DEFAULT 0,
  deduction_ngn         NUMERIC(14,2) NOT NULL DEFAULT 0,
  worked                BOOLEAN     NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, work_date)
);

DROP TRIGGER IF EXISTS trg_staff_earnings_daily_updated_at ON shared.staff_earnings_daily;
CREATE TRIGGER trg_staff_earnings_daily_updated_at
  BEFORE UPDATE ON shared.staff_earnings_daily
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_staff_earnings_daily_profile
  ON shared.staff_earnings_daily (profile_id, work_date DESC);

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ MONTHLY PERFORMANCE TARGETS (live countdown)                        ║
-- ╚════════════════════════════════════════════════════════════════════╝
-- Distinct from the quarterly weighted-KPI appraisal (template 000027):
-- this is the meeting's monthly motivational target ("100 styles → 20%
-- bonus", live "20 away" countdown). Progress is auto-counted from the
-- source module; reward links to a per-brand bonus rule when one applies.

CREATE TABLE IF NOT EXISTS shared.performance_targets (
  target_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business              TEXT        NOT NULL
                        REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  profile_id            UUID        NOT NULL
                        REFERENCES shared.staff_profiles (profile_id) ON DELETE CASCADE,
  user_id               UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  period_month          SMALLINT    NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year           SMALLINT    NOT NULL,
  -- What is being counted.
  metric                TEXT        NOT NULL DEFAULT 'custom'
                        CHECK (metric IN ('styles_completed','services_completed',
                                          'sales_count','sales_revenue','custom')),
  metric_label          TEXT        NOT NULL,
  target_value          NUMERIC(14,2) NOT NULL CHECK (target_value > 0),
  current_value         NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Where progress is counted from (answer #5/#6). 'operations' is wired by the
  -- future Operations module; 'sales' by the Sales module; 'manual' by HR.
  source                TEXT        NOT NULL DEFAULT 'manual'
                        CHECK (source IN ('operations','sales','manual')),
  -- Reward on achievement.
  reward_type           TEXT        NOT NULL DEFAULT 'pct_salary'
                        CHECK (reward_type IN ('pct_salary','fixed_ngn','none')),
  reward_value          NUMERIC(14,2) NOT NULL DEFAULT 0,
  reward_note           TEXT,
  -- Optional link to a per-brand bonus rule ({brand}.bonus_rules.bonus_rule_id).
  -- No cross-schema FK: validated in the service layer.
  bonus_rule_id         UUID,
  status                TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','achieved','missed','closed')),
  achieved_at           TIMESTAMPTZ,
  last_progress_at      TIMESTAMPTZ,
  set_by                UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, period_year, period_month, metric)
);

DROP TRIGGER IF EXISTS trg_performance_targets_updated_at ON shared.performance_targets;
CREATE TRIGGER trg_performance_targets_updated_at
  BEFORE UPDATE ON shared.performance_targets
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_performance_targets_profile
  ON shared.performance_targets (profile_id, period_year DESC, period_month DESC);
CREATE INDEX IF NOT EXISTS idx_performance_targets_active
  ON shared.performance_targets (business, period_year, period_month)
  WHERE status = 'active';
