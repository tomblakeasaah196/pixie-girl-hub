-- ============================================================
-- 000110_shared_logistics_permissions
-- RBAC grants for the Logistics & Delivery module (V2.2 §6.10). The base seed
-- (000015) granted only the owner role. Dispatch/fulfilment is run by staff;
-- managers approve POD reconciliation; accountant reviews/exports POD remittances.
-- Idempotent (UNIQUE role_id, module, action). CEO bypasses RBAC.
--   owner=...0001 admin=...0002 manager=...0003 staff=...0004
--   accountant=...0005 viewer=...0006
-- ============================================================

-- owner + admin: full control
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT r.role_id, 'logistics', a.action, 'all'
FROM (VALUES
        ('11111111-1111-1111-1111-000000000001'::uuid),
        ('11111111-1111-1111-1111-000000000002'::uuid)) r(role_id),
     (VALUES ('view'),('create'),('edit'),('delete'),('approve'),('export')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- manager: operate + approve (POD reconciliation)
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT '11111111-1111-1111-1111-000000000003'::uuid, 'logistics', a.action, 'all'
FROM (VALUES ('view'),('create'),('edit'),('approve'),('export')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- staff: dispatch + record attempts/proofs (no approve/delete)
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT '11111111-1111-1111-1111-000000000004'::uuid, 'logistics', a.action, 'all'
FROM (VALUES ('view'),('create'),('edit')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- accountant: read + export for POD remittance reconciliation
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT '11111111-1111-1111-1111-000000000005'::uuid, 'logistics', a.action, 'all'
FROM (VALUES ('view'),('export')) a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- viewer: read-only
INSERT INTO shared.permissions (role_id, module, action, record_scope)
VALUES ('11111111-1111-1111-1111-000000000006', 'logistics', 'view', 'all')
ON CONFLICT (role_id, module, action) DO NOTHING;
