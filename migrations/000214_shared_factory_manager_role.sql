-- ============================================================
-- MIGRATION 000214 — factory_manager role
-- Pixie Girl Hub · V2.2
--
-- Adds:
--   • factory_manager system role in shared.roles
--   • purchasing view/edit/create permissions (scope: own)
--     so China factory partners can submit ledger entries
--     and log shipments through the admin app
--
-- The test account (manager@chinafactory.com) is NOT seeded
-- here — run `npm run seed:factory-manager` to create it.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ ROLE                                                               ║
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.roles (role_id, role_name, business, is_system, description) VALUES
  ('11111111-1111-1111-1111-000000000007',
   'factory_manager',
   NULL,
   true,
   'China factory partner: can view and submit ledger entries and shipments via the factory account screens')
ON CONFLICT DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ PERMISSIONS                                                        ║
-- ║ Factory managers need purchasing:view + edit + create (scope own)  ║
-- ║ because factory_account routes use requirePermission("purchasing") ║
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.permissions (role_id, module, action, record_scope) VALUES
  ('11111111-1111-1111-1111-000000000007', 'purchasing', 'view',   'own'),
  ('11111111-1111-1111-1111-000000000007', 'purchasing', 'create', 'own'),
  ('11111111-1111-1111-1111-000000000007', 'purchasing', 'edit',   'own')
ON CONFLICT DO NOTHING;
