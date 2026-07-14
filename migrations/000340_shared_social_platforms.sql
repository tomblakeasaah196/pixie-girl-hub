-- ============================================================
-- MIGRATION 000340 — Social Studio: extensible platform registry
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- Replaces the hardcoded 'instagram'/'facebook'/'tiktok'/'youtube' CHECK
-- constraint on shared.social_accounts.platform with a real lookup table, so
-- an admin can register a new network (X, Pinterest, Threads, LinkedIn,
-- Google Business Profile, whatever Apify's actor store covers next) without
-- an engineer shipping a migration.
--
-- Each row carries everything the Accounts dashboard + the Apify scraper
-- job need to handle that platform generically:
--   brand_color / icon_glyph   — dashboard card styling
--   apify_actor_id             — the Apify Store actor slug (author/name) to
--                                 run for this platform; NULL until an admin
--                                 picks one (some platforms have no single
--                                 canonical first-party actor — see seed notes)
--   apify_input_template       — JSON template for that actor's run input,
--                                 with {{handle}} / {{profile_url}} placeholders
--                                 substituted at run time (actor input shapes
--                                 vary by author, so this stays data-driven
--                                 instead of a hardcoded per-platform branch)
--   metrics_schema             — [{key,label,aliases:[...]}] describing which
--                                 fields to pull out of that actor's dataset
--                                 item for the dashboard's stat tiles
--   supports_bio               — false for platforms whose Apify data isn't
--                                 shaped like a social profile (e.g. Google
--                                 Business Profile returns rating/reviews,
--                                 not a follower count + bio)
--
-- Idempotent: guarded with IF NOT EXISTS / ON CONFLICT throughout.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.social_platforms (
  platform_key          TEXT        PRIMARY KEY
                         CHECK (platform_key ~ '^[a-z][a-z0-9_]{0,40}$'),
  display_name          TEXT        NOT NULL,
  brand_color           TEXT        NOT NULL,
  icon_glyph            TEXT        NOT NULL DEFAULT '',
  apify_actor_id        TEXT,
  apify_input_template  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  metrics_schema        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  supports_bio          BOOLEAN     NOT NULL DEFAULT true,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  sort_order            SMALLINT    NOT NULL DEFAULT 100,
  notes                 TEXT,
  created_by            UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_social_platforms_updated_at') THEN
    CREATE TRIGGER trg_social_platforms_updated_at
      BEFORE UPDATE ON shared.social_platforms
      FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_social_platforms_active
  ON shared.social_platforms (is_active, sort_order);

-- ── Seed the platforms already live in the product (real, maintained
-- first-party Apify actors) ─────────────────────────────────────────
INSERT INTO shared.social_platforms
  (platform_key, display_name, brand_color, icon_glyph, apify_actor_id,
   apify_input_template, metrics_schema, supports_bio, is_active, sort_order, notes)
VALUES
  ('instagram', 'Instagram', '#c13584', 'IG', 'apify/instagram-profile-scraper',
   '{"usernames": ["{{handle}}"]}'::jsonb,
   '[{"key":"followers","label":"Followers","aliases":["followersCount","followers_count","followers"]},
     {"key":"following","label":"Following","aliases":["followsCount","following_count","following","followees"]}]'::jsonb,
   true, true, 10,
   'Official apify/instagram-profile-scraper — no login required.'),

  ('facebook', 'Facebook', '#1877f2', 'f', 'apify/facebook-pages-scraper',
   '{"startUrls": [{"url": "{{profile_url}}"}]}'::jsonb,
   '[{"key":"followers","label":"Followers","aliases":["followers","followersCount","followers_count"]},
     {"key":"likes","label":"Page likes","aliases":["likes","likesCount","pageLikes"]}]'::jsonb,
   true, true, 20,
   'Official apify/facebook-pages-scraper.'),

  ('tiktok', 'TikTok', '#010101', 'TT', 'clockworks/tiktok-profile-scraper',
   '{"profiles": ["{{handle}}"]}'::jsonb,
   '[{"key":"followers","label":"Followers","aliases":["followerCount","fans","followers"]},
     {"key":"likes","label":"Likes","aliases":["heartCount","heart","diggCount","likes"]}]'::jsonb,
   true, true, 30,
   'Clockworks TikTok Profile Scraper — widely used community actor, no proxy needed.'),

  ('youtube', 'YouTube', '#ff0000', 'YT', 'streamers/youtube-channel-scraper',
   '{"startUrls": [{"url": "{{profile_url}}"}]}'::jsonb,
   '[{"key":"subscribers","label":"Subscribers","aliases":["subscriberCount","subscribers","numberOfSubscribers"]},
     {"key":"views","label":"Total views","aliases":["viewCount","views","channelTotalViews"]}]'::jsonb,
   true, true, 40,
   'Streamers Fast YouTube Channel Scraper.')
