-- ============================================================
-- 000103_shared_catalogue_permissions
-- Catalogue (Module 6.4/6.9) RBAC grants. CEO bypasses RBAC.
-- shared.permissions UNIQUE (role_id, module, action) → idempotent.
--   owner=...0001 admin=...0002 manager=...0003 staff=...0004
--   accountant=...0005 viewer=...0006
--
-- 'publish' (P0-6 styled workflow): promote a Styled product DRAFT → LIVE.
-- Granted to owner/admin/manager (the "Ops can publish" rule); Sales/
-- Marketing operate on drafts via create/edit but cannot publish.
-- Cost-vault visibility is NOT a permission here — it is a per-user grant
-- in shared.cost_vault_grants, owner-controlled (see 000117).
-- ============================================================
INSERT INTO shared.permissions (role_id, module, action, record_scope) VALUES
  ('11111111-1111-1111-1111-000000000001', 'catalogue', 'view',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'catalogue', 'create',  'all'),
  ('11111111-1111-1111-1111-000000000001', 'catalogue', 'edit',    'all'),
  ('11111111-1111-1111-1111-000000000001', 'catalogue', 'delete',  'all'),
  ('11111111-1111-1111-1111-000000000001', 'catalogue', 'export',  'all'),
  ('11111111-1111-1111-1111-000000000001', 'catalogue', 'publish', 'all'),
  ('11111111-1111-1111-1111-000000000002', 'catalogue', 'view',    'all'),
  ('11111111-1111-1111-1111-000000000002', 'catalogue', 'create',  'all'),
  ('11111111-1111-1111-1111-000000000002', 'catalogue', 'edit',    'all'),
  ('11111111-1111-1111-1111-000000000002', 'catalogue', 'delete',  'all'),
  ('11111111-1111-1111-1111-000000000002', 'catalogue', 'export',  'all'),
  ('11111111-1111-1111-1111-000000000002', 'catalogue', 'publish', 'all'),
  ('11111111-1111-1111-1111-000000000003', 'catalogue', 'view',    'all'),
  ('11111111-1111-1111-1111-000000000003', 'catalogue', 'create',  'all'),
  ('11111111-1111-1111-1111-000000000003', 'catalogue', 'edit',    'all'),
  ('11111111-1111-1111-1111-000000000003', 'catalogue', 'publish', 'all'),
  ('11111111-1111-1111-1111-000000000004', 'catalogue', 'view',    'all'),
  ('11111111-1111-1111-1111-000000000005', 'catalogue', 'view',    'all'),
  ('11111111-1111-1111-1111-000000000006', 'catalogue', 'view',    'all')
ON CONFLICT (role_id, module, action) DO NOTHING;
