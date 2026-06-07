-- ============================================================
-- 000109_shared_pos_permissions
-- RBAC grants for the POS module (V2.2 §6.3). The base seed (000015) granted
-- only the owner role view/create/edit. Cashiers are 'staff', so they must be
-- able to run sessions + check out; managers approve post-payment voids and
-- reconcile sessions; accountant reviews/exports.
-- Idempotent (UNIQUE role_id, module, action). CEO bypasses RBAC.
--   owner=...0001 admin=...0002 manager=...0003 staff=...0004
--   accountant=...0005 viewer=...0006
-- ============================================================

-- owner + admin: full control
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT r.role_id, 'pos', a.action, 'all'
FROM (VALUES
        ('11111111-1111-1111-1111-000000000001'::uuid),
        ('11111111-1111-1111-1111-000000000002'::uuid)) r(role_id),
     (VALUES ('view'),('create'),('edit'),('delete'),('approve'),('export')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- manager: operate + approve (post-payment voids, session reconciliation)
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT '11111111-1111-1111-1111-000000000003'::uuid, 'pos', a.action, 'all'
FROM (VALUES ('view'),('create'),('edit'),('approve'),('export')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- staff (cashier): open/close own session, check out, take payment
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT '11111111-1111-1111-1111-000000000004'::uuid, 'pos', a.action, 'all'
FROM (VALUES ('view'),('create'),('edit')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- accountant: read + export for reconciliation review
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT '11111111-1111-1111-1111-000000000005'::uuid, 'pos', a.action, 'all'
FROM (VALUES ('view'),('export')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- viewer: read-only
INSERT INTO shared.permissions (role_id, module, action, record_scope)
VALUES ('11111111-1111-1111-1111-000000000006', 'pos', 'view', 'all')
ON CONFLICT (role_id, module, action) DO NOTHING;
