-- ============================================================
-- 000209_shared_login_appearance
--
-- Dynamic, DB-driven LOGIN PAGE plumbing. The login page is the one
-- pre-auth surface the brand controls end-to-end; today its hero copy,
-- rotating quotes, "Pixie Standard" cards, per-continent welcome and
-- the various feature toggles are hardcoded in the frontend. This
-- migration moves all of it into the DB so an admin edits it through
-- the Appearance UI (Layer-A) without a deploy.
--
-- Three concerns, all idempotent:
--
--  1. shared.platform_settings.login_config (JSONB)
--     The whole login-page content bag: hero, quotes[], standards[],
--     region_messages{} keyed by continent code, toggles{}, background{}.
--     Read by the unauthenticated /api/public/branding feed (→
--     data.platform.login_config) and the per-IP /api/public/geo-welcome.
--     Seeded once (only when still '{}') so a re-apply never clobbers an
--     admin's edits.
--
--  2. shared.business_config.website
--     The public storefront URL surfaced on the login page's brand
--     badges ("Visit pixiegirlglobal.com"). The column already exists
--     (000002); we only backfill the two seed brands when still blank.
--
--  3. shared.users — PIN credentials
--     A 6-digit PIN is a second, low-friction login factor for returning
--     staff on shared/kiosk devices. Stored as an argon2 hash with its
--     own failure counter (mirrors failed_login_count) so a brute-forced
--     PIN locks the account just like a brute-forced password.
--
-- Fully idempotent: ADD COLUMN IF NOT EXISTS, and every UPDATE is scoped
-- to rows still carrying the default/blank value.
-- ============================================================

-- ── 1. shared.platform_settings.login_config ────────────────
ALTER TABLE shared.platform_settings
  ADD COLUMN IF NOT EXISTS login_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Seed the login-page content once. Scoped to the still-empty case so a
