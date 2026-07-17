-- ============================================================
-- MIGRATION 000356 — Social Studio: richer per-platform metric sets
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- The Apify profile scrape already returns far more than a follower count for
-- every network — it was just that each platform's metrics_schema only listed
-- two numeric tiles. This widens every schema to 5–6 monitored fields and adds
-- a `type` to each spec so the card can render non-numeric data too:
--
--   count   integer stat tile (12.7k)            — followers, posts, likes …
--   decimal one-dp number                        — star rating (4.8, not 5)
--   text    short chip                           — category, industry, name …
--   bool    badge shown when true                — verified, ads running, closed
--
-- The scraper (social-scraper.service.js) coerces each plucked value by its
-- type and stores them all in social_accounts.metrics; the account card
-- (AccountsTab.tsx) renders the count/decimal specs as tiles and the text/bool
-- specs as chips/badges. `type` defaults to "count" if absent, so this is
-- purely additive — nothing else in the registry changes.
--
-- Idempotent: each UPDATE just re-sets the JSON for one platform_key.
-- ============================================================

UPDATE shared.social_platforms SET metrics_schema =
  '[{"key":"followers","label":"Followers","type":"count","aliases":["followersCount","followers_count","followers"]},
    {"key":"following","label":"Following","type":"count","aliases":["followsCount","following_count","following","followees"]},
    {"key":"posts","label":"Posts","type":"count","aliases":["postsCount","posts_count","posts","mediaCount"]},
    {"key":"verified","label":"Verified","type":"bool","aliases":["verified","isVerified"]},
    {"key":"full_name","label":"Name","type":"text","aliases":["fullName","full_name","name"]}]'::jsonb,
  updated_at = now()
WHERE platform_key = 'instagram';

UPDATE shared.social_platforms SET metrics_schema =
  '[{"key":"followers","label":"Followers","type":"count","aliases":["followers","followersCount","followers_count"]},
    {"key":"likes","label":"Page likes","type":"count","aliases":["likes","likesCount","pageLikes","likes_count"]},
    {"key":"rating","label":"Rating","type":"decimal","aliases":["rating","ratingOverall","averageRating","ratingValue"]},
    {"key":"reviews","label":"Reviews","type":"count","aliases":["ratingCount","reviewsCount","reviews_count","reviewCount"]},
    {"key":"checkins","label":"Check-ins","type":"count","aliases":["checkins","checkinsCount","checkins_count"]},
    {"key":"ads_running","label":"Ads running","type":"bool","aliases":["adStatus","ad_status","isRunningAds","hasActiveAds","adLibraryActive"]}]'::jsonb,
  updated_at = now()
WHERE platform_key = 'facebook';

UPDATE shared.social_platforms SET metrics_schema =
  '[{"key":"followers","label":"Followers","type":"count","aliases":["fans","followerCount","followers"]},
    {"key":"likes","label":"Likes","type":"count","aliases":["heartCount","hearts","heart","diggCount","likes"]},
    {"key":"videos","label":"Videos","type":"count","aliases":["videoCount","videosCount","videos","awemeCount"]},
    {"key":"verified","label":"Verified","type":"bool","aliases":["verified","isVerified"]},
    {"key":"bio_link","label":"Bio link","type":"text","aliases":["bioLink","signatureLink","link","bio_link"]}]'::jsonb,
  updated_at = now()
WHERE platform_key = 'tiktok';

UPDATE shared.social_platforms SET metrics_schema =
  '[{"key":"subscribers","label":"Subscribers","type":"count","aliases":["subscriberCount","numberOfSubscribers","subscribers"]},
    {"key":"views","label":"Total views","type":"count","aliases":["viewCount","channelTotalViews","views","channelViewCount"]},
    {"key":"videos","label":"Videos","type":"count","aliases":["channelTotalVideos","videosCount","videoCount","videos"]},
    {"key":"joined","label":"Joined","type":"text","aliases":["channelJoinedDate","joinedDate","joined","signupDate"]},
    {"key":"location","label":"Location","type":"text","aliases":["channelLocation","country","location"]}]'::jsonb,
  updated_at = now()
WHERE platform_key = 'youtube';

UPDATE shared.social_platforms SET metrics_schema =
  '[{"key":"followers","label":"Followers","type":"count","aliases":["followers","followersCount","followers_count"]},
    {"key":"tweets","label":"Posts","type":"count","aliases":["statusesCount","tweetsCount","posts","statuses_count"]},
    {"key":"media","label":"Media","type":"count","aliases":["mediaCount","media_count","media"]},
    {"key":"likes","label":"Likes","type":"count","aliases":["favouritesCount","favoritesCount","likesCount","likes"]},
    {"key":"verified","label":"Verified","type":"bool","aliases":["isBlueVerified","isVerified","verified","blueVerified"]}]'::jsonb,
  updated_at = now()
WHERE platform_key = 'x';

UPDATE shared.social_platforms SET metrics_schema =
  '[{"key":"followers","label":"Followers","type":"count","aliases":["followers","followerCount","followersCount","followers_count"]},
    {"key":"pins","label":"Pins","type":"count","aliases":["pinCount","pinsCount","pins","pin_count"]},
    {"key":"boards","label":"Boards","type":"count","aliases":["boardCount","boardsCount","boards","board_count"]},
    {"key":"monthly_views","label":"Monthly views","type":"count","aliases":["monthlyViews","monthly_views","views"]}]'::jsonb,
  updated_at = now()
WHERE platform_key = 'pinterest';

UPDATE shared.social_platforms SET metrics_schema =
  '[{"key":"followers","label":"Followers","type":"count","aliases":["followersCount","followers_count","followers"]},
    {"key":"employees","label":"Employees","type":"count","aliases":["employeeCount","employeesCount","staffCount","employees"]},
    {"key":"industry","label":"Industry","type":"text","aliases":["industry","industryName"]},
    {"key":"company_size","label":"Company size","type":"text","aliases":["companySize","staffCountRange","employeeCountRange","sizeRange"]},
    {"key":"specialties","label":"Specialties","type":"text","aliases":["specialties","specialities"]}]'::jsonb,
  updated_at = now()
WHERE platform_key = 'linkedin';

UPDATE shared.social_platforms SET metrics_schema =
  '[{"key":"rating","label":"Rating","type":"decimal","aliases":["totalScore","rating","averageRating"]},
    {"key":"reviews","label":"Reviews","type":"count","aliases":["reviewsCount","reviews_count","userRatingCount","reviewCount"]},
    {"key":"photos","label":"Photos","type":"count","aliases":["imagesCount","photosCount","imageCount","photos"]},
    {"key":"category","label":"Category","type":"text","aliases":["categoryName","category","categories"]},
    {"key":"address","label":"Address","type":"text","aliases":["address","fullAddress","formattedAddress","street"]},
    {"key":"phone","label":"Phone","type":"text","aliases":["phone","phoneNumber","internationalPhoneNumber","phoneUnformatted"]},
    {"key":"closed","label":"Closed","type":"bool","aliases":["permanentlyClosed","temporarilyClosed","closed"]}]'::jsonb,
  updated_at = now()
WHERE platform_key = 'google_business';

-- ============================================================
-- Verify
-- SELECT platform_key, jsonb_array_length(metrics_schema) AS metric_count
--   FROM shared.social_platforms
--  WHERE platform_key IN ('instagram','facebook','tiktok','youtube','x',
--                         'pinterest','linkedin','google_business')
--  ORDER BY sort_order;
-- Expected: 5,6,5,5,5,4,5,7 metrics respectively.
-- ============================================================
