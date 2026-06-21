-- ============================================================
-- seed-preview-campaigns.sql
--
-- Seeds THREE preview sales campaigns into BOTH brand schemas
-- (pixiegirl + faitlynhair) so you can see every landing-page
-- lifecycle state the storefront renders:
--
--   1. preview-upcoming  status=scheduled  -> "before" (countdown + notify-me)
--   2. preview-live       status=live       -> "live"   (shop now, announcement bar)
--   3. preview-ended      status=ended      -> "ended"  (closed takeover + CTA)
--
-- The public phase is derived from status + the starts_at/ends_at window by
-- resolveState() in src/modules/sales_campaigns/campaigns.service.js, so the
-- dates below are set RELATIVE to now() and recompute every time you run this.
--
-- View each one at (admin preview route):
--   /sale/preview-upcoming?brand=pixiegirl
--   /sale/preview-live?brand=pixiegirl
--   /sale/preview-ended?brand=pixiegirl
--   ...and the same three slugs with ?brand=faitlynhair
--
-- IDEMPOTENT: every run first removes the preview-% rows, then re-inserts them,
-- so dates/status stay fresh and re-running never duplicates.
--
-- RUN (PowerShell, from the repo root — psql will prompt for the password):
--   psql -h localhost -U pixie_admin -d pixiedata -f scripts/seed-preview-campaigns.sql
--
-- REMOVE EVERYTHING THIS CREATED (one shot):
--   psql -h localhost -U pixie_admin -d pixiedata -c "DELETE FROM pixiegirl.sales_campaigns WHERE slug LIKE 'preview-%'; DELETE FROM faitlynhair.sales_campaigns WHERE slug LIKE 'preview-%';"
-- ============================================================

\set ON_ERROR_STOP on

BEGIN;

-- ╔══════════════════════════════════════════════════════════╗
-- ║ PIXIEGIRL                                                 ║
-- ╚══════════════════════════════════════════════════════════╝
DELETE FROM pixiegirl.sales_campaigns WHERE slug LIKE 'preview-%';

INSERT INTO pixiegirl.sales_campaigns (
  slug, name, description, starts_at, ends_at,
  discount_type, discount_value, product_scope,
  landing_hero_title, landing_hero_subtitle, landing_hero_image_url, landing_cta_text,
  landing_blocks, countdown_message, signup_for_notifications,
  ended_message, ended_redirect_to,
  meta_title, meta_description, og_image_url,
  status,
  total_visitors, total_unique_visitors, total_signups, total_add_to_cart,
  total_orders, total_revenue_ngn, total_discount_given_ngn
) VALUES
-- 1) SCHEDULED — starts tomorrow ----------------------------------------------
(
  'preview-upcoming',
  'Holiday Velvet Edit — Early Access',
  'A limited holiday capsule. Members get first access before it opens to everyone.',
  now() + interval '1 day', now() + interval '8 days',
  'percentage', 0.25, 'all',
  'The Holiday Velvet Edit',
  'Twelve limited pieces, dressed for the season. The list gets in first.',
  'https://picsum.photos/seed/pxg-upcoming-hero/1600/2000', 'Notify Me',
  '[
    {"key":"bundle_showcase","enabled":true},
    {"key":"quantity_tier_visualiser","enabled":true},
    {"key":"lookbook_carousel","enabled":true,"props":{"images":["https://picsum.photos/seed/pxg-look-1/900/1200","https://picsum.photos/seed/pxg-look-2/900/1200","https://picsum.photos/seed/pxg-look-3/900/1200","https://picsum.photos/seed/pxg-look-4/900/1200","https://picsum.photos/seed/pxg-look-5/900/1200"]}},
    {"key":"brand_story","enabled":true,"props":{"body":"Pixie Girl began with one promise: beauty that never asks you to choose between quality and the price you pay. Every edit is limited, intentional, and made to be worn and remembered."}},
    {"key":"why_buy","enabled":true},
    {"key":"founder_quote","enabled":true,"props":{"body":"We do not do ordinary. We do the piece she remembers."}},
    {"key":"testimonials","enabled":true},
    {"key":"faq","enabled":true},
    {"key":"newsletter_capture","enabled":true}
  ]'::jsonb,
  'Doors open in', true,
  'This drop has ended.', '/',
  'Holiday Velvet Edit — Early Access | Pixie Girl',
  'Be first into the Holiday Velvet Edit. Join the list for early access and private prices.',
  'https://picsum.photos/seed/pxg-upcoming-og/1200/630',
  'scheduled',
  1240, 980, 240, 0, 0, 0, 0
),
-- 2) LIVE — started yesterday, ongoing ----------------------------------------
(
  'preview-live',
  'Festive Glow Sale',
  'Our biggest seasonal sale — live now, across the whole collection.',
  now() - interval '1 day', now() + interval '6 days',
  'percentage', 0.30, 'all',
  'Festive Glow Sale',
  'Up to 30% off the pieces everyone is asking for. While the drop is open.',
  'https://picsum.photos/seed/pxg-live-hero/1600/2000', 'Shop the Drop',
  '[
    {"key":"bundle_showcase","enabled":true},
    {"key":"quantity_tier_visualiser","enabled":true},
    {"key":"featured_products","enabled":true},
    {"key":"lookbook_carousel","enabled":true,"props":{"images":["https://picsum.photos/seed/pxg-live-1/900/1200","https://picsum.photos/seed/pxg-live-2/900/1200","https://picsum.photos/seed/pxg-live-3/900/1200","https://picsum.photos/seed/pxg-live-4/900/1200","https://picsum.photos/seed/pxg-live-5/900/1200"]}},
    {"key":"why_buy","enabled":true},
    {"key":"testimonials","enabled":true},
    {"key":"faq","enabled":true},
    {"key":"newsletter_capture","enabled":true}
  ]'::jsonb,
  'Sale ends in', true,
  'This drop has ended.', '/',
  'Festive Glow Sale | Pixie Girl',
  'The Festive Glow Sale is live. Up to 30% off across the collection — limited time only.',
  'https://picsum.photos/seed/pxg-live-og/1200/630',
  'live',
  5400, 4120, 312, 860, 213, 18750000.00, 4210000.00
),
-- 3) ENDED — ended yesterday --------------------------------------------------
(
  'preview-ended',
  'Midsummer Clearance',
  'A short midsummer clearance. Now closed — the next drop is already on the way.',
  now() - interval '8 days', now() - interval '1 day',
  'fixed_amount', 15000, 'all',
  'Midsummer Clearance',
  'Thank you for shopping the clearance. This one has wrapped.',
  'https://picsum.photos/seed/pxg-ended-hero/1600/2000', 'Shop Now',
  '[
    {"key":"brand_story","enabled":true,"props":{"body":"Thank you to everyone who shopped the Midsummer Clearance. Join the list and you will be first to know the moment the next edit opens."}},
    {"key":"newsletter_capture","enabled":true}
  ]'::jsonb,
  'Coming soon', true,
  'The Midsummer Clearance has closed — but the shelves are full of beautiful things, and the next drop is almost here.',
  '/',
  'Midsummer Clearance | Pixie Girl',
  'The Midsummer Clearance has ended. Join the list for first access to the next drop.',
  'https://picsum.photos/seed/pxg-ended-og/1200/630',
  'ended',
  9820, 7240, 410, 1610, 512, 41300000.00, 9860000.00
);

