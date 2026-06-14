-- ============================================================
-- 000208_shared_platform_appearance
--
-- White-label / appearance plumbing — answers the canon's open
-- `shared.app_appearance` flag (AppearancePage today writes nowhere).
--
-- Three concerns in one migration:
--
--  1. shared.platform_settings (singleton)
--     LAYER A — the deployment's own identity. Product name, tagline,
--     logos, favicon, fonts (display/body/mono + optional external CSS
--     URL for non-bundled families), and a `theme` JSONB carrying the
--     "R G B" token triplets per mode (dark / light). Read by the
--     unauthenticated /api/branding endpoint so the login page can
--     theme itself before any token exists.
--
--  2. shared.font_catalog
--     The curated picker the Appearance UI surfaces — common ERP /
--     web / document families with their loader URLs. Admins can also
--     paste a custom Google Fonts (or other allow-listed host) URL on
--     platform_settings.font_css_url; the catalogue keeps the 95%-case
--     friction-free.
--
--  3. shared.business_config — branding columns
--     LAYER B — per-business identity used everywhere the brand shows:
--     login switcher, app chip / ambient wash, plus email templates and
--     every PDF (Invoices, POs, Delivery Notes, Receipts, Contracts).
--     `brand_theme` carries the gradient + accent ramp so a Pixie doc
--     looks Pixie and a Faitlyn doc looks Faitlyn without code changes.
--
-- All UPDATE / INSERT is idempotent so the migration can be re-applied
-- safely (it only ever writes the seed values when the row is missing
-- or the column is null).
-- ============================================================

