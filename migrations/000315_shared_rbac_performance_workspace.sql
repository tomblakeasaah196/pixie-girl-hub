-- ============================================================
-- 000315_shared_rbac_performance_workspace
-- Pixie Girl Hub · V2.2 · RBAC friendly-names pass
--
-- Three data-layer changes that go with the catalog rename
-- (src/shared/access/access.catalog.js) and the hr.routes.js Performance split:
--
--  A) PERFORMANCE SPLIT. Appraisal scoring/reviews/KPI definitions moved from
--     the `hr_payroll` gate to a new `performance` gate so a manager can be
--     granted "Performance" (score their team) WITHOUT payroll/salary access.
--     Copy every existing hr_payroll grant onto `performance` so NO role loses
--     access — CEO can then narrow/hand it out per role from the UI.
--
--  B) AUTOMATED MESSAGES STUDIO (comms_studio). Its routes have been enforced
--     since 000309, and 000309 seeded grants — but 000311 (module reconcile)
--     ran afterwards and DELETED every module not in its then-current list,
--     which silently wiped comms_studio. It has been ungrantable ever since
--     (no column in the matrix). Re-seed it, and widen edit to admins/ops.
--
--  C) WORKSPACE FOR EVERYONE. Calendar / Tasks / Attendance are the personal
--     Workspace (My Day / Calendar / Tasks / My HR). Give the base operational
--     roles their OWN-scope access so every employee's personal Workspace works
--     without an explicit grant. Own-scope only — no visibility of other
--     people's data; org-wide/admin surfaces (all-staff attendance history,
--     geofence setup, the shared task board) stay behind the module gate.
--
-- Idempotent — UNIQUE (role_id, module, action) + ON CONFLICT DO NOTHING.
-- CEO/owner bypasses RBAC regardless; explicit grants are for audit/UI clarity.
-- ============================================================

-- ── A) Performance split — mirror hr_payroll grants onto performance ─────────
INSERT INTO shared.permissions (role_id, module, action, record_scope, hidden_fields)
SELECT role_id, 'performance', action, record_scope, hidden_fields
  FROM shared.permissions
 WHERE module = 'hr_payroll'
ON CONFLICT (role_id, module, action) DO NOTHING;

-- ── B) Automated Messages Studio — restore + widen edit access ───────────────
-- view = look up what an automation says; edit = change the copy (admin-level).
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT r.role_id, 'comms_studio', a.action, 'all'
  FROM (VALUES
    ('11111111-1111-1111-1111-000000000001'::uuid, true),  -- owner        (view+edit)
    ('11111111-1111-1111-1111-000000000002'::uuid, true),  -- admin        (view+edit)
    ('11111111-1111-1111-1111-000000000003'::uuid, true),  -- manager      (view+edit)
    ('22222222-2222-2222-2222-000000000002'::uuid, true),  -- ops_mgr      (view+edit)
    ('22222222-2222-2222-2222-000000000005'::uuid, false)  -- mktg_partner (view only)
  ) AS r(role_id, can_edit)
  CROSS JOIN (VALUES ('view'), ('edit')) AS a(action)
  WHERE a.action = 'view' OR r.can_edit
ON CONFLICT (role_id, module, action) DO NOTHING;

-- ── C) Workspace personal access for the base operational roles ──────────────
-- staff: full personal use of their own calendar/tasks + clock in/out.
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT '11111111-1111-1111-1111-000000000004'::uuid, m.module, a.action, 'own'
  FROM (VALUES ('calendar'), ('tasks'), ('attendance')) AS m(module)
  CROSS JOIN (VALUES ('view'), ('create'), ('edit')) AS a(action)
  -- attendance is append-only clock events: view + create (clock), no edit.
  WHERE NOT (m.module = 'attendance' AND a.action = 'edit')
ON CONFLICT (role_id, module, action) DO NOTHING;

-- viewer: read-only — sees their own calendar & tasks, nothing to write.
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT '11111111-1111-1111-1111-000000000006'::uuid, m.module, 'view', 'own'
  FROM (VALUES ('calendar'), ('tasks')) AS m(module)
ON CONFLICT (role_id, module, action) DO NOTHING;

-- ============================================================
-- Verify:
--   SELECT module, COUNT(*) FROM shared.permissions
--    WHERE module IN ('performance','comms_studio') GROUP BY module;
-- ============================================================
