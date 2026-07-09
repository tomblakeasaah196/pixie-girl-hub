-- ============================================================
-- MIGRATION 000310 — Baseline SmartComm grants for chat-less roles
-- Pixie Girl Hub · Messaging Smartcomm (V2.2 §6.17)
--
-- Source: production bug — a colleague on one of these roles never
-- receives in-house DMs or group messages. The sender's tick stays at
-- "sent" forever and the recipient's Messaging page looks empty.
--
-- Root cause: the 000207 access matrix seeded NO smartcomm rows for
-- tech_stylist, security, and china_prod. requirePermission('smartcomm',
-- 'view') therefore 403s every /api/v1/smartcomm/* call for those
-- roles — the recipient can't even LIST channels, let alone read a
-- message. The old inbox UI rendered that 403 as the ordinary
-- "No conversations yet" empty state, which made a permissions problem
-- look exactly like a delivery problem. (The companion frontend fix
-- makes a 403 render as an explicit "No access to Messaging" state.)
--
-- Decision: in-house chat is a baseline staff facility, like email —
-- every seeded operational role gets at least partial_own smartcomm
-- (view/create/edit, record scope 'own'), matching sales_rep's existing
-- level. Note the known trade-off this inherits from the existing
-- model: smartcomm.view also lets a staffer SEE customer threads for
-- the active brand (listChannelsForUser shows customer_threads to any
-- viewer with route access; per-platform REPLY/close still require
-- explicit smartcomm_platform_permissions grants). That is already the
-- posture for sales_rep / hr_admin / mktg_partner today; tightening
-- customer-thread listing behind platform grants is a separate,
-- deliberate change if wanted.
--
-- CUSTOM roles (created in IAM & Security) are intentionally NOT
-- touched — an admin chose their module set; granting behind their
-- back would be wrong. Admins grant SmartComm to custom roles in
-- IAM & Security → Roles.
--
-- Idempotent via ON CONFLICT (role_id, module, action) DO NOTHING.
-- ============================================================

BEGIN;

INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT r.role_id, 'smartcomm', a.action, a.scope
FROM (VALUES
        ('22222222-2222-2222-2222-000000000004'::uuid),  -- tech_stylist
        ('22222222-2222-2222-2222-000000000006'::uuid),  -- security
        ('22222222-2222-2222-2222-000000000007'::uuid)   -- china_prod
     ) AS r(role_id)
CROSS JOIN (VALUES
        ('view',   'own'),
        ('create', 'own'),
        ('edit',   'own')
     ) AS a(action, scope)
WHERE EXISTS (SELECT 1 FROM shared.roles ro WHERE ro.role_id = r.role_id)
ON CONFLICT (role_id, module, action) DO NOTHING;

COMMIT;
