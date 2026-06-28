-- ============================================================
-- MIGRATION 000245 — Business public Instagram handle
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- Adds a single, brand-level public Instagram handle to
-- `business_config`, edited in Settings → Business Setup → Profile
-- alongside phone / email / website.
--
-- Why a first-class column (not just the Landing Studio `socials`
-- array): the handle is consumed in several places — campaign landing
-- pages, the "tag us & earn" creator flow, receipts/footers — and the
-- CEO wanted one canonical, code-free place to change it. Storing it on
-- business_config means `req.brand_config.instagram_handle` carries it
-- on every request, so any surface can read the live value with no
-- deploy when the brand rebrands.
--
-- Stored WITHOUT the leading '@' (e.g. 'faitlynhair'); consumers add the
-- '@' / build the instagram.com/<handle> URL as needed.
-- ============================================================

ALTER TABLE shared.business_config
  ADD COLUMN IF NOT EXISTS instagram_handle TEXT;

COMMENT ON COLUMN shared.business_config.instagram_handle IS
  'Public Instagram handle for this brand, stored without the leading @ '
  '(e.g. ''faitlynhair''). Set in Settings → Business Setup → Profile. '
  'Read by campaign landing pages and the creator "tag us" flow; change '
  'it there and every surface updates with no code deploy.';

-- Backfill the two launch brands' known public handles (only when unset,
-- so re-running never clobbers a CEO edit).
UPDATE shared.business_config
   SET instagram_handle = 'faitlynhair'
 WHERE business_key = 'faitlynhair'
   AND instagram_handle IS NULL;

UPDATE shared.business_config
   SET instagram_handle = 'pixiegirlg'
 WHERE business_key = 'pixiegirl'
   AND instagram_handle IS NULL;

-- ============================================================
-- Verify
--   SELECT business_key, instagram_handle FROM shared.business_config;
-- ============================================================
