-- ============================================================
-- MIGRATION 000220 — Sales Campaigns v2: subdomain, brand voice,
-- ambassadors and viewer-policy plumbing on the shared schema.
-- Pixie Girl Hub · JBS Praxis · V2.2 — Sales Campaigns module PR 1
-- ============================================================
--
-- Companion brand-template additions live in
-- migrations/template/000040_business_campaign_v2.sql.template
-- (bundles, quantity tiers, cart upsells, VIP gifts, ambassador links).
-- Praxis action-catalogue and help-center seeds ship in 000221 and 000222.
--
-- What this PR adds at the shared layer:
--   1. business_config.sales_subdomain         — dynamic host for sales.* pages.
--      The new host → brand resolver middleware reads this column on every
--      public sales-page request, so a third brand can be onboarded by
--      filling the field — no code deploy.
--   2. business_config.praxis_voice_profile    — JSONB voice profile the
--      campaign-builder Praxis assistant loads as system prompt. CEO-editable
--      via Settings → Business Setup → Public Identity.
--   3. business_config.show_viewer_count_policy + viewer_count_floor
--      — per-brand defaults for the smart "X people viewing" toggle. Each
--      campaign inherits then can override.
--   4. shared.contacts.is_ambassador + ambassador_profile JSONB
--      — promote contacts to ambassadors without a new module. The campaign
--      share-kit picks ambassadors from here to mint per-link UTM trackers.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 1. business_config — sales subdomain + Praxis voice + viewer policy ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.business_config
  ADD COLUMN IF NOT EXISTS sales_subdomain         TEXT,
  ADD COLUMN IF NOT EXISTS praxis_voice_profile    JSONB NOT NULL DEFAULT '{
    "tone":          "editorial-luxury",
    "tagline_pace":  "restrained",
    "banned_words":  ["cheap", "amazing deal", "guaranteed", "best ever"],
    "no_fabricated_reviews": true,
    "exclamation_policy":    "rare",
    "sample_paragraphs":     []
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS show_viewer_count_policy TEXT
    NOT NULL DEFAULT 'smart'
    CHECK (show_viewer_count_policy IN ('smart','on','off')),
  ADD COLUMN IF NOT EXISTS viewer_count_floor      INTEGER
    NOT NULL DEFAULT 20
    CHECK (viewer_count_floor >= 0);

COMMENT ON COLUMN shared.business_config.sales_subdomain IS
  'Dynamic host for this brand''s sales landing page (e.g. sales.pixiegirlglobal.com). '
  'Read by the host → brand resolver on every public /sale/:slug request. '
  'NULL = the brand does not run a sales landing surface.';
COMMENT ON COLUMN shared.business_config.praxis_voice_profile IS
  'JSONB voice profile loaded by Praxis as a system prompt for every campaign '
  'suggestion. CEO edits in Settings → Business Setup → Public Identity.';
COMMENT ON COLUMN shared.business_config.show_viewer_count_policy IS
  'Default policy for the live "X people viewing" ticker. '
  '"smart" auto-hides count when concurrent viewers < viewer_count_floor; '
  '"on" always shows; "off" always hides. Per-campaign override allowed.';
COMMENT ON COLUMN shared.business_config.viewer_count_floor IS
  'Below this concurrent viewer count, "smart" policy hides the number and '
  'shows a "Live now" pill only. CEO-editable per brand. Default 20.';

-- Seed sensible defaults so Faitlyn opens with its own voice profile.
UPDATE shared.business_config
   SET praxis_voice_profile = jsonb_set(
         praxis_voice_profile,
         '{tone}',
         '"confident-beauty-bar"'::jsonb,
         true
       )
 WHERE business_key = 'faitlynhair';

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 2. shared.contacts — ambassador promotion                           ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE shared.contacts
  ADD COLUMN IF NOT EXISTS is_ambassador          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ambassador_profile     JSONB
    NOT NULL DEFAULT '{
      "commission_pct": 0,
      "social_handles": {},
      "since":          null
    }'::jsonb;

CREATE INDEX IF NOT EXISTS idx_shared_contacts_ambassador
  ON shared.contacts (is_ambassador)
  WHERE is_ambassador = true;

COMMENT ON COLUMN shared.contacts.is_ambassador IS
  'Promotes a contact to ambassador status. The sales-campaign share-kit '
  'picks ambassadors from this flag + the per-brand contact_segments to '
  'mint per-link UTM trackers.';
COMMENT ON COLUMN shared.contacts.ambassador_profile IS
  'JSONB ambassador metadata: commission_pct (decimal 0-1), social_handles '
  '{ instagram, tiktok, x, youtube }, since (ISO date). Commission tracking '
  'lives separately in the per-brand sales_campaign_ambassadors table.';

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 3. Verify                                                            ║
-- ╚════════════════════════════════════════════════════════════════════╝
--   SELECT business_key, sales_subdomain, show_viewer_count_policy,
--          praxis_voice_profile->>'tone' AS tone
--     FROM shared.business_config;
--   SELECT count(*) FROM shared.contacts WHERE is_ambassador = true;
-- ============================================================
