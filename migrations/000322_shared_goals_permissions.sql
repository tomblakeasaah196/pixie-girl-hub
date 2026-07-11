-- ============================================================
-- MIGRATION 000322 — Chief of Staff: `goals` permission module (PR1)
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- Registers the `goals` module in shared.permissions so the new
-- /api/v1/goals and /api/v1/notes routes (gated on requirePermission
-- ("goals", …)) are grantable in the access matrix.
--
-- Goals/Notes are a CEO/executive Workspace feature for v1 (the CoS tab
-- is CEO-gated in the admin UI), so grants go to the executive tier —
-- owner / admin / manager — at 'all' scope. CEO/owner bypasses RBAC
-- regardless; explicit grants are for matrix-UI + audit clarity and let
-- the CEO widen access to more roles later without a code change.
--
-- Idempotent: UNIQUE (role_id, module, action) + ON CONFLICT DO NOTHING.
-- MUST stay in sync with src/shared/access/access.catalog.js (`goals`).
-- ============================================================

INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT r.role_id, 'goals', a.action, 'all'
  FROM (VALUES
    ('11111111-1111-1111-1111-000000000001'::uuid),  -- owner
    ('11111111-1111-1111-1111-000000000002'::uuid),  -- admin
    ('11111111-1111-1111-1111-000000000003'::uuid)   -- manager
  ) AS r(role_id)
  CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete')) AS a(action)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- ============================================================
-- Verify:
--   SELECT action, count(*) FROM shared.permissions
--    WHERE module = 'goals' GROUP BY action;   -- expect view/create/edit/delete
-- ============================================================
