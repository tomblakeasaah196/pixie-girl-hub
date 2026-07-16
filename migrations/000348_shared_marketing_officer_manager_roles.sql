-- ============================================================
-- 000348_shared_marketing_officer_manager_roles
-- Pixie Girl Hub · V2.2 · RBAC — split Marketing into two seats
--
-- WHY. Production carried a single hand-built `marketing_officer` role
-- (created through the Access UI: random UUID, is_system=false) that had
-- drifted into an over-broad, all-modules/all-actions grant — including
-- integration secrets (apify_settings), system content (help_center) and
-- ALL-scope attendance (approve/alter everyone's clock-ins). This migration
-- replaces that with two curated, reproducible SYSTEM roles:
--
--   • marketing_officer  — the DOER. Builds campaigns, social, retention &
--       partner BD; DRAFTS customer messages but cannot send/publish/approve
--       and cannot delete or export. Own-scope on the things they author.
--   • marketing_manager  — the OVERSEER. Everything the officer does at `all`
--       scope PLUS the gates that actually commit: approve campaign SENDS
--       (email `POST /:id/send` = approve), publish social posts
--       (social `approve`), sign off partner SETTLEMENTS + mark paid
--       (retail_partners `approve`), send customer broadcasts (smartcomm
--       `edit` = the send verb), delete campaign content, and export analytics.
--
-- The officer/manager line is drawn against what each ACTION actually gates in
-- the routes (verified), NOT against the module name:
--   email_campaigns  POST /:id/send  → approve   (officer builds, mgr sends)
--   smartcomm        POST /send       → edit      (draft = view; send = edit)
--   social           post approve/publish/targets → approve  (mgr publishes)
--   retail_partners  settlement approve + mark paid → approve (mgr = the cash)
--
-- ADOPT-BY-NAME (not fixed UUID) for the roles. UNIQUE(role_name, business)
-- does NOT fire when business IS NULL (SQL NULL <> NULL), so a plain INSERT of a
-- fixed-UUID `marketing_officer` would DUPLICATE the production role. We instead
-- guard with NOT EXISTS and key everything off the resolved role_id, so on prod
-- we ADOPT the existing row (its role_id is preserved → existing
-- shared.user_roles assignments survive) and on a fresh DB we create the
-- canonical role. role_id is FK'd by user_roles/permissions (no ON UPDATE
-- CASCADE), so we never rewrite it.
--
-- Idempotent: re-running deletes + re-seeds these two roles' matrices to exactly
-- the state below. CEO/owner bypasses RBAC regardless; grants are for the UI +
-- audit. NOTE: there is a pre-existing `mktg_partner` system role (…005) that is
-- NOT touched here — see the note at the bottom about consolidating it later.
-- ============================================================
-- The runner (scripts/migrate-shared.js) wraps each file in its own
-- BEGIN/COMMIT, so this file does NOT self-wrap.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 1) ROLES — adopt-or-create, then normalise to system roles         ║
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.roles (role_id, role_name, business, is_system, description)
SELECT '22222222-2222-2222-2222-000000000009', 'marketing_officer', NULL, true,
       'Marketing Officer — executes campaigns, social, retention & partner BD; drafts customer messages but cannot send, publish or approve, and cannot delete or export (manager gate).'
WHERE NOT EXISTS (
  SELECT 1 FROM shared.roles WHERE role_name = 'marketing_officer' AND business IS NULL
);

INSERT INTO shared.roles (role_id, role_name, business, is_system, description)
SELECT '22222222-2222-2222-2222-000000000010', 'marketing_manager', NULL, true,
       'Marketing Manager — oversees marketing; approves campaign sends, ad budgets, customer broadcasts, social publishing & partner settlements; may delete campaign content and export analytics.'
WHERE NOT EXISTS (
  SELECT 1 FROM shared.roles WHERE role_name = 'marketing_manager' AND business IS NULL
);

