-- ============================================================
-- 000370 — factory_manager: production write + catalogue read.
--
-- The China factory manager is one of the two intended operators of the
-- Production module (the CEO is the other). Until now the role held only
-- production:view (000216), so the factory manager could watch a run but
-- could not open one, put products on it, or record what the factory
-- charged — every cost had to be re-keyed in Lagos from a WhatsApp message.
--
-- Grants:
--   production:create — open a production run
--   production:edit   — add products/costs, advance status, record rework
--   catalogue:view    — the run's product picker searches the catalogue,
--                       so a run line can carry a real variant_id (which is
--                       what makes the finished units receivable into stock)
--
-- Deliberately NOT granted: stock:edit. Receiving finished units posts a
-- production_in stock movement into a Lagos location — that is a Lagos
-- warehouse action, and /production/:id/receive now requires stock:edit on
-- top of production:edit.
--
-- NGN money stays invisible to this role regardless of these grants: the
-- production service redacts landed-cost columns for non-cost-visible
-- callers (see production.service costVisibility).
--
-- Idempotent: ON CONFLICT DO NOTHING.
-- ============================================================

INSERT INTO shared.permissions (role_id, module, action, record_scope) VALUES
  ('11111111-1111-1111-1111-000000000007', 'production', 'create', 'own'),
  ('11111111-1111-1111-1111-000000000007', 'production', 'edit',   'own'),
  ('11111111-1111-1111-1111-000000000007', 'catalogue',  'view',   'all')
ON CONFLICT DO NOTHING;
