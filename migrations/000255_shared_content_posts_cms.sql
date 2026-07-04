-- ============================================================
-- MIGRATION 000255 — Storefront Content CMS
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- Two jobs:
--
--   1. Widen the per-brand `storefront_content_posts.post_type` CHECK to
--      include 'journal' and 'policy'. The storefront already READS those
--      types (journal.$slug, policies.$slug) but the original constraint
--      (migration 000016 template) only allowed
--      blog/faq/guide/lookbook/press — so a journal or policy post could
--      never be stored. New brands get the widened constraint from the
--      companion template migration 000076; this handles the brands that
--      are ALREADY bootstrapped (application-layer isolation means we
--      touch each brand schema explicitly).
--
--   2. Seed a small, honest starter library so Praxis (the storefront
--      Brand Brain) and the public pages are useful on day one:
--        • PUBLISHED — only universally-true craft/feature content (wig
--          care, how the Shade Finder works). Safe for Praxis to quote.
--        • DRAFT — shipping / returns / policy templates. Praxis reads
--          ONLY published rows, so it will never quote these until an
--          operator reviews the specifics and publishes them. This is the
--          anti-hallucination contract, enforced by data.
--
-- Idempotent: the constraint step drops any existing post_type check
-- before adding the canonical one; the seed uses ON CONFLICT (slug) DO
-- NOTHING so re-running never duplicates or overwrites edited copy.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 1. Widen the post_type CHECK on every existing brand schema         ║
-- ╚════════════════════════════════════════════════════════════════════╝

DO $do$
DECLARE
  v_schema TEXT;
  v_con    TEXT;
BEGIN
  FOR v_schema IN
    SELECT business_key FROM shared.business_config ORDER BY business_key
  LOOP
    -- Skip brands whose schema/table isn't present yet.
    IF to_regclass(format('%I.storefront_content_posts', v_schema)) IS NULL THEN
      CONTINUE;
    END IF;

    -- Drop whatever post_type check currently exists (name is auto-assigned
    -- by Postgres, so find it rather than assume it).
    FOR v_con IN
      SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       WHERE nsp.nspname = v_schema
         AND rel.relname = 'storefront_content_posts'
         AND con.contype = 'c'
         AND pg_get_constraintdef(con.oid) ILIKE '%post_type%'
    LOOP
      EXECUTE format(
        'ALTER TABLE %I.storefront_content_posts DROP CONSTRAINT %I',
        v_schema, v_con);
    END LOOP;

    EXECUTE format(
      'ALTER TABLE %I.storefront_content_posts
         ADD CONSTRAINT storefront_content_posts_post_type_check
         CHECK (post_type IN (''blog'',''faq'',''guide'',''lookbook'',''press'',''journal'',''policy''))',
      v_schema);
  END LOOP;
END $do$;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 2. Seed the starter content library into every brand schema         ║
-- ╚════════════════════════════════════════════════════════════════════╝
--
-- Copy is brand-neutral and true for any premium hair/wig house, so it is
-- safe for both Pixie Girl and Faitlyn. Operators refine it in Storefront
-- Studio → Content.

DO $do$
DECLARE
  v_schema TEXT;
