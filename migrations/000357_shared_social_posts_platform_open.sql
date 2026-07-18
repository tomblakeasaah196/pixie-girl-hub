-- ============================================================
-- MIGRATION 000357 — Social posts: open the platform vocabulary
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- The simplified Social Studio (link-only calendar) logs a pasted link
-- against whichever platform the brand registered the posting account
-- under. The accounts registry has been open-vocabulary since 000340
-- (shared.social_platforms — admins add Pinterest/X/whatever from the
-- UI), but shared.social_posts still carried 000011's hardcoded
-- CHECK (platform IN ('instagram','facebook','tiktok','youtube')),
-- so a link logged for any newer platform would be rejected at the
-- database. Drop the CHECK; platform validity is enforced by the
-- application (a post's platform must resolve to a registered account —
-- social.service.js#resolveAccountId).
--
-- Idempotent: IF EXISTS guard.
-- ============================================================

ALTER TABLE shared.social_posts
  DROP CONSTRAINT IF EXISTS social_posts_platform_check;

-- ============================================================
-- Verify
-- SELECT count(*) FROM pg_constraint
-- WHERE conname = 'social_posts_platform_check';
-- Expected: 0
-- ============================================================
