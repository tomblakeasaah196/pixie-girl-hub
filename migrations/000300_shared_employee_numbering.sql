-- ============================================================
-- MIGRATION 000300 — system-generated, chronological employee numbers
-- Pixie Girl Hub · JBS Praxis · HR onboarding
--
-- Employee numbers were previously typed in by hand on the onboarding form.
-- They are now allocated server-side (see hr.service.js createStaff) via the
-- shared numbering.service.js, the same "PREFIX-TYPE-0001" sequence used for
-- invoices/payslips/etc. Already-provisioned brands never got a
-- 'employee' row seeded (only newly bootstrapped ones will, via
-- template/000035), so backfill it here.
--
-- next_number starts past the highest sequence number already embedded in
-- any existing "<prefix>-EMP-NNNN" employee_number, so a brand that somehow
-- already has employee numbers in this exact shape never collides with a
-- freshly allocated one. Idempotent: ON CONFLICT DO NOTHING.
-- ============================================================

DO $$
DECLARE
  r RECORD;
  v_start INTEGER;
BEGIN
  FOR r IN SELECT business_key, document_prefix FROM shared.business_config
  LOOP
    SELECT COALESCE(MAX((regexp_match(employee_number, '^' || r.document_prefix || '-EMP-(\d+)$'))[1]::INTEGER), 0) + 1
      INTO v_start
      FROM shared.staff_profiles
     WHERE business = r.business_key
       AND employee_number ~ ('^' || r.document_prefix || '-EMP-\d+$');

    INSERT INTO shared.document_numbering (business, document_type, prefix, padding, next_number)
    VALUES (r.business_key, 'employee', r.document_prefix || '-EMP', 4, v_start)
    ON CONFLICT (business, document_type) DO NOTHING;
  END LOOP;
END $$;