-- ╔══════════════════════════════════════════════════════════╗
-- ║ FAITLYNHAIR                                               ║
-- ╚══════════════════════════════════════════════════════════╝
DELETE FROM faitlynhair.sales_campaigns WHERE slug LIKE 'preview-%';

INSERT INTO faitlynhair.sales_campaigns (
  slug, name, description, starts_at, ends_at,
  discount_type, discount_value, product_scope,
  landing_hero_title, landing_hero_subtitle, landing_hero_image_url, landing_cta_text,
  landing_blocks, countdown_message, signup_for_notifications,
  ended_message, ended_redirect_to,
  meta_title, meta_description, og_image_url,
  status,
  total_visitors, total_unique_visitors, total_signups, total_add_to_cart,
  total_orders, total_revenue_ngn, total_discount_given_ngn
) VALUES
-- 1) SCHEDULED — starts tomorrow ----------------------------------------------
(
  'preview-upcoming',
  'Luxe Lengths Launch — Early Access',
  'A new raw-hair collection. The VIP list gets in before it opens to everyone.',
  now() + interval '1 day', now() + interval '8 days',
  'percentage', 0.25, 'all',
  'The Luxe Lengths Launch',
  'New raw, full-density lengths. Join the list and be first through the door.',
  'https://picsum.photos/seed/flh-upcoming-hero/1600/2000', 'Notify Me',
  '[
    {"key":"bundle_showcase","enabled":true},
    {"key":"quantity_tier_visualiser","enabled":true},
    {"key":"lookbook_carousel","enabled":true,"props":{"images":["https://picsum.photos/seed/flh-look-1/900/1200","https://picsum.photos/seed/flh-look-2/900/1200","https://picsum.photos/seed/flh-look-3/900/1200","https://picsum.photos/seed/flh-look-4/900/1200","https://picsum.photos/seed/flh-look-5/900/1200"]}},
    {"key":"brand_story","enabled":true,"props":{"body":"Faitlynhair is raw, full-density hair you can trace right back to the bundle. Ethically sourced, and made to wash, style and last like your own."}},
    {"key":"why_buy","enabled":true},
    {"key":"founder_quote","enabled":true,"props":{"body":"Hair she keeps coming back for."}},
    {"key":"testimonials","enabled":true},
    {"key":"wig_care","enabled":true},
    {"key":"faq","enabled":true},
    {"key":"vip_signup","enabled":true}
  ]'::jsonb,
  'Doors open in', true,
  'This launch has ended.', '/',
  'Luxe Lengths Launch — Early Access | Faitlynhair',
  'Be first into the Luxe Lengths Launch. Join the VIP list for early access.',
  'https://picsum.photos/seed/flh-upcoming-og/1200/630',
  'scheduled',
  980, 760, 188, 0, 0, 0, 0
),
-- 2) LIVE — started yesterday, ongoing ----------------------------------------
(
  'preview-live',
  'Frontal Friday Flash Sale',
  'Frontals, closures and bundles — flash priced while the sale is open.',
  now() - interval '1 day', now() + interval '6 days',
  'percentage', 0.30, 'all',
  'Frontal Friday Flash Sale',
  'Up to 30% off frontals, closures and full bundles. Only while it is live.',
  'https://picsum.photos/seed/flh-live-hero/1600/2000', 'Shop the Flash Sale',
  '[
    {"key":"bundle_showcase","enabled":true},
    {"key":"quantity_tier_visualiser","enabled":true},
    {"key":"featured_products","enabled":true},
    {"key":"lookbook_carousel","enabled":true,"props":{"images":["https://picsum.photos/seed/flh-live-1/900/1200","https://picsum.photos/seed/flh-live-2/900/1200","https://picsum.photos/seed/flh-live-3/900/1200","https://picsum.photos/seed/flh-live-4/900/1200","https://picsum.photos/seed/flh-live-5/900/1200"]}},
    {"key":"why_buy","enabled":true},
    {"key":"testimonials","enabled":true},
    {"key":"wig_care","enabled":true},
    {"key":"faq","enabled":true},
    {"key":"vip_signup","enabled":true}
  ]'::jsonb,
  'Flash sale ends in', true,
  'This sale has ended.', '/',
  'Frontal Friday Flash Sale | Faitlynhair',
  'The Frontal Friday Flash Sale is live. Up to 30% off frontals, closures and bundles.',
  'https://picsum.photos/seed/flh-live-og/1200/630',
  'live',
  6300, 4880, 274, 940, 246, 22480000.00, 5120000.00
),
-- 3) ENDED — ended yesterday --------------------------------------------------
(
  'preview-ended',
  'Easter Bundle Blowout',
  'A short Easter bundle event. Now closed — the next restock is on the way.',
  now() - interval '8 days', now() - interval '1 day',
  'fixed_amount', 20000, 'all',
  'Easter Bundle Blowout',
  'Thank you for shopping the bundle event. This one has wrapped.',
  'https://picsum.photos/seed/flh-ended-hero/1600/2000', 'Shop Now',
  '[
    {"key":"brand_story","enabled":true,"props":{"body":"Thank you to everyone who shopped the Easter Bundle Blowout. Join the VIP list to be first when the next restock lands."}},
    {"key":"vip_signup","enabled":true}
  ]'::jsonb,
  'Coming soon', true,
  'The Easter Bundle Blowout has closed — but the next restock is almost here. Join the list so you do not miss it.',
  '/',
  'Easter Bundle Blowout | Faitlynhair',
  'The Easter Bundle Blowout has ended. Join the VIP list for first access to the next restock.',
  'https://picsum.photos/seed/flh-ended-og/1200/630',
  'ended',
  11200, 8360, 365, 1740, 588, 52640000.00, 11760000.00
);