BEGIN
  FOR v_schema IN
    SELECT business_key FROM shared.business_config ORDER BY business_key
  LOOP
    IF to_regclass(format('%I.storefront_content_posts', v_schema)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format($fmt$
      INSERT INTO %I.storefront_content_posts
        (post_type, slug, title, excerpt, body, faq_category, faq_question,
         status, published_at, is_featured, display_order, reading_time_minutes)
      VALUES
        -- ── PUBLISHED: care guides (craft truths, safe for Praxis) ──
        ('guide', 'wig-care-wash-day',
         'Wash day, done right',
         $md$How to wash your wig so it stays soft, shiny and tangle-free.$md$,
         $md$Washing is where a wig is won or lost. Work gently and in one direction, top to bottom.

1. Detangle first. With the wig dry, finger-detangle from the ends up, then use a wide-tooth comb or a soft brush made for extensions. Never rake from the roots down.
2. Rinse in cool-to-lukewarm water. Hot water lifts the cuticle and dulls the shine.
3. Shampoo softly. Use a sulphate-free shampoo. Smooth it down the hair — do not scrub or pile the hair on top of itself, which causes matting.
4. Condition mid-length to ends. Leave a moisturising conditioner in for two to three minutes, then rinse. Keep heavy conditioner off the lace or the knots on a closure.
5. Dry flat or on a stand. Blot with a towel, never wring. Air-dry on a wig stand away from direct heat.

A gentle wash every 8 to 12 wears keeps human hair looking new far longer.$md$,
         NULL, NULL, 'published', now(), true, 1, 4),

        ('guide', 'wig-care-storage-sleep',
         'Make it last: storage & sleep',
         $md$Simple habits that add months to your wig's life.$md$,
         $md$Most wig wear-and-tear happens off your head — in the bag and in bed.

Storage: keep the wig on a stand or mannequin head so the style holds and the cap keeps its shape. If you must travel with it, lay it flat in a silk or satin bag; avoid cramming it into a drawer.

Sleep: try not to sleep in your wig regularly. When you do, loosely plait or pineapple the hair and wrap it in a silk or satin scarf, or use a silk pillowcase. Cotton draws out moisture and roughens the cuticle.

Handling: keep the hair away from open flames, ovens and strong sun. Store it fully dry — putting a damp wig away invites mustiness and mildew.$md$,
         NULL, NULL, 'published', now(), false, 2, 3),

        ('guide', 'wig-care-detangling',
         'Detangling without the damage',
         $md$The calm, patient way to smooth out knots and shedding.$md$,
         $md$Tangles are normal — friction from daily wear. The fix is patience, not force.

Start dry and start at the ends. Hold the hair in sections and work upward in short strokes. A little leave-in conditioner or a water-and-conditioner mist gives the comb slip so strands glide instead of snap.

Use the right tool: a wide-tooth comb or a loop brush designed for wefts and lace. Fine bristle brushes tug at knots and pull hair from the cap.

If you hit a stubborn knot, do not yank it. Add slip, gently separate it with your fingers, then comb through. Five slow minutes beats a handful of shed hair.$md$,
         NULL, NULL, 'published', now(), false, 3, 3),

        -- ── PUBLISHED: FAQs (safe, true of this platform) ──
        ('faq', 'faq-how-shade-finder-works',
         'How does the Shade Finder work?',
         NULL,
         $md$Share a clear photo in natural light and Praxis, our AI stylist, reads your undertone and depth, matches you to the shade family made for you, and shows the exact styles that carry it. Your photo is analysed in the moment and never saved. You can also just chat — about a shade, an occasion, or how to care for your hair.$md$,
         'general', 'How does the Shade Finder work?',
         'published', now(), false, 10, 1),

        ('faq', 'faq-personal-styling-help',
         'Can I get personal styling advice?',
         NULL,
         $md$Yes. Praxis is your personal stylist and concierge, free to use on the site. Ask about undertones, textures, lengths, the right style for an event, or how to look after your hair — any time, no appointment needed.$md$,
         'general', 'Can I get personal styling advice?',
         'published', now(), false, 11, 1),

        ('faq', 'faq-wig-lifespan-care',
         'How do I make my hair last longer?',
         NULL,
         $md$Treat it like your own hair, gently. Wash every 8 to 12 wears with a sulphate-free shampoo, condition the mid-lengths and ends, air-dry on a stand, and wrap it in silk or satin at night. Keep heat low and store it dry. Well cared for, quality human hair stays beautiful for many months. See our care guides for the full routine.$md$,
         'care', 'How do I make my hair last longer?',
         'published', now(), false, 12, 1),

        -- ── PUBLISHED: journal (describes a real feature) ──
        ('journal', 'meet-praxis-your-stylist',
         'Meet Praxis, your personal stylist',
         $md$A new way to find your shade and get honest, expert styling help — in seconds.$md$,
         $md$Choosing hair online usually means guessing. We wanted it to feel like walking into a boutique and having a stylist who actually knows colour give you their full attention. So we built one.

Praxis is our AI stylist and concierge. Share a photo in good light and it reads your undertone and depth, then matches you to the shade family made for you and pulls the exact styles that carry it — with real prices, in your currency. No photo? Just talk to it: the occasion you are dressing for, a warmer or cooler look, a budget, or how to care for your hair.

Two promises. Your photo is analysed in the moment and never stored. And Praxis only ever recommends what we genuinely stock and only quotes what is genuinely true — if it does not know something, it tells you and points you to a human. Styling help you can actually trust.$md$,
         NULL, NULL, 'published', now(), true, 20, 3),

        -- ── DRAFT: logistics & policy (operator reviews & publishes) ──
        ('faq', 'faq-delivery-time',
         'How long will delivery take?',
         NULL,
         $md$[Review before publishing] Add your real delivery times and fees here — for example, how long orders take within your city versus nationwide, and any express option. Praxis will only share this once you publish it, so shoppers never get a guessed answer.$md$,
         'shipping', 'How long will delivery take?',
         'draft', NULL, false, 30, 1),

        ('policy', 'shipping',
         'Shipping Policy',
         $md$[Draft — review and publish] How and when orders are delivered.$md$,
         $md$[This is a starter template. Replace the bracketed parts with your real policy, then publish.]

Processing time: orders are prepared within [X] business days.

Delivery estimates:
- Within [your city]: [X to Y] business days.
- Nationwide: [X to Y] business days.
- Express (where available): [details].

Shipping fees: [flat fee / calculated at checkout / free above a threshold].

Tracking: once your order ships you will receive [a tracking link / an update by WhatsApp or email].

Questions about a specific order? Contact us and we will help.$md$,
         NULL, NULL, 'draft', NULL, false, 40, 2),

        ('policy', 'returns',
         'Returns & Refunds',
         $md$[Draft — review and publish] When and how items can be returned.$md$,
         $md$[This is a starter template. Replace the bracketed parts with your real policy, then publish.]

Eligibility: for reasons of hygiene, [unworn items with tags intact] may be returned within [X] days of delivery. [State any items that are final sale — e.g. custom or coloured units.]

How to start a return: contact us within [X] days with your order details and reason.

Refunds: approved refunds are processed to [the original payment method] within [X] business days of us receiving the item.

Exchanges: [available / not available] — describe how a shade or length swap works.

Damaged or wrong item: if anything arrives faulty or not as ordered, contact us within [X] days and we will make it right.$md$,
         NULL, NULL, 'draft', NULL, false, 41, 2)
      ON CONFLICT (slug) DO NOTHING
    $fmt$, v_schema);
  END LOOP;
END $do$;
