-- ============================================================
-- 000360_shared_drop_ad_analytics
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- Retire Ad Analytics entirely. The business never connected an ad account
-- and will not: the Marketing module is now email-only (campaigns, templates,
-- segments). This drops the three ad tables (empty in every environment) and
-- purges the `ad_analytics` permission rows so the Access matrix stops
-- listing a module nothing enforces any more. The backend module, ads
-- services and the nightly ad-spend sync are removed in the same release.
--
-- Idempotent — safe to re-run.
-- ============================================================

DROP TABLE IF EXISTS shared.ad_spend_daily;
DROP TABLE IF EXISTS shared.ad_campaigns;
DROP TABLE IF EXISTS shared.ad_accounts;

DELETE FROM shared.permissions WHERE module = 'ad_analytics';

-- ============================================================
-- Verify (both should return zero rows):
--   SELECT * FROM information_schema.tables
--    WHERE table_schema = 'shared' AND table_name LIKE 'ad\_%';
--   SELECT * FROM shared.permissions WHERE module = 'ad_analytics';
-- ============================================================
