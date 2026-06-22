-- ============================================================
-- MIGRATION 000237 — leave escalation threshold (HR final wiring)
-- Pixie Girl Hub · JBS Praxis
--
-- Leave of >= N days escalates: it can only be approved by the CEO (answer #11
-- — leave routed for higher sign-off). Shorter leave is approved directly by
-- HR/managers. The threshold is per-brand in hr_settings. Additive + idempotent.
-- ============================================================

ALTER TABLE shared.hr_settings
  ADD COLUMN IF NOT EXISTS leave_escalation_days SMALLINT NOT NULL DEFAULT 5;

COMMENT ON COLUMN shared.hr_settings.leave_escalation_days IS
  'Leave of >= this many days requires CEO approval (0 disables escalation).';
