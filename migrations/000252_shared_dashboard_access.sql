-- ============================================================
-- 000252_shared_dashboard_access
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- Dashboards & Reports (§6.20) is reserved for the management circle:
-- CEO/Owner, Top Management, Operations Manager, Finance, and Admin.
-- The 000207 matrix seeded `dashboards` view for sales_rep, mktg_partner
-- and china_prod too — revoke those. And only the owner held the `export`
-- action, which would 403 every management Excel export — grant it to the
-- management roles.
--
-- Access model after this migration (enforced in
-- src/modules/dashboards/dashboards.access.js):
--   1. RBAC matrix        — dashboards.view / dashboards.export below.
--   2. Org-chart rights   — additive VIEW grant for holders of a management
--                           position (shared.org_positions.is_management) or a
--                           dotted-line superior position whose line carries
--                           rights->>'can_view_dashboards' = true
--                           (shared.org_position_dotted_lines). Org rights
--                           never grant export.
--   3. Domain gates       — Finance tab additionally needs accounting.view;
--                           HR tab needs hr_payroll.view; cost/margin tiles
--                           need accounting.view (field privacy). CEO bypasses.
--
-- Idempotent: DELETEs are naturally re-runnable; INSERTs use
-- ON CONFLICT (role_id, module, action) DO NOTHING.
-- ============================================================

-- 1) Revoke dashboards from non-management named roles (000207 seeds).
DELETE FROM shared.permissions
 WHERE module = 'dashboards'
   AND role_id IN (
     '22222222-2222-2222-2222-000000000003', -- sales_rep
     '22222222-2222-2222-2222-000000000005', -- mktg_partner
     '22222222-2222-2222-2222-000000000007'  -- china_prod
   );

-- 2) Named management roles keep their view (scope 'team' from 000207) and
--    gain export so the Excel endpoints work for them.
INSERT INTO shared.permissions (role_id, module, action, record_scope) VALUES
  ('22222222-2222-2222-2222-000000000001', 'dashboards', 'export', 'team'), -- hr_admin
  ('22222222-2222-2222-2222-000000000002', 'dashboards', 'export', 'team'), -- ops_mgr
  ('22222222-2222-2222-2222-000000000008', 'dashboards', 'export', 'team')  -- finance
ON CONFLICT (role_id, module, action) DO NOTHING;

-- 3) Generic system roles in the management circle (000015) had NO dashboards
--    grants at all — give Admin, Manager (Top Management) and Accountant
--    (finance seat) view + export. Staff and Viewer stay without access.
INSERT INTO shared.permissions (role_id, module, action, record_scope) VALUES
  ('11111111-1111-1111-1111-000000000002', 'dashboards', 'view',   'all'), -- admin
  ('11111111-1111-1111-1111-000000000002', 'dashboards', 'export', 'all'),
  ('11111111-1111-1111-1111-000000000003', 'dashboards', 'view',   'all'), -- manager
  ('11111111-1111-1111-1111-000000000003', 'dashboards', 'export', 'all'),
  ('11111111-1111-1111-1111-000000000005', 'dashboards', 'view',   'all'), -- accountant
  ('11111111-1111-1111-1111-000000000005', 'dashboards', 'export', 'all')
ON CONFLICT (role_id, module, action) DO NOTHING;

-- ============================================================
-- Verify:
--   SELECT r.role_name, p.action, p.record_scope
--     FROM shared.permissions p JOIN shared.roles r USING (role_id)
--    WHERE p.module = 'dashboards' ORDER BY r.role_name, p.action;
-- Expected roles: owner (all six actions), admin/manager/accountant
-- (view+export), hr_admin/ops_mgr/finance (view+export).
-- ============================================================
