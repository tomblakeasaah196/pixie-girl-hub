-- ============================================================
-- 000249_shared_studio_frontdesk_permissions
-- Pixie Girl Hub · JBS Praxis · V2.2 · §6.24 (Stylist Studio)
--
-- The walk-in flow needs the front desk and Ops to reach the services catalogue
-- and to check a customer's own wig into custody. Grant the minimum:
--   • sales_rep  → service_catalogue (view)  + service_jobs (view, create)
--                  so the Quick Sale service picker loads and own-wig check-in
--                  (customer_assets, guarded by the service_jobs key) works.
--   • ops_mgr    → service_catalogue (view, create, edit)
--                  so Ops curates the services list.
-- Idempotent: ON CONFLICT (role_id, module, action) DO NOTHING.
-- ============================================================

INSERT INTO shared.permissions (role_id, module, action, record_scope) VALUES
  -- sales_rep (front desk)
  ('22222222-2222-2222-2222-000000000003', 'service_catalogue', 'view',   'all'),
  ('22222222-2222-2222-2222-000000000003', 'service_jobs',      'view',   'all'),
  ('22222222-2222-2222-2222-000000000003', 'service_jobs',      'create', 'all'),
  -- ops_mgr curates the services catalogue
  ('22222222-2222-2222-2222-000000000002', 'service_catalogue', 'view',   'all'),
  ('22222222-2222-2222-2222-000000000002', 'service_catalogue', 'create', 'all'),
  ('22222222-2222-2222-2222-000000000002', 'service_catalogue', 'edit',   'all')
ON CONFLICT (role_id, module, action) DO NOTHING;

-- ============================================================
-- Verify:
--   SELECT module, action FROM shared.permissions
--     WHERE role_id = '22222222-2222-2222-2222-000000000003'
--       AND module IN ('service_catalogue','service_jobs');
-- ============================================================
