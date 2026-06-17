-- ============================================================
-- MIGRATION 000219 — Messaging Accounts admin permission key
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- PR 6 — exposes the `shared.messaging_accounts` table (shipped in
-- 000213) through a CEO-editable admin page. The table itself
-- doesn't change; we just register a permission module so the
-- routes can gate `messaging_accounts.view/create/edit/delete`
-- without conflating with the broader smartcomm permission.
--
-- Also includes a `support_email` re-affirmation in case 000217
-- hasn't been applied yet (idempotent guard) — PR 4's columns are
-- a hard prerequisite for the Business Setup edits in this PR.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 1. Permission module key                                           ║
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.permission_module_keys (module_key, display_name, description, display_order) VALUES
  ('messaging_accounts',  'Messaging Accounts',
   'Connect WhatsApp / Instagram / Facebook / inbound email per brand. CEO-only.',
   915)
ON CONFLICT (module_key) DO NOTHING;

-- Owner full grants
INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT
  '11111111-1111-1111-1111-000000000001'::uuid,
  mk.module_key,
  a.action,
  'all'
FROM shared.permission_module_keys mk
CROSS JOIN (VALUES ('view'),('create'),('edit'),('delete'),('approve'),('export')) AS a(action)
WHERE mk.module_key = 'messaging_accounts'
ON CONFLICT (role_id, module, action) DO NOTHING;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 2. Belt-and-braces: PR 4's support_email columns                   ║
-- ║    (no-op when 000217 already ran).                                ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.business_config
  ADD COLUMN IF NOT EXISTS support_email              TEXT,
  ADD COLUMN IF NOT EXISTS support_email_display_name TEXT;

-- ============================================================
-- Verify
--   SELECT module_key FROM shared.permission_module_keys
--    WHERE module_key = 'messaging_accounts';
--   SELECT support_email FROM shared.business_config;
-- ============================================================
