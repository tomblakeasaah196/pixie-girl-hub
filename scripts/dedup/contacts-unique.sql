-- ============================================================
-- contacts-unique.sql — DELIBERATE dedupe backstop (NOT auto-run) — H-9 follow-up
--
-- shared.contacts is GLOBAL (one row per person, visible to brands via
-- visible_to_businesses). The public creation paths already find-or-create by
-- phone (storefront.repo / walk-in / order-form), so duplicates mainly come from
-- legacy data or manual admin entry. This adds the DB backstop.
--
-- Why this is a script, not a numbered migration: a UNIQUE index FAILS if the
-- table already holds duplicate phones/emails, and merging two contact records
-- is DESTRUCTIVE (and sometimes wrong — family/business numbers legitimately
-- share a phone). So: inspect first, resolve deliberately, THEN add the index.
--
--   psql "$DATABASE_URL" -f scripts/dedup/contacts-unique.sql   (inspection only)
-- ============================================================

-- 1) INSPECT — duplicate phones (resolve these before step 3).
SELECT primary_phone,
       count(*)            AS rows,
       array_agg(contact_id) AS contact_ids
  FROM shared.contacts
 WHERE primary_phone IS NOT NULL AND primary_phone <> ''
 GROUP BY primary_phone
HAVING count(*) > 1
 ORDER BY rows DESC;

-- 2) INSPECT — duplicate emails (CITEXT → case-insensitive).
SELECT email,
       count(*)            AS rows,
       array_agg(contact_id) AS contact_ids
  FROM shared.contacts
 WHERE email IS NOT NULL AND email <> ''
 GROUP BY email
HAVING count(*) > 1
 ORDER BY rows DESC;

-- 3) ENFORCE — run ONLY after the two queries above return no rows.
--    Partial indexes so NULL/blank values don't collide. Idempotent.
--
-- CREATE UNIQUE INDEX IF NOT EXISTS contacts_primary_phone_uidx
--   ON shared.contacts (primary_phone)
--   WHERE primary_phone IS NOT NULL AND primary_phone <> '';
--
-- CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_uidx
--   ON shared.contacts (email)
--   WHERE email IS NOT NULL AND email <> '';
