-- ============================================================
-- 000108_shared_business_setup_permissions
-- RBAC grants for the Business Setup / Identity module (V2.2 Module 18).
-- The base seed (000015) registered the module in shared.modules but granted
-- it to no role. Business Setup is sensitive (brand identity, bank accounts,
-- tax rates, document numbering), so edit rights are owner/admin only; other
-- roles get read. Accountant additionally gets edit (tax rates + bank accounts
-- are their domain).
-- Idempotent (UNIQUE role_id, module, action). CEO bypasses RBAC.
--   owner=...0001 admin=...0002 manager=...0003 staff=...0004
--   accountant=...0005 viewer=...0006
-- ============================================================

-- owner + admin: full control
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT r.role_id, 'business_setup', a.action, 'all'
FROM (VALUES
        ('11111111-1111-1111-1111-000000000001'::uuid),
        ('11111111-1111-1111-1111-000000000002'::uuid)) r(role_id),
     (VALUES ('view'),('create'),('edit'),('delete'),('export')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- accountant: view + create/edit/export (tax rates, bank accounts, numbering)
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT '11111111-1111-1111-1111-000000000005'::uuid, 'business_setup', a.action, 'all'
FROM (VALUES ('view'),('create'),('edit'),('export')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- manager + viewer: read-only
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT r.role_id, 'business_setup', 'view', 'all'
FROM (VALUES
        ('11111111-1111-1111-1111-000000000003'::uuid),
        ('11111111-1111-1111-1111-000000000006'::uuid)) r(role_id)
ON CONFLICT (role_id, module, action) DO NOTHING;
