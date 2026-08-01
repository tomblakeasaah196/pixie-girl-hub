-- ============================================================
-- MIGRATION 000348 — Stylist Studio RBAC: stylists → own scope, Ops → all
-- Pixie Girl Hub · JBS Praxis · V2.2 · §6.24 (Stylist Studio)
--
-- Owner directive: the Stylist Studio must feel like a personal work queue for
-- an individual stylist, not an admin console. Today every stylist can see
-- every job (delete/approve/export too — including the "write off a wig" and
-- "reconcile chemicals" surfaces meant for Ops). Meanwhile the Operations
-- Manager is boxed into partial_team, which is narrower than the stylists'
-- grant — the opposite of what the org actually runs on.
--
-- This migration rebalances the two roles for the `service_jobs` permission
-- key (the module key behind the "Stylist Studio" nav item):
--
--   tech_stylist  — view, create, edit  (scope 'own')
--                   NO delete / approve / export. The controller/service/repo
--                   already thread req.permission_scope through for own-scope
--                   filtering ("your jobs only" + historical access via the
--                   wig custody ledger).
--
--   ops_mgr       — view, create, edit, delete, approve, export (scope 'all')
--                   Ops manages the whole studio, reassigns mid-flight,
--                   approves write-offs & reconciliations.
--
-- CEO/owner bypass RBAC anyway, so they're unaffected either way. Idempotent:
-- clean-delete + insert on the two roles' service_jobs rows, so repeated runs
-- converge on the same grant set without drift.
-- ============================================================

-- 1. Reset both roles' grants for service_jobs before re-seeding, so any
--    stale action rows (e.g. an existing 'delete' on tech_stylist) are gone.
DELETE FROM shared.permissions
 WHERE role_id IN (
   '22222222-2222-2222-2222-000000000004', -- tech_stylist
   '22222222-2222-2222-2222-000000000002'  -- ops_mgr
 )
   AND module = 'service_jobs';

-- 2. tech_stylist — the individual stylist. Own scope only.
INSERT INTO shared.permissions (role_id, module, action, record_scope) VALUES
  ('22222222-2222-2222-2222-000000000004', 'service_jobs', 'view',   'own'),
  ('22222222-2222-2222-2222-000000000004', 'service_jobs', 'create', 'own'),
  ('22222222-2222-2222-2222-000000000004', 'service_jobs', 'edit',   'own');

-- 3. ops_mgr — the studio's operations manager. Full authority.
INSERT INTO shared.permissions (role_id, module, action, record_scope) VALUES
  ('22222222-2222-2222-2222-000000000002', 'service_jobs', 'view',    'all'),
  ('22222222-2222-2222-2222-000000000002', 'service_jobs', 'create',  'all'),
  ('22222222-2222-2222-2222-000000000002', 'service_jobs', 'edit',    'all'),
  ('22222222-2222-2222-2222-000000000002', 'service_jobs', 'delete',  'all'),
  ('22222222-2222-2222-2222-000000000002', 'service_jobs', 'approve', 'all'),
  ('22222222-2222-2222-2222-000000000002', 'service_jobs', 'export',  'all');

-- ============================================================
-- Verify:
--   SELECT role_id, action, record_scope
--     FROM shared.permissions
--    WHERE module = 'service_jobs'
--      AND role_id IN (
--        '22222222-2222-2222-2222-000000000004',
--        '22222222-2222-2222-2222-000000000002'
--      )
--    ORDER BY role_id, action;
--   -- tech_stylist: 3 rows, all scope 'own'
--   -- ops_mgr:      6 rows, all scope 'all'
-- ============================================================
