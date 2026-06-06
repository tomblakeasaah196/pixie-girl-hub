-- ============================================================
-- 000107_shared_purchasing_permissions
-- RBAC grants for the Purchasing & Procurement module (V2.2 §6.8).
-- The base seed (000015) granted only the owner role view/create/edit/approve.
-- This backfills the other roles + the delete/export actions so the PO approval
-- workflow (manager tier) and AP (accountant) actually work, and adds delete
-- (PO cancel / supplier-invoice void) for owner/admin.
-- Idempotent (UNIQUE role_id, module, action). CEO bypasses RBAC.
--   owner=...0001 admin=...0002 manager=...0003 staff=...0004
--   accountant=...0005 viewer=...0006
-- ============================================================

-- owner + admin: full control
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT r.role_id, 'purchasing', a.action, 'all'
FROM (VALUES
        ('11111111-1111-1111-1111-000000000001'::uuid),
        ('11111111-1111-1111-1111-000000000002'::uuid)) r(role_id),
     (VALUES ('view'),('create'),('edit'),('delete'),('approve'),('export')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- manager: build + approve POs (no hard delete)
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT '11111111-1111-1111-1111-000000000003'::uuid, 'purchasing', a.action, 'all'
FROM (VALUES ('view'),('create'),('edit'),('approve'),('export')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- accountant: handles supplier invoices / AP — view/create/edit/approve/export
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT '11111111-1111-1111-1111-000000000005'::uuid, 'purchasing', a.action, 'all'
FROM (VALUES ('view'),('create'),('edit'),('approve'),('export')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- staff: operate (raise POs/GRNs, no approve/delete)
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT '11111111-1111-1111-1111-000000000004'::uuid, 'purchasing', a.action, 'all'
FROM (VALUES ('view'),('create'),('edit')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- viewer: read-only
INSERT INTO shared.permissions (role_id, module, action, record_scope)
VALUES ('11111111-1111-1111-1111-000000000006', 'purchasing', 'view', 'all')
ON CONFLICT (role_id, module, action) DO NOTHING;
