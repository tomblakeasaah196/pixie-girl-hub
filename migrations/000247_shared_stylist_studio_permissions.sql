-- ============================================================
-- 000247_shared_stylist_studio_permissions
-- Pixie Girl Hub · JBS Praxis · V2.2 · §6.24 (Stylist Studio)
--
-- The in-house styling module is being renamed service_jobs → stylist_studio.
-- This migration ADDS the new permission key alongside the old one — it does NOT
-- remove 'service_jobs'. Reason: the live /api/v1/service-jobs routes still call
-- requirePermission('service_jobs') until the backend rename lands (PR2). Adding
-- the key now lets PR2 flip the code to 'stylist_studio' against a permission
-- set that already exists, with zero window where the module is unreachable. A
-- follow-up (end of PR2) removes the now-unused 'service_jobs' rows.
--
-- Every role keeps EXACTLY the grant it had on service_jobs (CEO/owner bypasses
-- checks anyway). Idempotent: ON CONFLICT (role_id, module, action) DO NOTHING.
-- ============================================================

INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT role_id, 'stylist_studio', action, record_scope
FROM shared.permissions
WHERE module = 'service_jobs'
ON CONFLICT (role_id, module, action) DO NOTHING;

-- ============================================================
-- Verify:
--   SELECT module, count(*) FROM shared.permissions
--     WHERE module IN ('service_jobs','stylist_studio')
--     GROUP BY module;   -- both present with equal counts
-- ============================================================