-- re-apply (or an admin's later edit) is never overwritten. Dollar-quoted
-- string literals keep the prose free of single-quote escaping headaches.
UPDATE shared.platform_settings
SET login_config = jsonb_build_object(
  'hero', jsonb_build_object(
    'eyebrow',  $q$PIXIE GIRL HUB$q$,
    'headline', $q$Where beauty becomes an operation.$q$,
    'subline',  $q$One command center for Pixie Girl Global and Faitlyn Hair — sales, stylists, stock, and storefronts, in concert.$q$,
    'cta_label', $q$Access Hub$q$
  ),
  'quotes', jsonb_build_array(
    jsonb_build_object('text', $q$Luxury is care made visible.$q$, 'author', $q$Pixie Girl$q$),
    jsonb_build_object('text', $q$Craft is patience that learned to show.$q$, 'author', $q$The House$q$),
    jsonb_build_object('text', $q$Two brands, one vision — beauty without compromise.$q$, 'author', $q$Pixie Girl$q$),
    jsonb_build_object('text', $q$The finest hair is chosen, never settled for.$q$, 'author', $q$The House$q$),
    jsonb_build_object('text', $q$Excellence is a habit we practise in private.$q$, 'author', $q$Pixie Girl$q$),
    jsonb_build_object('text', $q$Quality means nothing if it cannot be repeated.$q$, 'author', $q$The House$q$),
    jsonb_build_object('text', $q$We dress confidence, not just hair.$q$, 'author', $q$Faitlyn Hair$q$),
    jsonb_build_object('text', $q$Built in Africa, made for the world.$q$, 'author', $q$Pixie Girl$q$),
    jsonb_build_object('text', $q$Details are not the small things; they are the only things.$q$, 'author', $q$Charles Eames$q$),
    jsonb_build_object('text', $q$Simplicity is the keynote of all true elegance.$q$, 'author', $q$Coco Chanel$q$),
    jsonb_build_object('text', $q$Quality is never an accident; it is always intelligent effort.$q$, 'author', $q$John Ruskin$q$),
    jsonb_build_object('text', $q$Style is a way to say who you are without speaking.$q$, 'author', $q$Rachel Zoe$q$),
    jsonb_build_object('text', $q$Momentum is the reward for showing up, finished or not.$q$, 'author', $q$The House$q$),
    jsonb_build_object('text', $q$Beauty begins the moment you decide to be yourself.$q$, 'author', $q$Coco Chanel$q$),
    jsonb_build_object('text', $q$A house is known by the standards it refuses to lower.$q$, 'author', $q$Pixie Girl$q$),
    jsonb_build_object('text', $q$Trust is the only currency a craftsman truly banks.$q$, 'author', $q$The House$q$),
    jsonb_build_object('text', $q$Provenance is a promise you can trace.$q$, 'author', $q$Pixie Girl$q$),
    jsonb_build_object('text', $q$The continent is rising; we intend to be dressed for it.$q$, 'author', $q$Faitlyn Hair$q$),
    jsonb_build_object('text', $q$Make it beautiful, then make it work — never the other way around.$q$, 'author', $q$The House$q$),
    jsonb_build_object('text', $q$One vision, carried forward — always forward.$q$, 'author', $q$Pixie Girl$q$)
  ),
  'standards', jsonb_build_array(
    jsonb_build_object(
      'icon',  'sparkles',
      'title', 'Crafted, not assembled',
      'body',  'Every Pixie Girl and Faitlyn piece is finished by hand to a standard we would wear ourselves.'
    ),
    jsonb_build_object(
      'icon',  'heart-handshake',
      'title', 'Relationships before transactions',
      'body',  'Clients, stylists and partners are kept, not closed — trust is the longest-lasting product we make.'
    ),
    jsonb_build_object(
      'icon',  'gem',
      'title', 'Provenance you can trust',
      'body',  'Quality hair and beauty, sourced with care and traceable from origin to your hands.'
    ),
    jsonb_build_object(
      'icon',  'trending-up',
      'title', 'Two brands, one momentum',
      'body',  'Pixie Girl Global and Faitlyn Hair move as one house — always forward, always together.'
    )
  ),
  'region_messages', jsonb_build_object(
    'AF', jsonb_build_object(
      'welcome', 'Welcome from Africa',
      'note',    'Built in Lagos, dressing the continent — Pixie Girl and Faitlyn carry African beauty to the world.'
    ),
    'AS', jsonb_build_object(
      'welcome', 'Welcome from Asia',
      'note',    'From the ateliers of Asia to our clients — the craft that travels furthest is the one made with care.'
    ),
    'EU', jsonb_build_object(
      'welcome', 'Welcome from Europe',
      'note',    'Old-world craft, new-world reach — beauty held to a standard that never goes out of fashion.'
    ),
    'NA', jsonb_build_object(
      'welcome', 'Welcome from North America',
      'note',    'Two brands, one vision, delivered to your door — operations and elegance in equal measure.'
    ),
    'SA', jsonb_build_object(
      'welcome', 'Welcome from South America',
      'note',    'Warmth, colour and craft — Pixie Girl and Faitlyn meet you where beauty already lives.'
    ),
    'OC', jsonb_build_object(
      'welcome', 'Welcome from Oceania',
      'note',    'Distance is no excuse for compromise — the same care, carried clear across the sea.'
    ),
    'AN', jsonb_build_object(
      'welcome', 'Welcome from afar',
      'note',    'However remote your corner of the world, the standard travels with you.'
    ),
    'default', jsonb_build_object(
      'welcome', 'Welcome',
      'note',    'Two brands, one vision — always forward.'
    )
  ),
  'toggles', jsonb_build_object(
    'splash',          true,
    'particles',       true,
    'quotes',          true,
    'standards',       true,
    'pin_login',       true,
    'website_links',   true,
    'geo_welcome',     true,
    'business_badges', true
  ),
  'background', jsonb_build_object(
    'style',     'mesh',
    'image_url', NULL
  )
)
WHERE login_config = '{}'::jsonb OR login_config IS NULL;

-- ── 2. shared.business_config.website (backfill seed brands) ─
UPDATE shared.business_config
SET website = 'https://pixiegirlglobal.com'
WHERE business_key = 'pixiegirl' AND (website IS NULL OR website = '');

UPDATE shared.business_config
SET website = 'https://thefaitlynbrand.com'
WHERE business_key = 'faitlynhair' AND (website IS NULL OR website = '');

-- ── 3. shared.users — PIN credentials ───────────────────────
ALTER TABLE shared.users
  ADD COLUMN IF NOT EXISTS pin_hash         TEXT,
  ADD COLUMN IF NOT EXISTS pin_set_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pin_failed_count INTEGER NOT NULL DEFAULT 0;
