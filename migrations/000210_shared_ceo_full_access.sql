-- ============================================================
-- 000210_shared_ceo_full_access
--
-- Ensures the CEO (is_ceo = true) has the 'owner' system role
-- assigned with full access across every business they can reach.
--
-- The RBAC middleware already short-circuits for is_ceo, so this
-- is belt-and-suspenders: the /auth/me/permissions endpoint
-- returns the union of role grants, and the admin Permissions
-- matrix shows the CEO's explicit grants.
--
-- Also ensures the owner role's permission matrix covers every
-- canonical module with full (view+create+edit+delete+approve+export)
-- grants, including any modules added after 000207.
-- ============================================================

-- 1) Grant the 'owner' role to every CEO user, for every business
--    they have access to (via user_business_access).
INSERT INTO shared.user_roles (user_id, role_id, business, granted_by, granted_at)
SELECT
  u.user_id,
  '11111111-1111-1111-1111-000000000001'::uuid,  -- owner role
  uba.business_key,
  u.user_id,  -- self-granted
  now()
FROM shared.users u
JOIN shared.user_business_access uba ON uba.user_id = u.user_id
WHERE u.is_ceo = true
ON CONFLICT (user_id, role_id, business) DO NOTHING;

-- 2) Also grant for the wildcard '*' business (cross-brand access).
INSERT INTO shared.user_roles (user_id, role_id, business, granted_by, granted_at)
SELECT
  u.user_id,
  '11111111-1111-1111-1111-000000000001'::uuid,
  '*',
  u.user_id,
  now()
FROM shared.users u
WHERE u.is_ceo = true
ON CONFLICT (user_id, role_id, business) DO NOTHING;

-- 3) Ensure the owner role has full permissions on EVERY canonical module.
--    Cross-join all module keys × all 6 actions, insert where missing.
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT
  '11111111-1111-1111-1111-000000000001'::uuid,
  mk.module_key,
  a.action,
  'all'
FROM shared.permission_module_keys mk
CROSS JOIN (VALUES ('view'),('create'),('edit'),('delete'),('approve'),('export')) AS a(action)
WHERE mk.is_active = true
ON CONFLICT (role_id, module, action) DO NOTHING;
