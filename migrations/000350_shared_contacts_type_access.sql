-- ============================================================
-- MIGRATION 000350 — Contacts: per-role contact-type visibility
-- Pixie Girl Hub · V2.2 · §3 (RBAC) · §6.12 (Contacts)
--
-- Today the `contacts` permission is all-or-nothing: any role granted
-- contacts.view sees EVERY contact — customers, suppliers/manufacturers,
-- staff, retail & stylist partners — in one shared directory. The owner
-- needs to separate them: the people who reach out to the China
-- manufacturers (suppliers) should not also be looking at the client book,
-- and vice-versa. Contacts already carry contact_type TEXT[] (any combo of
-- 'customer','supplier','staff','retail_partner','stylist_partner'), so that
-- is the axis we gate on.
--
-- This adds a 6th, contacts-specific scoping dimension on top of the existing
-- record scope (all/team/own): a per-role allow-list of contact TYPES a role
-- may see. Semantics mirror the CEO channel-access matrix
-- (shared.smartcomm_platform_permissions):
--
--   • NO row for a role      → UNRESTRICTED (sees every contact type). This is
--                              the default, so nothing changes on deploy —
--                              every existing role keeps full visibility.
--   • row exists             → RESTRICTED to the listed types. An empty array
--                              means "sees no contacts" (the module shell only).
--
-- A user's effective visibility is the UNION across their brand-active roles,
-- so any unrestricted role widens access — to lock a person down, every role
-- they hold must be restricted (or give restricted staff only the restricted
-- role). The CEO/owner bypasses RBAC and always sees everything.
--
-- Enforced in src/shared/contacts/contacts.repo.js (list/get/stats/milestones)
-- and threaded via req.contact_type_scope (middleware/rbac.js contactTypeScope).
-- Managed from IAM → Org & Workflow → the role editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.role_contact_type_access (
  role_id       UUID        PRIMARY KEY
                REFERENCES shared.roles (role_id) ON DELETE CASCADE,
  -- Allow-list of contact_type values this role may see. Empty = sees none.
  contact_types TEXT[]      NOT NULL DEFAULT '{}'
                CHECK (contact_types <@ ARRAY[
                  'customer','supplier','staff','retail_partner','stylist_partner'
                ]::text[]),
  updated_by    UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE shared.role_contact_type_access IS
  'Per-role allow-list of contact_type values a role may see (contacts §6.12). '
  'No row = unrestricted (sees every type); a row restricts to contact_types '
  '(empty = none). Effective per user = union across their brand-active roles.';
COMMENT ON COLUMN shared.role_contact_type_access.contact_types IS
  'Subset of customer|supplier|staff|retail_partner|stylist_partner. Empty = none.';

-- Intentionally NO seed rows: absence = unrestricted, so this migration is a
-- pure additive no-op for every existing role until an admin opts a role in.
