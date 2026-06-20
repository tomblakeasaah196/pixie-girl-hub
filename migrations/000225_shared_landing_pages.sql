-- ============================================================
-- MIGRATION 000225 — Sales Landing Studio (brand-level "no active
-- sale" landing page) · Pixie Girl Hub · V2.2
-- ============================================================
--
-- The Landing Studio is a STANDALONE, brand-level editor (not nested
-- inside a campaign). It owns the public "between drops / no active
-- sale" page served on each brand's sales subdomain
-- (sales.pixiegirlglobal.com / sales.thefaitlynbrand.com).
--
-- One row per brand. We keep a working `draft_config` (what the studio
-- edits + previews) and a `published_config` (what the public page
-- renders). "Publish" copies draft → published. The whole design lives
-- in JSONB so the studio can evolve the schema without a migration:
-- colours, copy, logo + tint, hero, invitation form fields, gallery,
-- pillars, socials and the cinematic reveal are all config-driven —
-- nothing hardcoded in the renderer.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.landing_pages (
  landing_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_key      TEXT NOT NULL UNIQUE
                      REFERENCES shared.business_config (business_key)
                      ON DELETE CASCADE,
  draft_config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_config  JSONB,
  is_published      BOOLEAN NOT NULL DEFAULT false,
  published_at      TIMESTAMPTZ,
  published_by      UUID,
  updated_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE shared.landing_pages IS
  'Brand-level "no active sale" landing page, edited by the standalone '
  'Landing Studio. One row per brand. draft_config = studio working copy + '
  'preview; published_config = what the public sales subdomain renders.';
COMMENT ON COLUMN shared.landing_pages.draft_config IS
  'Studio working copy. Edited + previewed; never served publicly until published.';
COMMENT ON COLUMN shared.landing_pages.published_config IS
  'Last published snapshot. The public page reads THIS, never the draft.';

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ Seed both founding brands with the approved "Atelier" design.       ║
-- ║ Colours are hex (the renderer converts to "r g b" triplets and uses ║
-- ║ rgb(var(--brand-*) / a), matching the Maroon-Noir token convention).║
-- ║ Image URLs (logo/hero/gallery) seed empty — uploaded via the Studio.║
-- ╚════════════════════════════════════════════════════════════════════╝

INSERT INTO shared.landing_pages (business_key, draft_config, published_config, is_published, published_at)
SELECT
  'pixiegirl',
  $pxg$
  {
    "brandName": "Pixie Girl Global",
    "legalName": "Pixie Girl Global LLC",
    "tagline": "The House of the Pixie",
    "welcomeLine": "Welcome to the House of Pixie",
    "domain": "sales.pixiegirlglobal.com",
    "storefront": "https://pixiegirlglobal.com",
    "address": "30 N Gould St Ste R, Sheridan, WY 82801",
    "theme": {
      "ink": "#100806", "paper": "#F8F4F2", "primary": "#5C0A14",
      "primaryDeep": "#36060D", "accent": "#D4AF7A", "muted": "#BBAEA8", "glow": "#A11225"
    },
    "three": { "primary": "#5C0A14", "accent": "#D4AF7A", "ink": "#100806", "metal": "#B8112B" },
    "background": { "type": "color", "imageUrl": null },
    "logo": { "url": null, "headerTint": null, "footerTint": null, "headerScale": 1.15, "footerScale": 1.15 },
    "hero": {
      "imageUrl": null,
      "eyebrow": "Between chapters — opening soon",
      "headline": "Quiet",
      "headlineAccent": "on purpose.",
      "body": "The next chapter is being written. Doors closed for now — but the list inside hears first, pays less, and receives the curated gifts reserved for our earliest few. Add your name. Be first through the door.",
      "ctaLabel": "Request your invitation",
      "launchSeasonLabel": "The doors open in the season ahead"
    },
    "invitation": {
      "eyebrow": "The Inner Circle",
      "heading": "Two hundred names.",
      "headingAccent": "Nothing more.",
      "body": "Twenty-four hours of early access. Private launch pricing — up to 30% off for the list. A curated launch gift hand-selected for top orders. And for those who bring three friends with them: an additional private discount and bonus loyalty points on every purchase they make.",
      "seatsTotal": 200,
      "seatsClaimedBase": 73,
      "perks": [
        { "numeral": "I.", "label": "First access" },
        { "numeral": "II.", "label": "Private pricing" },
        { "numeral": "III.", "label": "Curated gifts" }
      ],
      "formTitle": "Reserve your seat",
      "formTitleAccent": "at the table.",
      "formEyebrow": "Private invitation",
      "referralNote": "Invite three. When three friends you refer join the list, you unlock an additional private discount at launch — and every purchase they make adds to your loyalty points."
    },
    "form": {
      "collectName": true, "collectEmail": true, "collectWhatsapp": true, "collectReferral": true,
      "channels": ["email", "whatsapp", "both"],
      "submitLabel": "Add me to the list",
      "footnote": "One message when doors open. A quiet inbox otherwise."
    },
    "galleryEyebrow": "The Last Chapter",
    "galleryHeading": "A glimpse of what has been.",
    "gallery": [],
    "pillars": [
      { "numeral": "I.", "title": "Crafted", "body": "Hand-selected strands, hand-finished lace. Every cap is made for one head." },
      { "numeral": "II.", "title": "Curated", "body": "Tight seasons. Few pieces. We release only what we would wear ourselves." },
      { "numeral": "III.", "title": "Limited", "body": "When a chapter closes, it closes. No restocks. No second printings." }
    ],
    "socials": [
      { "platform": "instagram", "href": "https://www.instagram.com/pixiegirlg", "label": "Instagram" },
      { "platform": "tiktok", "href": "https://www.tiktok.com/@pixiegirlg", "label": "TikTok" },
      { "platform": "youtube", "href": "https://www.youtube.com/@PixieGirlG", "label": "YouTube" },
      { "platform": "twitter", "href": "https://x.com/pixiegirlg", "label": "X" },
      { "platform": "pinterest", "href": "https://www.pinterest.com/pixiegirlg", "label": "Pinterest" }
    ],
    "reveal": { "enabled": true, "tagline": "The House of the Pixie", "showScarcity": true }
  }
  $pxg$::jsonb,
  $pxg$
  {
    "brandName": "Pixie Girl Global",
    "legalName": "Pixie Girl Global LLC",
    "tagline": "The House of the Pixie",
    "welcomeLine": "Welcome to the House of Pixie",
    "domain": "sales.pixiegirlglobal.com",
    "storefront": "https://pixiegirlglobal.com",
    "address": "30 N Gould St Ste R, Sheridan, WY 82801",
    "theme": {
      "ink": "#100806", "paper": "#F8F4F2", "primary": "#5C0A14",
      "primaryDeep": "#36060D", "accent": "#D4AF7A", "muted": "#BBAEA8", "glow": "#A11225"
    },
    "three": { "primary": "#5C0A14", "accent": "#D4AF7A", "ink": "#100806", "metal": "#B8112B" },
    "background": { "type": "color", "imageUrl": null },
    "logo": { "url": null, "headerTint": null, "footerTint": null, "headerScale": 1.15, "footerScale": 1.15 },
    "hero": {
      "imageUrl": null,
      "eyebrow": "Between chapters — opening soon",
      "headline": "Quiet",
      "headlineAccent": "on purpose.",
      "body": "The next chapter is being written. Doors closed for now — but the list inside hears first, pays less, and receives the curated gifts reserved for our earliest few. Add your name. Be first through the door.",
      "ctaLabel": "Request your invitation",
      "launchSeasonLabel": "The doors open in the season ahead"
    },
    "invitation": {
      "eyebrow": "The Inner Circle",
      "heading": "Two hundred names.",
      "headingAccent": "Nothing more.",
      "body": "Twenty-four hours of early access. Private launch pricing — up to 30% off for the list. A curated launch gift hand-selected for top orders. And for those who bring three friends with them: an additional private discount and bonus loyalty points on every purchase they make.",
      "seatsTotal": 200,
      "seatsClaimedBase": 73,
      "perks": [
        { "numeral": "I.", "label": "First access" },
        { "numeral": "II.", "label": "Private pricing" },
        { "numeral": "III.", "label": "Curated gifts" }
      ],
      "formTitle": "Reserve your seat",
      "formTitleAccent": "at the table.",
      "formEyebrow": "Private invitation",
      "referralNote": "Invite three. When three friends you refer join the list, you unlock an additional private discount at launch — and every purchase they make adds to your loyalty points."
    },
    "form": {
      "collectName": true, "collectEmail": true, "collectWhatsapp": true, "collectReferral": true,
      "channels": ["email", "whatsapp", "both"],
      "submitLabel": "Add me to the list",
      "footnote": "One message when doors open. A quiet inbox otherwise."
    },
    "galleryEyebrow": "The Last Chapter",
    "galleryHeading": "A glimpse of what has been.",
    "gallery": [],
    "pillars": [
      { "numeral": "I.", "title": "Crafted", "body": "Hand-selected strands, hand-finished lace. Every cap is made for one head." },
      { "numeral": "II.", "title": "Curated", "body": "Tight seasons. Few pieces. We release only what we would wear ourselves." },
      { "numeral": "III.", "title": "Limited", "body": "When a chapter closes, it closes. No restocks. No second printings." }
    ],
    "socials": [
      { "platform": "instagram", "href": "https://www.instagram.com/pixiegirlg", "label": "Instagram" },
      { "platform": "tiktok", "href": "https://www.tiktok.com/@pixiegirlg", "label": "TikTok" },
      { "platform": "youtube", "href": "https://www.youtube.com/@PixieGirlG", "label": "YouTube" },
      { "platform": "twitter", "href": "https://x.com/pixiegirlg", "label": "X" },
      { "platform": "pinterest", "href": "https://www.pinterest.com/pixiegirlg", "label": "Pinterest" }
    ],
    "reveal": { "enabled": true, "tagline": "The House of the Pixie", "showScarcity": true }
  }
  $pxg$::jsonb,
  true,
  now()
WHERE EXISTS (SELECT 1 FROM shared.business_config WHERE business_key = 'pixiegirl')
ON CONFLICT (business_key) DO NOTHING;

INSERT INTO shared.landing_pages (business_key, draft_config, published_config, is_published, published_at)
SELECT
  'faitlynhair',
  $flh$
  {
    "brandName": "Faitlyn Hair",
    "legalName": "The Faitlyn Brand",
    "tagline": "Quietly extraordinary.",
    "welcomeLine": "Welcome to Faitlyn",
    "domain": "sales.thefaitlynbrand.com",
    "storefront": "https://thefaitlynbrand.com",
    "address": "10B Emma Abimbola Cole Street, Lekki Phase 1, Lagos",
    "theme": {
      "ink": "#1A0F08", "paper": "#F8F5F1", "primary": "#3A2418",
      "primaryDeep": "#281D15", "accent": "#D9BFA8", "muted": "#B6A696", "glow": "#C79C6B"
    },
    "three": { "primary": "#3A2418", "accent": "#D9BFA8", "ink": "#1A0F08", "metal": "#E5C9A8" },
    "background": { "type": "color", "imageUrl": null },
    "logo": { "url": null, "headerTint": null, "footerTint": null, "headerScale": 1.15, "footerScale": 1.15 },
    "hero": {
      "imageUrl": null,
      "eyebrow": "Between chapters — opening soon",
      "headline": "Quiet",
      "headlineAccent": "on purpose.",
      "body": "The next chapter is being written. Doors closed for now — but the list inside hears first, pays less, and receives the curated gifts reserved for our earliest few. Add your name. Be first through the door.",
      "ctaLabel": "Request your invitation",
      "launchSeasonLabel": "The doors open in the season ahead"
    },
    "invitation": {
      "eyebrow": "The Inner Circle",
      "heading": "Two hundred names.",
      "headingAccent": "Nothing more.",
      "body": "Twenty-four hours of early access. Private launch pricing — up to 30% off for the list. A curated launch gift hand-selected for top orders. And for those who bring three friends with them: an additional private discount and bonus loyalty points on every purchase they make.",
      "seatsTotal": 200,
      "seatsClaimedBase": 73,
      "perks": [
        { "numeral": "I.", "label": "First access" },
        { "numeral": "II.", "label": "Private pricing" },
        { "numeral": "III.", "label": "Curated gifts" }
      ],
      "formTitle": "Reserve your seat",
      "formTitleAccent": "at the table.",
      "formEyebrow": "Private invitation",
      "referralNote": "Invite three. When three friends you refer join the list, you unlock an additional private discount at launch — and every purchase they make adds to your loyalty points."
    },
    "form": {
      "collectName": true, "collectEmail": true, "collectWhatsapp": true, "collectReferral": true,
      "channels": ["email", "whatsapp", "both"],
      "submitLabel": "Add me to the list",
      "footnote": "One message when doors open. A quiet inbox otherwise."
    },
    "galleryEyebrow": "The Last Chapter",
    "galleryHeading": "A glimpse of what has been.",
    "gallery": [],
    "pillars": [
      { "numeral": "I.", "title": "Crafted", "body": "Hand-selected strands, hand-finished lace. Every cap is made for one head." },
      { "numeral": "II.", "title": "Curated", "body": "Tight seasons. Few pieces. We release only what we would wear ourselves." },
      { "numeral": "III.", "title": "Limited", "body": "When a chapter closes, it closes. No restocks. No second printings." }
    ],
    "socials": [
      { "platform": "instagram", "href": "https://www.instagram.com/faitlynhair/", "label": "Instagram" },
      { "platform": "facebook", "href": "https://web.facebook.com/faitlynhair/", "label": "Facebook" },
      { "platform": "twitter", "href": "https://twitter.com/Faitlynhair", "label": "X" },
      { "platform": "whatsapp", "href": "https://wa.me/2348061987874", "label": "WhatsApp" }
    ],
    "reveal": { "enabled": true, "tagline": "Quietly extraordinary.", "showScarcity": true }
  }
  $flh$::jsonb,
  $flh$
  {
    "brandName": "Faitlyn Hair",
    "legalName": "The Faitlyn Brand",
    "tagline": "Quietly extraordinary.",
    "welcomeLine": "Welcome to Faitlyn",
    "domain": "sales.thefaitlynbrand.com",
    "storefront": "https://thefaitlynbrand.com",
    "address": "10B Emma Abimbola Cole Street, Lekki Phase 1, Lagos",
    "theme": {
      "ink": "#1A0F08", "paper": "#F8F5F1", "primary": "#3A2418",
      "primaryDeep": "#281D15", "accent": "#D9BFA8", "muted": "#B6A696", "glow": "#C79C6B"
    },
    "three": { "primary": "#3A2418", "accent": "#D9BFA8", "ink": "#1A0F08", "metal": "#E5C9A8" },
    "background": { "type": "color", "imageUrl": null },
    "logo": { "url": null, "headerTint": null, "footerTint": null, "headerScale": 1.15, "footerScale": 1.15 },
    "hero": {
      "imageUrl": null,
      "eyebrow": "Between chapters — opening soon",
      "headline": "Quiet",
      "headlineAccent": "on purpose.",
      "body": "The next chapter is being written. Doors closed for now — but the list inside hears first, pays less, and receives the curated gifts reserved for our earliest few. Add your name. Be first through the door.",
      "ctaLabel": "Request your invitation",
      "launchSeasonLabel": "The doors open in the season ahead"
    },
    "invitation": {
      "eyebrow": "The Inner Circle",
      "heading": "Two hundred names.",
      "headingAccent": "Nothing more.",
      "body": "Twenty-four hours of early access. Private launch pricing — up to 30% off for the list. A curated launch gift hand-selected for top orders. And for those who bring three friends with them: an additional private discount and bonus loyalty points on every purchase they make.",
      "seatsTotal": 200,
      "seatsClaimedBase": 73,
      "perks": [
        { "numeral": "I.", "label": "First access" },
        { "numeral": "II.", "label": "Private pricing" },
        { "numeral": "III.", "label": "Curated gifts" }
      ],
      "formTitle": "Reserve your seat",
      "formTitleAccent": "at the table.",
      "formEyebrow": "Private invitation",
      "referralNote": "Invite three. When three friends you refer join the list, you unlock an additional private discount at launch — and every purchase they make adds to your loyalty points."
    },
    "form": {
      "collectName": true, "collectEmail": true, "collectWhatsapp": true, "collectReferral": true,
      "channels": ["email", "whatsapp", "both"],
      "submitLabel": "Add me to the list",
      "footnote": "One message when doors open. A quiet inbox otherwise."
    },
    "galleryEyebrow": "The Last Chapter",
    "galleryHeading": "A glimpse of what has been.",
    "gallery": [],
    "pillars": [
      { "numeral": "I.", "title": "Crafted", "body": "Hand-selected strands, hand-finished lace. Every cap is made for one head." },
      { "numeral": "II.", "title": "Curated", "body": "Tight seasons. Few pieces. We release only what we would wear ourselves." },
      { "numeral": "III.", "title": "Limited", "body": "When a chapter closes, it closes. No restocks. No second printings." }
    ],
    "socials": [
      { "platform": "instagram", "href": "https://www.instagram.com/faitlynhair/", "label": "Instagram" },
      { "platform": "facebook", "href": "https://web.facebook.com/faitlynhair/", "label": "Facebook" },
      { "platform": "twitter", "href": "https://twitter.com/Faitlynhair", "label": "X" },
      { "platform": "whatsapp", "href": "https://wa.me/2348061987874", "label": "WhatsApp" }
    ],
    "reveal": { "enabled": true, "tagline": "Quietly extraordinary.", "showScarcity": true }
  }
  $flh$::jsonb,
  true,
  now()
WHERE EXISTS (SELECT 1 FROM shared.business_config WHERE business_key = 'faitlynhair')
ON CONFLICT (business_key) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT business_key, is_published, jsonb_typeof(draft_config)
--     FROM shared.landing_pages;
-- ============================================================
