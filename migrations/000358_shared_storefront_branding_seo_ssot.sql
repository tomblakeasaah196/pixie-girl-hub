-- ============================================================
-- 000358_shared_storefront_branding_seo_ssot
-- Pixie Girl Hub · JBS Praxis
--
-- Storefront Studio: the Branding tab is now the SINGLE SOURCE OF TRUTH for the
-- home page's share card (OG/meta title, description and banner). The Pages-tab
-- "Search & sharing (SEO)" fields were the second, conflicting place — for the
-- home page they shadowed the brand-level Branding tokens, so a composed Share
-- banner never reached WhatsApp/Facebook (the seeded per-page hero won instead).
--
-- The storefront now resolves the home card from the Branding tokens first, so
-- this migration backfills those tokens from each business's existing home-page
-- SEO wherever they are still empty. That keeps the Branding tab showing the
-- real live values (not blanks) after the home page's per-page fields were
-- consolidated away, and guarantees no regression in the shared title/text.
--
-- The composed --og-image banner token is left untouched (operators set it in
-- Studio; if unset, the storefront still falls back to the home page image).
-- Idempotent: only fills og_title / og_description that are absent or empty,
-- and updating an already-published theme row does not fire the publish
-- snapshot trigger (it guards on OLD.status = 'published').
-- ============================================================

WITH home AS (
  SELECT DISTINCT ON (business)
         business,
         NULLIF(meta_title, '')      AS meta_title,
         NULLIF(meta_description, '') AS meta_description
  FROM shared.storefront_pages
  WHERE page_key = 'home'
  ORDER BY business, (status = 'published') DESC, updated_at DESC
)
UPDATE shared.storefront_themes AS th
SET tokens = COALESCE(th.tokens, '{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
       'og_title',
         CASE WHEN COALESCE(th.tokens->>'og_title', '') = ''
              THEN home.meta_title END,
       'og_description',
         CASE WHEN COALESCE(th.tokens->>'og_description', '') = ''
              THEN home.meta_description END
     ))
FROM home
WHERE home.business = th.business
  AND th.status IN ('draft', 'published')
  AND (
        (COALESCE(th.tokens->>'og_title', '') = ''
           AND home.meta_title IS NOT NULL)
     OR (COALESCE(th.tokens->>'og_description', '') = ''
           AND home.meta_description IS NOT NULL)
  );