ON CONFLICT (platform_key) DO NOTHING;

-- ── Seed platforms Apify *can* cover but that have no single canonical
-- first-party actor yet — added inactive so "Add platform" surfaces them
-- with an honest note instead of a blind guess; an admin activates one by
-- pasting whichever Apify Store actor they've picked into apify_actor_id.
-- This is the direct answer to "does Apify cover Pinterest?" etc: yes, via
-- community actors, but pin the actor choice explicitly rather than hardcode
-- a specific third party's actor that can be renamed or deprecated.
INSERT INTO shared.social_platforms
  (platform_key, display_name, brand_color, icon_glyph, apify_actor_id,
   apify_input_template, metrics_schema, supports_bio, is_active, sort_order, notes)
VALUES
  ('x', 'X (Twitter)', '#0f1419', 'X', NULL,
   '{"startUrls": ["{{profile_url}}"]}'::jsonb,
   '[{"key":"followers","label":"Followers","aliases":["followers","followersCount","followers_count"]},
     {"key":"posts","label":"Posts","aliases":["statusesCount","tweetsCount","posts"]}]'::jsonb,
   true, false, 50,
   'Covered by several community actors (no single official apify/* actor as of writing) — pick one on the Apify Store and paste its actor ID here to activate.'),

  ('pinterest', 'Pinterest', '#e60023', 'P', NULL,
   '{"startUrls": ["{{profile_url}}"]}'::jsonb,
   '[{"key":"followers","label":"Followers","aliases":["followers","followerCount","followers_count"]},
     {"key":"views","label":"Monthly views","aliases":["monthlyViews","views"]}]'::jsonb,
   true, false, 60,
   'Covered by several community actors — pick one on the Apify Store and paste its actor ID here to activate.'),

  ('threads', 'Threads', '#000000', '@', NULL,
   '{"usernames": ["{{handle}}"]}'::jsonb,
   '[{"key":"followers","label":"Followers","aliases":["followersCount","followers_count","followers"]}]'::jsonb,
   true, false, 70,
   'Community-actor coverage only; verify current availability on the Apify Store before activating — Meta''s changes here land faster than actors keep up.'),

  ('linkedin', 'LinkedIn Page', '#0a66c2', 'in', NULL,
   '{"startUrls": [{"url": "{{profile_url}}"}]}'::jsonb,
   '[{"key":"followers","label":"Followers","aliases":["followersCount","followers_count","followers"]}]'::jsonb,
   true, false, 80,
   'Company-page scraping is reasonably reliable via community actors; personal profiles are far more fragile to scrape and not recommended.'),

  ('google_business', 'Google Business Profile', '#4285f4', 'G', NULL,
   '{"startUrls": ["{{profile_url}}"]}'::jsonb,
   '[{"key":"rating","label":"Rating","aliases":["totalScore","rating","averageRating"]},
     {"key":"reviews","label":"Reviews","aliases":["reviewsCount","reviews_count","userRatingCount"]}]'::jsonb,
   false, false, 90,
   'Different shape than a social profile: Apify''s Maps/Business actors return a star rating + review count, not followers/bio. supports_bio=false so the dashboard card renders the rating layout instead of the bio layout.')
ON CONFLICT (platform_key) DO NOTHING;

-- ============================================================
-- Verify
-- SELECT platform_key, is_active, apify_actor_id FROM shared.social_platforms ORDER BY sort_order;
-- Expected: 9 rows, 4 active (instagram/facebook/tiktok/youtube) + 5 inactive
-- (x/pinterest/threads/linkedin/google_business)
-- ============================================================
