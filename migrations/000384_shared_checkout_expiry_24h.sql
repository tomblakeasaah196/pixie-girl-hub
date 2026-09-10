-- ============================================================
-- MIGRATION 000384 — harmonise abandoned-checkout windows
-- Pixie Girl Hub · V2.2 §6.2 (owner session 2026-09-10)
--
-- Faitlynhair was running a 12-hour expiry with the nudge at 0 hours. That
-- combination cancelled FLH-SO-0198 (₦577,200, Website) at 03:30 the night
-- after it was placed, and messaged the customer within half an hour of
-- checkout. Pixie Girl was on the shipped 48/2.
--
-- CEO decision: 24 hours for both brands — a self-serve buyer always gets one
-- overnight to pay — with the nudge at the standard 2 hours. The validator
-- floor (payment-settings.validator.js) now refuses anything under 24, so the
-- 12-hour setting cannot come back through Sales → Payments.
--
-- These are OPERATOR-EDITABLE settings, so this migration deliberately writes
-- over what is stored: it is the point of the change. Everything else in
-- installment_settings is left untouched — jsonb_set edits one key at a time
-- rather than replacing the object. The nudge is only raised where it sits
-- below 2 (Faitlyn's 0), so a brand that deliberately runs a longer nudge
-- keeps it.
--
-- Re-running is a no-op: the same values are written.
-- ============================================================

UPDATE shared.business_config
   SET installment_settings = jsonb_set(
         COALESCE(installment_settings, '{}'::jsonb),
         '{abandoned_checkout_expiry_hours}',
         '24'::jsonb,
         true
       )
 WHERE business_key IN ('pixiegirl', 'faitlynhair');

UPDATE shared.business_config
   SET installment_settings = jsonb_set(
         COALESCE(installment_settings, '{}'::jsonb),
         '{abandoned_checkout_nudge_hours}',
         '2'::jsonb,
         true
       )
 WHERE business_key IN ('pixiegirl', 'faitlynhair')
   AND COALESCE(
         (installment_settings->>'abandoned_checkout_nudge_hours')::numeric,
         0
       ) < 2;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT business_key,
           installment_settings->>'abandoned_checkout_expiry_hours' AS expiry,
           installment_settings->>'abandoned_checkout_nudge_hours'  AS nudge
      FROM shared.business_config
     WHERE business_key IN ('pixiegirl', 'faitlynhair')
     ORDER BY business_key
  LOOP
    RAISE NOTICE '000384: % — expiry %h, nudge %h', r.business_key, r.expiry, r.nudge;
  END LOOP;
END $$;
