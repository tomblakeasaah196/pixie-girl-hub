-- ============================================================
-- MIGRATION 000338 — Journal content blocks + Faitlyn Hair editorial seed
-- Pixie Girl Hub · JBS Praxis · V2.2
-- ============================================================
--
-- Two jobs:
--
--   1. Retrofit `content_blocks JSONB` onto storefront_content_posts for
--      every ALREADY-BOOTSTRAPPED brand schema (template migration 000079
--      gives it to brands bootstrapped from here on). This is the ordered
--      block array — text / image / youtube / instagram / video — that
--      Storefront Studio → Content now composes journal articles from,
--      replacing the flat `body` textarea for that post type. `body` is
--      untouched and keeps working for FAQs / care guides / policies and as
--      the plain-text fallback if content_blocks is ever empty.
--
--   2. Seed three real editorial journal posts into FAITLYN HAIR ONLY (this
--      is brand-specific narrative copy — the founder's story, the Praxis
--      AI-stylist walkthrough, the factory craft piece — not brand-neutral
--      boilerplate, so unlike migration 000255 it is not looped across
--      every brand). Images reuse the existing self-hosted stills in
--      apps/storefront/public/maison/ as placeholders; an operator can swap
--      them from Storefront Studio → Content at any time.
--
-- Idempotent: column add uses IF NOT EXISTS; the seed uses
-- ON CONFLICT (slug) DO NOTHING.
-- ============================================================

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 1. Add content_blocks to every existing brand schema                ║
-- ╚════════════════════════════════════════════════════════════════════╝

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

    EXECUTE format(
      'ALTER TABLE %I.storefront_content_posts
         ADD COLUMN IF NOT EXISTS content_blocks JSONB NOT NULL DEFAULT ''[]''::jsonb',
      v_schema);
  END LOOP;
END $do$;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║ 2. Seed the "Want to Stay" editorial journal — Faitlyn Hair only    ║
-- ╚════════════════════════════════════════════════════════════════════╝

