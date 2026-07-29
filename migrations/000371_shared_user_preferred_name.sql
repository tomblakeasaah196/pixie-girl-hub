-- ============================================================
-- MIGRATION 000371 — Personal display-name alias (isolation)
-- Pixie Girl Hub · V2.2
--
-- Splits the self-service "Display name" a user can edit on their
-- own profile away from the canonical name of record.
--
-- Before this migration, the profile "Display name" edit wrote
-- shared.users.display_name — the SAME column ~30 modules join for
-- "created by / assigned / actor" names, plus IAM, the org chart
-- holder resolution, and audit snapshots. So a user renaming
-- themselves silently changed how their name appeared across the
-- whole system, and even overrode their official HR name in the
-- admin Users & Access list.
--
-- New model (two clearly separated fields on shared.users):
--   • display_name    — the CANONICAL name of record. Seeded from the
--                       linked contact (staff) or set by an admin at
--                       provisioning (external users). Read everywhere
--                       a person is shown to others. NEVER written by
--                       the self-service profile edit again.
--   • preferred_name  — the NEW personal display alias. Self-editable
--                       from My Profile. Surfaces ONLY in the user's
--                       own header chip + their own profile. Nothing
--                       else joins it, so editing it can never change
--                       the user's name anywhere on the system.
--
-- Data backfill (safe to re-run — the first copy is guarded on NULL):
--   1. Preserve each account's current label as its personal alias.
--   2. Reset display_name to the official name of record (the linked
--      contact's display_name) for staff, purging any alias that a
--      prior self-edit had already baked into the canonical column.
--      External users (no linked contact) keep their admin-set
--      display_name untouched.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; the alias copy only fills
-- rows where preferred_name is still NULL; the canonical reset is a
-- set-to-same-value no-op on any subsequent run.
-- ============================================================

-- ── shared.users: personal display alias ───────────────────
ALTER TABLE shared.users
  ADD COLUMN IF NOT EXISTS preferred_name TEXT;

-- 1) Preserve the current label as the personal alias (once).
UPDATE shared.users
   SET preferred_name = display_name
 WHERE preferred_name IS NULL;

-- 2) Restore the canonical display_name to the official name of record
--    (the linked contact) for staff accounts, so the field every other
--    surface reads is the immutable official name rather than any alias
--    a previous self-edit had written into it.
UPDATE shared.users u
   SET display_name = c.display_name
  FROM shared.staff_profiles sp
  JOIN shared.contacts c ON c.contact_id = sp.contact_id
 WHERE u.staff_profile_id = sp.profile_id
   AND c.display_name IS NOT NULL
   AND c.display_name <> ''
   AND u.display_name IS DISTINCT FROM c.display_name;
