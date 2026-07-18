-- ============================================================
-- MIGRATION 000360 — Social Studio: fix TikTok metric mapping
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- clockworks/tiktok-profile-scraper returns the profile's VIDEOS as dataset
-- items; the channel-level totals live nested inside each item under
-- `authorMeta` ({fans, heart, video, verified, signature, avatar, ...}).
-- The alias scan checks top-level keys before nested ones, so the old
-- "likes" aliases matched the first video's own `diggCount` (its like
-- count — the "27 likes" bug) before ever reaching the channel's
-- `authorMeta.heart` (the real total, e.g. 3,971).
--
--   likes   -> heart/heartCount only (channel total; never the video's diggCount)
--   videos  -> authorMeta.video (the old videoCount/videos aliases matched
--              nothing, which is why the tile stayed "—")
--
-- Also caps the run at one video (resultsPerPage: 1): every item carries the
-- same authorMeta, so scraping more videos is pure Apify cost.
--
-- Idempotent: plain UPDATE by platform_key.
-- ============================================================

UPDATE shared.social_platforms SET
  apify_input_template = '{"profiles": ["{{handle}}"], "resultsPerPage": 1}'::jsonb,
  metrics_schema =
  '[{"key":"followers","label":"Followers","type":"count","aliases":["fans","followerCount","followers"]},
    {"key":"likes","label":"Likes","type":"count","aliases":["heart","heartCount"]},
    {"key":"videos","label":"Videos","type":"count","aliases":["video","videoCount","awemeCount"]},
    {"key":"verified","label":"Verified","type":"bool","aliases":["verified","isVerified"]},
    {"key":"bio_link","label":"Bio link","type":"text","aliases":["bioLink","bio_link"]}]'::jsonb,
  updated_at = now()
WHERE platform_key = 'tiktok';

-- ============================================================
-- Verify
-- SELECT metrics_schema->1 FROM shared.social_platforms WHERE platform_key='tiktok';
-- Expected: the "likes" spec with aliases ["heart","heartCount"] only.
-- ============================================================
