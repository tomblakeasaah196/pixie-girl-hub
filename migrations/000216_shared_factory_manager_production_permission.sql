-- ============================================================
-- MIGRATION 000216 — factory_manager: production:view permission
-- Pixie Girl Hub · V2.2
--
-- Grants factory_manager role view access to production runs
-- so China factory partners can see the production status for
-- orders they are manufacturing.
-- ============================================================

INSERT INTO shared.permissions (role_id, module, action, record_scope) VALUES
  ('11111111-1111-1111-1111-000000000007', 'production', 'view', 'own')
ON CONFLICT DO NOTHING;