DO $do$
BEGIN
  IF to_regclass('faitlynhair.storefront_content_posts') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO faitlynhair.storefront_content_posts
    (post_type, slug, title, excerpt, body, hero_image_url, hero_image_alt,
     tags, content_blocks, status, published_at, is_featured, display_order,
     reading_time_minutes)
  VALUES
    -- ── Article 1: the Praxis AI-stylist walkthrough ──
    ('journal', 'shopping-with-praxis-shade-texture',
     'Shopping with Praxis: How to Find Your Perfect Shade & Texture in Seconds',
     $md$Meet the AI stylist that reads your undertone, tunes your lace, and checks you out — all without leaving the chat.$md$,
     $md$Praxis is the AI stylist built into every Faitlyn Hair conversation. Describe what you want, share a photo if you like, and it reads your undertone and depth, matches you to a shade family, fine-tunes the lace and density to your preference, and lets you check out right there in the chat. Four small moments — say it, see it, shape it, buy it — and shopping for hair finally feels like walking into a boutique with a stylist who already knows you.$md$,
     '/maison/product-pixie.jpg', 'A shopper finding her shade and texture with Praxis, our AI stylist',
     ARRAY['ai-experience','praxis'],
     $blk$[
       {"id":"b1","type":"text","text":"Choosing hair online has always meant guessing — a swatch on a screen, a size chart, a hope that it looks like the photo. We wanted it to feel like walking into a boutique and having a stylist who actually knows colour give you their full attention. So we built one.","fontFamily":"eb-garamond","fontSize":"lg"},
       {"id":"b2","type":"text","text":"01 — Tell Praxis what you're looking for","fontFamily":"marcellus","fontSize":"xl","bold":true},
       {"id":"b3","type":"image","url":"/maison/product-pixie.jpg","alt":"A shopper describing what she wants in the Praxis chat","caption":"It starts with a sentence — an occasion, a mood, a length you love. No dropdowns, no filters."},
       {"id":"b4","type":"text","text":"02 — Praxis reads you back","fontFamily":"marcellus","fontSize":"xl","bold":true},
       {"id":"b5","type":"image","url":"/maison/editorial-atelier.jpg","alt":"Praxis's visual analysis response with matched shade families","caption":"Share a clear photo in good light and Praxis reads your undertone and depth in seconds — then lays out the shade families made for you, like a stylist's notes."},
       {"id":"b6","type":"text","text":"03 — Fine-tune the lace, the length, the density","fontFamily":"marcellus","fontSize":"xl","bold":true},
       {"id":"b7","type":"image","url":"/maison/product-curls.jpg","alt":"Fine-tuning lace colour, parting and density inside the chat","caption":"Lace tone, parting, density — every customisation adjusts live, right there in the conversation, until it's exactly yours."},
       {"id":"b8","type":"text","text":"04 — Check out without leaving the chat","fontFamily":"marcellus","fontSize":"xl","bold":true},
       {"id":"b9","type":"image","url":"/maison/product-bob.jpg","alt":"Adding to bag and checking out inside the Praxis chat","caption":"Add to bag, confirm your address, pay — the whole cart lives inside the conversation. No new tab, no starting over."},
       {"id":"b10","type":"text","text":"Two promises stay true through all four moments: your photo is analysed in the moment and never stored, and Praxis only ever recommends what we genuinely stock. If it doesn't know something, it says so — and points you to a human. Styling help you can actually trust, in seconds.","fontFamily":"eb-garamond","fontSize":"lg","italic":true}
     ]$blk$::jsonb,
     'published', now(), false, 21, 3),

    -- ── Article 2: the founder / factory story ──
    ('journal', 'science-of-the-perfect-pixel',
     'The Science of the Perfect Pixel: How Faitlyn Hair Engineered a Global Revolution',
     $md$An MBA, a salon floor, and a decade of solving sizing problems — the unlikely engineering behind two hair companies.$md$,
     $md$Before Faitlyn Hair was a factory, it was a salon chair — and before that, a business degree that had nothing to do with hair. Our founder spent years on both sides of the industry, solving the sizing and glueless problems that quietly frustrate every wig wearer. That decade of craft and commerce became the blueprint for Pixie Girl Global, the world's first factory built exclusively for pixie wigs — a company Faitlyn helped launch by handing over exactly what it took years to earn: market exposure, manufacturing know-how, and an understanding of what women actually need.$md$,
     '/maison/editorial-atelier.jpg', 'Faitlyn Hair''s founder, whose salon and business background engineered Pixie Girl Global',
     ARRAY['factory-story','founder-story'],
     $blk$[
       {"id":"b1","type":"text","text":"An Ivy League MBA doesn't usually end up in a wig atelier. Ours did — because the real question was never just fashion, it was engineering. How do you build a cap that fits a head that isn't a spreadsheet average? How do you make lace disappear without glue, heat, or a two-hour install? Years on a salon floor taught the questions; years in a classroom taught how to build a company around the answers.","fontFamily":"eb-garamond","fontSize":"lg"},
       {"id":"b2","type":"text","text":"Solving the sizing problem","fontFamily":"marcellus","fontSize":"xl","bold":true},
       {"id":"b3","type":"text","text":"Every wig wearer knows the compromise: a cap that's never quite made for your head, a hairline that shows on close inspection, a fit that works for photos but not for a full day. Faitlyn Hair spent years closing that gap — better sizing, better glueless construction, a fit engineered rather than approximated. That craft became the seed of something bigger.","fontFamily":"eb-garamond","fontSize":"base"},
       {"id":"b4","type":"youtube","url":"https://www.youtube.com/shorts/8C5w-d-CUpc","aspect":"9:16","caption":"“After years of mastering the art of crafting the perfect pixel wig, solving sizing challenges, and creating glueless designs, I'm beyond proud to introduce my new baby: Pixie Girl Global — the world's first global factory dedicated exclusively to pixie wigs.”"},
       {"id":"b5","type":"text","text":"Pixie Girl Global exists because Faitlyn Hair already did the hard part. The market exposure, the manufacturing relationships, the years of understanding exactly what a customer means when she says a wig “doesn't sit right” — all of it became the foundation for a factory built around one silhouette, done properly, for women who wear pixies, and for the salons and companies that serve them worldwide.","fontFamily":"eb-garamond","fontSize":"lg"},
       {"id":"b6","type":"text","text":"A collection built on healing","fontFamily":"marcellus","fontSize":"xl","bold":true},
       {"id":"b7","type":"text","text":"It's been a lifelong passion to create hair solutions that feel natural, effortless and convenient — wigs that blend into real texture without the stress of constant maintenance. That passion became the Natural Big Chop Collection, Faitlyn's first masterpiece for women of colour everywhere: soft curls to relaxed textures, finished in the finest HD lace, melted seamlessly into the skin, set into a glueless cap built to feel like second skin. No struggle. No fuss. Just a perfect fit.","fontFamily":"eb-garamond","fontSize":"base"},
       {"id":"b8","type":"youtube","url":"https://www.youtube.com/shorts/eQB7wqlIiAQ","aspect":"9:16","caption":"“This collection isn't just about beauty, it's about freedom. We didn't just create wigs — we created healing, we created power, we created something that feels like you.”"},
       {"id":"b9","type":"text","text":"It's for the woman who's battled alopecia or cancer. For the woman rediscovering her glow after loss or change. For the everyday woman who simply wants ease, confidence, and authenticity. So when you wear your Pixie Girl wig, you're not putting on hair — you're putting on confidence, softness, and strength. That is the thread between both companies: Faitlyn taught the craft, Pixie Girl Global builds it at scale, and every piece either makes is still, at heart, someone's healing.","fontFamily":"eb-garamond","fontSize":"lg","italic":true}
     ]$blk$::jsonb,
     'published', now(), true, 22, 4),

    -- ── Article 3: the craftsmanship / artisan piece ──
    ('journal', 'built-from-scratch-anatomy-of-a-masterpiece',
     'Built From Scratch: The Anatomy of a Masterpiece',
     $md$From a single raw virgin strand to the final hand-tied knot — inside the making of a pixie wig, beat by beat.$md$,
     $md$Every Faitlyn piece starts as raw virgin hair — full cuticle, aligned root to tip — long before it becomes a finished style. From there it moves through HD Swiss lace, a hand-drawn custom hairline, and thousands of individually hand-tied knots in the ventilation process. This is the anatomy of a masterpiece: not assembled, but built, strand by strand, by hand.$md$,
     '/maison/product-straight.jpg', 'Raw virgin hair being prepared for hand-tied ventilation',
     ARRAY['craftsmanship','artisan'],
     $blk$[
       {"id":"b1","type":"text","text":"A finished wig looks effortless. What it took to get there rarely does. Every Pixie Girl piece begins as a single raw virgin strand, long before it resembles anything you'd recognise as a style — and the distance between those two points is where the craft actually lives.","fontFamily":"eb-garamond","fontSize":"lg"},
       {"id":"b2","type":"text","text":"The raw material","fontFamily":"marcellus","fontSize":"xl","bold":true},
       {"id":"b3","type":"image","url":"/maison/product-straight.jpg","alt":"Raw virgin hair bundles before construction","caption":"Full cuticle, aligned root to tip — the raw virgin hair every piece begins with. Nothing stripped, nothing blended, nothing assumed."},
       {"id":"b4","type":"text","text":"The lace","fontFamily":"marcellus","fontSize":"xl","bold":true},
       {"id":"b5","type":"text","text":"High-end HD Swiss lace is chosen for one reason: it disappears. Before a single strand is ventilated, the hairline is drawn by hand — not templated, not symmetrical by default, but built to follow the way hair actually grows at your own temple and part.","fontFamily":"eb-garamond","fontSize":"base"},
       {"id":"b6","type":"image","url":"/maison/editorial-atelier.jpg","alt":"Custom hairline construction on HD Swiss lace","caption":"The hairline is drawn by hand before a single strand is ventilated — the difference between a wig that reads as hair and one that reads as a wig."},
       {"id":"b7","type":"text","text":"Hand-tied, strand by strand","fontFamily":"marcellus","fontSize":"xl","bold":true},
       {"id":"b8","type":"instagram","url":"https://www.instagram.com/reel/DIT40l9NxSj","aspect":"9:16","caption":"Inside the workroom: raw virgin hair, HD Swiss lace, and the hand-tied ventilation that turns a bundle into a masterpiece."},
       {"id":"b9","type":"text","text":"Ventilation is the slowest step and the one that can't be rushed — each knot tied by hand, strand by strand, until the density and direction match how hair actually falls. It's the difference between a wig that photographs well and one that survives a full day, a workout, a rainy commute, still sitting exactly as it should. Built from scratch, every time.","fontFamily":"eb-garamond","fontSize":"lg","italic":true}
     ]$blk$::jsonb,
     'published', now(), false, 23, 3)
  ON CONFLICT (slug) DO NOTHING;
END $do$;
