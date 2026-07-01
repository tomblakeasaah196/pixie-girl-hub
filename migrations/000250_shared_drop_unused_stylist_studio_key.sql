-- ============================================================
-- 000250_shared_drop_unused_stylist_studio_key
-- Pixie Girl Hub · JBS Praxis · V2.2 · §6.24 (Stylist Studio)
--
-- Migration 000247 added a 'stylist_studio' permission key in anticipation of
-- renaming the service_jobs module. The rename was intentionally NOT done (the
-- 'service_jobs' key is load-bearing across ~17 files + the SQL table name), so
-- 'stylist_studio' is dead — no route ever calls requirePermission('stylist_
-- studio'). Remove the unused grants. "Stylist Studio" remains the product name.
-- Idempotent.
-- ============================================================

DELETE FROM shared.permissions WHERE module = 'stylist_studio';

-- ============================================================
-- Verify:  SELECT count(*) FROM shared.permissions
--            WHERE module = 'stylist_studio';   -- 0
-- ============================================================
