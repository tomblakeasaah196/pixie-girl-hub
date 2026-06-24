-- ============================================================
-- MIGRATION 000236 — payslip bank snapshot for disbursement
-- Pixie Girl Hub · JBS Praxis · HR final wiring
--
-- Salary disbursement (disbursement.service / nomba.disburseSalary) needs the
-- destination account number AND bank (NIP/sort) code per payslip. The payslip
-- template (000027) carries bank_account_snapshot, but no bank code column, and
-- neither was being populated. This adds bank_sort_code_snapshot to every
-- brand's payslips table (the template carries it too, so new brands inherit
-- it). The payroll calculate step now snapshots both from the staff profile.
--
-- Applies to every existing brand schema (loop). Idempotent.
-- ============================================================

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
      'ALTER TABLE %I.payslips ADD COLUMN IF NOT EXISTS bank_sort_code_snapshot TEXT',
      r.s
    );
  END LOOP;
END $$;
