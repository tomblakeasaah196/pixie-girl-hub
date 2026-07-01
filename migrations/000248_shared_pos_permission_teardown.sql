-- ============================================================
-- 000248_shared_pos_permission_teardown
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- The POS terminal module is retired (replaced by the Quick Sale Form). Remove
-- its module-level permission grants. Idempotent. NOTE: this only removes the
-- 'pos' MODULE permission — the 'pos' price tier / sales_channel / payroll
-- commission channel are a separate "in-store pricing" concept and are kept.
-- ============================================================

DELETE FROM shared.permissions WHERE module = 'pos';

-- ============================================================
-- Verify:  SELECT count(*) FROM shared.permissions WHERE module = 'pos';  -- 0
-- ============================================================