COMMIT;

-- ── Verify what was seeded + the phase resolveState() will report ───────────
SELECT 'pixiegirl'   AS schema, slug, status,
       to_char(starts_at, 'YYYY-MM-DD HH24:MI') AS starts_at,
       to_char(ends_at,   'YYYY-MM-DD HH24:MI') AS ends_at,
       CASE
         WHEN status IN ('ended','archived') THEN 'ended'
         WHEN now() < starts_at THEN 'before'
         WHEN now() >= starts_at AND now() < ends_at AND status = 'live' THEN 'live'
         WHEN now() >= ends_at THEN 'ended'
         ELSE 'before'
       END AS public_state
  FROM pixiegirl.sales_campaigns WHERE slug LIKE 'preview-%'
UNION ALL
SELECT 'faitlynhair' AS schema, slug, status,
       to_char(starts_at, 'YYYY-MM-DD HH24:MI'),
       to_char(ends_at,   'YYYY-MM-DD HH24:MI'),
       CASE
         WHEN status IN ('ended','archived') THEN 'ended'
         WHEN now() < starts_at THEN 'before'
         WHEN now() >= starts_at AND now() < ends_at AND status = 'live' THEN 'live'
         WHEN now() >= ends_at THEN 'ended'
         ELSE 'before'
       END
  FROM faitlynhair.sales_campaigns WHERE slug LIKE 'preview-%'
 ORDER BY schema, starts_at;