-- Normalise whichever row now represents each role (covers the adopted prod row).
UPDATE shared.roles
   SET is_system   = true,
       description = 'Marketing Officer — executes campaigns, social, retention & partner BD; drafts customer messages but cannot send, publish or approve, and cannot delete or export (manager gate).'
 WHERE role_name = 'marketing_officer' AND business IS NULL;

UPDATE shared.roles
   SET is_system   = true,
       description = 'Marketing Manager — oversees marketing; approves campaign sends, ad budgets, customer broadcasts, social publishing & partner settlements; may delete campaign content and export analytics.'
 WHERE role_name = 'marketing_manager' AND business IS NULL;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 2) RESET their permission matrices (strip the old over-broad grants) ║
-- ╚════════════════════════════════════════════════════════════════════╝

DELETE FROM shared.permissions
 WHERE role_id IN (
   SELECT role_id FROM shared.roles
    WHERE role_name IN ('marketing_officer', 'marketing_manager') AND business IS NULL
 );

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 3) RE-SEED the curated role × module × action matrix                ║
-- ║                                                                     ║
-- ║ Level → (actions, scope) legend:                                    ║
-- ║   co    view,create,edit                       @ own  (authored/personal)
-- ║   ca    view,create,edit                       @ all  (shared team data)
-- ║   ra    view                                   @ all  (read-only ref)
-- ║   ea    view,edit                              @ all  (edit shared copy)
-- ║   clock view,create                            @ own  (attendance = clock)
-- ║   ap    view,create,edit,approve               @ all  (mgr: send/sign-off)
-- ║   ae    view,create,edit,approve,export        @ all  (mgr: +export)
-- ║   fst   view,create,edit,delete,approve        @ all  (mgr: storefront full)
-- ║   full  view,create,edit,delete,approve,export @ all  (mgr: Grow content)
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.permissions (role_id, module, action, record_scope)
SELECT r.role_id, g.module, a.action, a.scope
FROM (
  SELECT role_id, role_name FROM shared.roles
   WHERE role_name IN ('marketing_officer', 'marketing_manager') AND business IS NULL
) AS r
JOIN (VALUES
  -- ── marketing_officer (the DOER) ─────────────────────────────────────
  ('marketing_officer', 'sales_campaigns',     'co'),   -- build own flash sales / landing pages; cannot approve/publish
  ('marketing_officer', 'email_campaigns',     'co'),   -- build+schedule own email/ad campaigns; send is approve-gated → mgr
  ('marketing_officer', 'social',              'ca'),   -- create/edit posts on the shared calendar; publish is approve → mgr
  ('marketing_officer', 'comms_studio',        'ca'),   -- author automated-message templates & copy
  ('marketing_officer', 'ad_analytics',        'ca'),   -- log/track ad spend & performance; budget approve → mgr
  ('marketing_officer', 'retention',           'ca'),   -- run loyalty/referrals/win-back
  ('marketing_officer', 'contacts',            'ca'),   -- manage shared contacts (no export — PII)
  ('marketing_officer', 'customer_onboarding', 'ca'),   -- new-customer intake & profile setup
  ('marketing_officer', 'retail_partners',     'ca'),   -- BD: onboard partners, locations, log movements/draft settlements; NO approve (no cash sign-off)
  ('marketing_officer', 'smartcomm',           'ra'),   -- READ the inbox + prepare drafts; send is `edit` → withheld
  ('marketing_officer', 'crm',                 'ra'),   -- read customer 360
  ('marketing_officer', 'catalogue',           'ra'),   -- read products/variants
  ('marketing_officer', 'service_catalogue',   'ra'),   -- read bookable services & pricing
  ('marketing_officer', 'storefront_studio',   'ea'),   -- edit storefront copy/wording; no publish/delete
  ('marketing_officer', 'calendar',            'co'),   -- personal calendar
  ('marketing_officer', 'tasks',               'co'),   -- personal tasks
  ('marketing_officer', 'expenses',            'co'),   -- file own campaign/ad expense claims (approval = Finance/CEO)
  ('marketing_officer', 'attendance',          'clock'),-- clock in/out only (own)

  -- ── marketing_manager (the OVERSEER) ─────────────────────────────────
  ('marketing_manager', 'sales_campaigns',     'full'), -- + approve/publish, delete, export
  ('marketing_manager', 'email_campaigns',     'full'), -- + approve(=SEND), delete, export
  ('marketing_manager', 'social',              'full'), -- + approve(=publish)/targets, delete(revoke accounts), export
  ('marketing_manager', 'storefront_studio',   'fst'),  -- full incl approve/delete (no export surface)
  ('marketing_manager', 'ad_analytics',        'ae'),   -- + approve budgets, export analytics (no delete)
  ('marketing_manager', 'retention',           'ae'),   -- + approve, export
  ('marketing_manager', 'smartcomm',           'ap'),   -- + edit(=SEND) + approve; sends customer broadcasts
  ('marketing_manager', 'comms_studio',        'ap'),   -- + approve automated-message copy
  ('marketing_manager', 'retail_partners',     'ap'),   -- + approve settlements & mark PAID (the cash gate)
  ('marketing_manager', 'contacts',            'ca'),   -- manage contacts (still no export — PII)
  ('marketing_manager', 'customer_onboarding', 'ca'),
  ('marketing_manager', 'crm',                 'ra'),
  ('marketing_manager', 'catalogue',           'ra'),
  ('marketing_manager', 'service_catalogue',   'ra'),
  ('marketing_manager', 'calendar',            'co'),
  ('marketing_manager', 'tasks',               'co'),
  ('marketing_manager', 'expenses',            'co'),   -- files own claims; approval stays Finance/CEO
  ('marketing_manager', 'attendance',          'clock')
) AS g(role_name, module, lvl) ON g.role_name = r.role_name
JOIN (VALUES
  ('co',    'view',   'own'), ('co',    'create', 'own'), ('co',    'edit',   'own'),
  ('ca',    'view',   'all'), ('ca',    'create', 'all'), ('ca',    'edit',   'all'),
  ('ra',    'view',   'all'),
  ('ea',    'view',   'all'), ('ea',    'edit',   'all'),
  ('clock', 'view',   'own'), ('clock', 'create', 'own'),
  ('ap',    'view',   'all'), ('ap',    'create', 'all'), ('ap',    'edit',   'all'), ('ap',    'approve', 'all'),
  ('ae',    'view',   'all'), ('ae',    'create', 'all'), ('ae',    'edit',   'all'), ('ae',    'approve', 'all'), ('ae', 'export', 'all'),
  ('fst',   'view',   'all'), ('fst',   'create', 'all'), ('fst',   'edit',   'all'), ('fst',   'delete',  'all'), ('fst', 'approve', 'all'),
  ('full',  'view',   'all'), ('full',  'create', 'all'), ('full',  'edit',   'all'), ('full',  'delete',  'all'), ('full', 'approve', 'all'), ('full', 'export', 'all')
) AS a(lvl, action, scope) ON a.lvl = g.lvl
ON CONFLICT (role_id, module, action) DO NOTHING;

-- ============================================================
-- Verify (expect officer = 44 rows, manager = 65 rows):
--   SELECT r.role_name, count(*)
--     FROM shared.roles r JOIN shared.permissions p USING (role_id)
--    WHERE r.role_name IN ('marketing_officer','marketing_manager')
--      AND r.business IS NULL
--    GROUP BY r.role_name;
--
--   -- Full readout for one role:
--   SELECT p.module,
--          string_agg(p.action||':'||p.record_scope, ', ' ORDER BY p.action)
--     FROM shared.roles r JOIN shared.permissions p USING (role_id)
--    WHERE r.role_name = 'marketing_officer' AND r.business IS NULL
--    GROUP BY p.module ORDER BY p.module;
--
-- FOLLOW-UP (separate decision): consolidate the older `mktg_partner` role
-- (…005) — either retire it or fold its users onto these two seats.
-- ============================================================
