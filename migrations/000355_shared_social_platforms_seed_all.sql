-- ============================================================
-- MIGRATION 000355 — Social Studio: activate + seed every platform the
--                    company actually uses, with a working Apify actor
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- 000340 shipped the platform registry with only Instagram/Facebook/TikTok/
-- YouTube *active* (they have official first-party actors) and left X,
-- Pinterest, LinkedIn, Google Business seeded but INACTIVE with a NULL
-- apify_actor_id — the deliberate "an admin picks the community actor" stance.
--
-- The business runs all eight of those networks and needs staff to be able to
-- register a handle (and get the twice-daily follower/bio scrape) on any of
-- them without hunting down an actor first. This migration flips the remaining
-- four to ACTIVE and pins a concrete, currently-published Apify Store actor +
-- the correct run-input shape + metric aliases for each, so a scrape returns
-- data out of the box instead of "no actor configured".
--
-- The actor id stays a plain column, so this is a default, not a lock-in: if a
-- community actor is ever renamed/deprecated (the reason 000340 hesitated to
-- pin one), an admin swaps it in Social Studio → Accounts → the platform's
-- record — a one-field edit, never another migration.
--
-- Actor choices (verified live on the Apify Store, Jul 2026):
--   x               apidojo/twitter-user-scraper        — followers/bio by handle
--   pinterest       web-wizard/pinterest-profile-scraper — followers/bio by URL
--   linkedin        apimaestro/linkedin-company-detail   — company followers, no login
--   google_business compass/crawler-google-places        — Apify's own Maps scraper
--
-- Idempotent: INSERT … ON CONFLICT DO UPDATE, so it seeds the row if 000340
-- somehow didn't and fixes it if it did.
-- ============================================================

-- ── The four networks that were shipped inactive: activate + pin an actor ──
INSERT INTO shared.social_platforms
  (platform_key, display_name, brand_color, icon_glyph, apify_actor_id,
   apify_input_template, metrics_schema, supports_bio, is_active, sort_order, notes)
VALUES
  ('x', 'Twitter (X)', '#0f1419', 'X', 'apidojo/twitter-user-scraper',
   '{"twitterHandles": ["{{handle}}"], "maxItems": 1}'::jsonb,
   '[{"key":"followers","label":"Followers","aliases":["followers","followersCount","followers_count"]},
     {"key":"following","label":"Following","aliases":["following","followingCount","friendsCount","following_count"]}]'::jsonb,
   true, true, 50,
   'apidojo/twitter-user-scraper — scrapes a public X profile by handle (no login). Handle is enough; a profile URL is optional.'),

  ('pinterest', 'Pinterest', '#e60023', 'P', 'web-wizard/pinterest-profile-scraper',
   '{"startUrls": ["{{profile_url}}"]}'::jsonb,
   '[{"key":"followers","label":"Followers","aliases":["followers","followerCount","followersCount","followers_count"]},
     {"key":"following","label":"Following","aliases":["following","followingCount","following_count"]}]'::jsonb,
   true, true, 60,
   'web-wizard/pinterest-profile-scraper — needs the full profile URL (set Profile URL on the handle). Pinterest blocks datacenter IPs, so this actor uses residential proxy on Apify''s side.'),

  ('linkedin', 'LinkedIn Page', '#0a66c2', 'in', 'apimaestro/linkedin-company-detail',
   '{"identifier": "{{handle}}"}'::jsonb,
   '[{"key":"followers","label":"Followers","aliases":["followersCount","followers_count","followers"]},
     {"key":"employees","label":"Employees","aliases":["employeeCount","employeesCount","staffCount"]}]'::jsonb,
   true, true, 80,
   'apimaestro/linkedin-company-detail — company pages only (no login). "identifier" is the company vanity slug in the page URL (linkedin.com/company/<slug>); set the handle to that slug. Personal profiles are not supported here.'),

  ('google_business', 'Google Business Profile', '#4285f4', 'G', 'compass/crawler-google-places',
   '{"startUrls": [{"url": "{{profile_url}}"}], "maxCrawledPlacesPerSearch": 1}'::jsonb,
   '[{"key":"rating","label":"Rating","aliases":["totalScore","rating","averageRating"]},
     {"key":"reviews","label":"Reviews","aliases":["reviewsCount","reviews_count","userRatingCount"]}]'::jsonb,
   false, true, 90,
   'compass/crawler-google-places (Apify''s own Google Maps scraper) — set Profile URL to the Google Maps place link. Returns a star rating + review count, not followers/bio, so the card renders the rating layout (supports_bio=false).')
ON CONFLICT (platform_key) DO UPDATE SET
  display_name         = EXCLUDED.display_name,
  brand_color          = EXCLUDED.brand_color,
  icon_glyph           = EXCLUDED.icon_glyph,
  apify_actor_id       = EXCLUDED.apify_actor_id,
  apify_input_template = EXCLUDED.apify_input_template,
  metrics_schema       = EXCLUDED.metrics_schema,
  supports_bio         = EXCLUDED.supports_bio,
  is_active            = true,
  sort_order           = EXCLUDED.sort_order,
  notes                = EXCLUDED.notes,
  updated_at           = now();

-- ── Retire the ad-hoc duplicate Twitter platforms an admin registered from
-- the "Add a new platform" form (auto-keyed 'twitter' / 'twitter_x') before a
-- canonical one existed — those are what showed "Actor was not found" /
-- "returned no data". Only deactivated (a plain UPDATE): a platform can't be
-- deleted while any social_accounts row still points at it (FK). Once the
-- handles on them are removed, the row can be dropped by hand. No-op if absent.
UPDATE shared.social_platforms
   SET is_active = false, updated_at = now()
 WHERE platform_key IN ('twitter', 'twitter_x');

-- ============================================================
-- Verify
-- SELECT platform_key, display_name, is_active, apify_actor_id
--   FROM shared.social_platforms ORDER BY sort_order;
-- Expected active (8): instagram, facebook, tiktok, youtube, x, pinterest,
--   linkedin, google_business — each with a non-NULL apify_actor_id.
-- (threads stays inactive; the company doesn't run it.)
-- ============================================================
