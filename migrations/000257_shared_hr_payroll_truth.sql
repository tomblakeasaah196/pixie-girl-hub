-- ============================================================
-- MIGRATION 000257 — HR payroll truth (meeting §3.4/§3.5 + audit C1–C4, H3)
--
-- 1. hr_settings gains the payroll-behaviour switches:
--      statutory_deductions_enabled — master PAYE/pension/NHF/NSITF switch.
--        DEFAULT FALSE: both brands currently pay simple salaries (decision
--        2026-07-04); flipping it on re-applies the seeded statutory configs.
--      advance_recovery_cap_pct     — max % of a month's net pay one payroll
--        run may recover against outstanding cash advances (default 50).
--      default_expected_end_time    — brand closing time (default 18:00) so
--        reconcile can compute early departures / last-out (§6.11).
-- 2. staff_profiles gains per-employee overrides:
--      statutory_exempt        — this employee stays deduction-free even when
--                                the brand statutory switch is on.
--      work_expected_end_time  — personal closing time (like start time).
-- 3. attendance_days gains the clock-out side of the day:
--      last_clock_out_at, early_leave_minutes.
-- 4. Brand payslips gain the attendance money columns + the
--    'attendance_deduction' line type (template 000027 carries the same for
--    fresh provisioning). Idempotent throughout.
-- ============================================================

-- ── 1. hr_settings ──────────────────────────────────────────
ALTER TABLE shared.hr_settings
  ADD COLUMN IF NOT EXISTS statutory_deductions_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS advance_recovery_cap_pct     NUMERIC(5,2) NOT NULL DEFAULT 50
                           CHECK (advance_recovery_cap_pct >= 0 AND advance_recovery_cap_pct <= 100),
  ADD COLUMN IF NOT EXISTS default_expected_end_time    TIME NOT NULL DEFAULT '18:00';

-- ── 2. staff_profiles ───────────────────────────────────────
ALTER TABLE shared.staff_profiles
  ADD COLUMN IF NOT EXISTS statutory_exempt        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS work_expected_end_time  TIME;

-- ── 3. attendance_days ──────────────────────────────────────
ALTER TABLE shared.attendance_days
  ADD COLUMN IF NOT EXISTS last_clock_out_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS early_leave_minutes INTEGER NOT NULL DEFAULT 0;

-- ── 4. brand payslips + payslip_lines ───────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_schema AS s
      FROM information_schema.tables
     WHERE table_name = 'payslips'
       AND table_schema NOT IN ('template')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.payslips
         ADD COLUMN IF NOT EXISTS attendance_deduction_ngn NUMERIC(14,2) NOT NULL DEFAULT 0,
         ADD COLUMN IF NOT EXISTS days_worked              SMALLINT,
         ADD COLUMN IF NOT EXISTS working_days_in_period   SMALLINT,
         ADD COLUMN IF NOT EXISTS prorate_factor           NUMERIC(6,4) NOT NULL DEFAULT 1',
      r.s
    );
  END LOOP;

  FOR r IN
    SELECT c.table_schema AS s, tc.constraint_name AS cname
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage c
        ON c.constraint_name = tc.constraint_name
       AND c.table_schema = tc.table_schema
     WHERE tc.table_name = 'payslip_lines'
       AND tc.constraint_type = 'CHECK'
       AND c.column_name = 'line_type'
       AND tc.table_schema NOT IN ('template')
  LOOP
    EXECUTE format('ALTER TABLE %I.payslip_lines DROP CONSTRAINT %I', r.s, r.cname);
    EXECUTE format(
      $q$ALTER TABLE %I.payslip_lines
           ADD CONSTRAINT %I CHECK (line_type IN (
             'base_salary','housing_allowance','transport_allowance',
             'commission','bonus','overtime','reimbursement','other_earning',
             'paye','pension_employee','pension_employer','nhf','nsitf',
             'attendance_deduction','loan_repayment','advance_recovery',
             'other_deduction'))$q$,
      r.s, r.cname
    );
  END LOOP;
END $$;