-- ── 1. shared.platform_settings ─────────────────────────────
CREATE TABLE IF NOT EXISTS shared.platform_settings (
  settings_id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Singleton guard — only one row is ever permitted (see unique index below).
  singleton             BOOLEAN      NOT NULL DEFAULT true,
  product_name          TEXT         NOT NULL DEFAULT 'Pixie Girl Hub',
  tagline               TEXT,
  company_name          TEXT,
  -- Logo for use on dark surfaces (the cream / white version of the mark).
  logo_dark_url         TEXT,
  -- Logo for use on light surfaces (the inked / red version of the mark).
  logo_light_url        TEXT,
  favicon_url           TEXT,
  -- Font family stack — quoted family name first, then web-safe fallback.
  font_display          TEXT         NOT NULL DEFAULT '"Playfair Display", Georgia, serif',
  font_body             TEXT         NOT NULL DEFAULT '"Montserrat", system-ui, sans-serif',
  font_mono             TEXT         NOT NULL DEFAULT '"JetBrains Mono", monospace',
  -- Optional external stylesheet URL (Google Fonts / Bunny Fonts / etc.).
  -- Restricted to an allow-list of trusted hosts in the service validator.
  font_css_url          TEXT,
  -- The token bag. Keys are constrained by the service-layer allow-list
  -- so a typo can't inject an arbitrary CSS variable name; values are
  -- "R G B" triplets (matches Tailwind's rgb(var(--x)/alpha) usage) or
  -- numeric strings for the alpha / opacity scalars.
  theme                 JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by            UUID         REFERENCES shared.users (user_id) ON DELETE SET NULL
);

-- Enforce the singleton: every row carries singleton=true on the
-- unique index, so any second insert collides.
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_settings_singleton
  ON shared.platform_settings ((singleton));

DROP TRIGGER IF EXISTS trg_platform_settings_updated_at ON shared.platform_settings;
CREATE TRIGGER trg_platform_settings_updated_at
  BEFORE UPDATE ON shared.platform_settings
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();

-- Seed the singleton with the client-approved Maroon Noir palette
-- (canon §2). Re-running the migration is a no-op: ON CONFLICT skips
-- the insert when the row already exists.
INSERT INTO shared.platform_settings
  (singleton, product_name, tagline, company_name, theme)
VALUES (
  true,
  'Pixie Girl Hub',
  'Operations · Sales · Stylists · Storefronts',
  'Pixie Girl Global',
  jsonb_build_object(
    'dark', jsonb_build_object(
      'bg',           '15 8 9',
      'panel',        '26 15 17',
      'panel-2',      '39 22 25',
      'text',         '244 233 217',
      'text-muted',   '179 164 155',
      'text-faint',   '128 112 107',
      'border-c',     '244 233 217',
      'accent',       '168 29 29',
      'accent-deep',  '105 9 9',
      'accent-glow',  '216 92 87',
      'sage',         '127 160 106',
      'rose',         '233 122 126',
      'info',         '110 134 168',
      'success',      '127 160 106',
      'warn',         '201 162 75',
      'danger',       '229 84 78',
      'panel-alpha',  '0.55',
      'border-alpha', '0.08',
      'mesh-op',      '1'
    ),
    'light', jsonb_build_object(
      'bg',           '251 250 249',
      'panel',        '255 255 255',
      'panel-2',      '244 241 238',
      'text',         '26 16 17',
      'text-muted',   '107 94 92',
      'text-faint',   '155 142 138',
      'border-c',     '26 16 17',
      'accent',       '105 9 9',
      'accent-deep',  '105 9 9',
      'accent-glow',  '140 20 20',
      'sage',         '94 126 80',
      'rose',         '201 90 96',
      'info',         '24 120 185',
      'success',      '94 126 80',
      'warn',         '185 138 46',
      'danger',       '199 54 47',
      'panel-alpha',  '0.74',
      'border-alpha', '0.10',
      'mesh-op',      '0.36'
    )
  )
)
ON CONFLICT ((singleton)) DO NOTHING;

-- ── 2. shared.font_catalog ──────────────────────────────────
-- The picker's curated list. `loader_url` is the stylesheet the
-- frontend injects when the family is chosen; NULL means the family
-- is already bundled (system / native stacks). `category` lets the
-- UI group by Display / Sans / Serif / Mono so admins find what
-- they want fast.
CREATE TABLE IF NOT EXISTS shared.font_catalog (
  font_id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  family                TEXT         NOT NULL UNIQUE,
  -- The CSS font-family value (with fallback). Stored ready-to-use
  -- so the UI doesn't have to assemble it.
  css_value             TEXT         NOT NULL,
  loader_url            TEXT,
  -- 'display' = headlines, 'sans' = body sans, 'serif' = body serif,
  -- 'mono' = code; the picker filters by these.
  category              TEXT         NOT NULL
                        CHECK (category IN ('display','sans','serif','mono')),
  -- Where the family is typically used — surfaces it as a hint in the
  -- picker ("Common on ERPs", "Document-friendly", etc.).
  use_hint              TEXT,
  is_active             BOOLEAN      NOT NULL DEFAULT true,
  display_order         INT          NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_font_catalog_category_order
  ON shared.font_catalog (category, display_order);

-- Curated families — Google Fonts hosted (DNS-prefetched on first load).
-- Categories chosen to cover the four roles the Appearance UI exposes:
-- display (headlines), sans (body), serif (long-form), mono (numerics).
INSERT INTO shared.font_catalog (family, css_value, loader_url, category, use_hint, display_order) VALUES
  -- DISPLAY (headlines / hero / chip)
  ('Playfair Display', '"Playfair Display", Georgia, serif',
    'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap',
    'display', 'Editorial · luxury · documents', 1),
  ('Cormorant Garamond', '"Cormorant Garamond", Georgia, serif',
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&display=swap',
    'display', 'Refined serif · invitations · receipts', 2),
  ('DM Serif Display', '"DM Serif Display", Georgia, serif',
    'https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap',
    'display', 'Modern luxury · marketing', 3),
  ('Fraunces', '"Fraunces", Georgia, serif',
    'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap',
    'display', 'Editorial · variable display', 4),

  -- SANS (body / UI / data)
  ('Inter', '"Inter", system-ui, sans-serif',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    'sans', 'Industry default · ERPs · dashboards', 1),
  ('Montserrat', '"Montserrat", system-ui, sans-serif',
    'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap',
    'sans', 'Geometric · marketing · brand', 2),
  ('Manrope', '"Manrope", system-ui, sans-serif',
    'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap',
    'sans', 'Modern · clean · product UI', 3),
  ('DM Sans', '"DM Sans", system-ui, sans-serif',
    'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap',
    'sans', 'Friendly · ledger · forms', 4),
  ('Plus Jakarta Sans', '"Plus Jakarta Sans", system-ui, sans-serif',
    'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
    'sans', 'Soft geometric · admin tools', 5),
  ('System UI (native)', 'system-ui, -apple-system, "Segoe UI", sans-serif',
    NULL,
    'sans', 'No download · OS-native', 99),

  -- SERIF (long-form / docs / contracts)
  ('Source Serif Pro', '"Source Serif Pro", Georgia, serif',
    'https://fonts.googleapis.com/css2?family=Source+Serif+Pro:wght@400;500;600;700&display=swap',
    'serif', 'Contracts · long-form', 1),
  ('Lora', '"Lora", Georgia, serif',
    'https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&display=swap',
    'serif', 'Friendly serif · invoices', 2),

  -- MONO (numerics / SKUs / IDs)
  ('JetBrains Mono', '"JetBrains Mono", monospace',
    'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap',
    'mono', 'Code · SKUs · IDs', 1),
  ('IBM Plex Mono', '"IBM Plex Mono", monospace',
    'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap',
    'mono', 'Numerics · ledgers', 2)
ON CONFLICT (family) DO NOTHING;


-- ── 3. shared.business_config — branding columns ────────────
ALTER TABLE shared.business_config
  ADD COLUMN IF NOT EXISTS secondary_colour     TEXT,
  ADD COLUMN IF NOT EXISTS logo_alt_path        TEXT,
  ADD COLUMN IF NOT EXISTS favicon_path         TEXT,
  -- The structured per-brand palette used by emails, documents
  -- (Invoices, POs, Delivery Notes, Receipts, Contracts) AND the
  -- shell's Layer-B wash. Free-form so a brand can add new tokens
  -- without a schema change, but the service layer allow-lists keys.
  ADD COLUMN IF NOT EXISTS brand_theme          JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill the two seed brands if they exist (idempotent — the
-- updates are scoped to rows that are still on the default '#0A1128'
-- accent OR have no brand_theme yet). Faitlyn gets her bronze; Pixie
-- gets her deep red. These mirror the frontend BUSINESSES seed so the
-- DB takes over from the hardcoded array without a visual jump.
UPDATE shared.business_config
SET accent_colour      = '#690909',
    secondary_colour   = COALESCE(secondary_colour, '#A81D1D'),
    brand_theme        = COALESCE(NULLIF(brand_theme, '{}'::jsonb), jsonb_build_object(
      'grad1',       '#a81d1d',
      'grad2',       '#690909',
      'accent',      '#690909',
      'accent_deep', '#3a0505'
    )),
    brand_fonts        = COALESCE(NULLIF(brand_fonts, '{}'::jsonb), jsonb_build_object(
      'display', '"Playfair Display", Georgia, serif',
      'body',    '"Montserrat", system-ui, sans-serif'
    ))
WHERE business_key = 'pixiegirl';

UPDATE shared.business_config
SET accent_colour      = '#7F703D',
    secondary_colour   = COALESCE(secondary_colour, '#D5B8A4'),
    brand_theme        = COALESCE(NULLIF(brand_theme, '{}'::jsonb), jsonb_build_object(
      'grad1',       '#7f703d',
      'grad2',       '#d5b8a4',
      'accent',      '#7f703d',
      'accent_deep', '#5b4f2a'
    )),
    brand_fonts        = COALESCE(NULLIF(brand_fonts, '{}'::jsonb), jsonb_build_object(
      'display', '"Cormorant Garamond", Georgia, serif',
      'body',    '"Inter", system-ui, sans-serif'
    ))
WHERE business_key = 'faitlynhair';
