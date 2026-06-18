-- ============================================================
-- MIGRATION 000222 — Help Center articles for the Sales Campaigns
-- module. Same article body is mirrored into ai_knowledge_chunks so
-- the in-builder Praxis "?" chat can answer how-to questions
-- grounded on this text.
-- Pixie Girl Hub · JBS Praxis · V2.2 — Sales Campaigns module PR 1
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order) VALUES
  ('sales-campaigns', 'Sales Campaigns & Landing Pages',
   'Build, launch, and learn from your time-bound sales campaigns.',
   'Megaphone', 35)
ON CONFLICT (slug) DO NOTHING;

-- ── Articles ─────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, audience, related_module,
   body_markdown, sort_order, tags) VALUES
  ((SELECT category_id FROM shared.help_categories WHERE slug='sales-campaigns'),
   'launch-a-sales-campaign',
   'Launch a sales campaign — start to finish',
   'The 6-step builder: brief, bundles, pricing, landing, approvals, launch.',
   'all', 'sales_campaigns',
$body$
# Launch a sales campaign

A sales campaign is a time-bound, landing-page-driven sale at a unique URL
on your **sales subdomain** — for example `sales.pixiegirlglobal.com/sale/black-friday-2026`.
Every campaign moves through three states the engine handles for you:
**Before launch** (countdown + signup form), **Live** (struck prices + stock
counter + Temu-style cart upsells), and **Ended** (sale-closed message + a
nudge to your main storefront so no visitor ever sees a broken page).

## The 6 steps

1. **Brief.** Name, slug, start/end dates, brand voice. The brand voice picker
   loads your Pixie or Faitlyn voice profile so Praxis writes in your tone.
2. **Bundles & products.** Pick bundles from the Catalogue → Bundles tab, or
   compose a one-off bundle inline. Bundles are fixed-composition (your call,
   not the shopper's) with a per-item ₦ discount.
3. **Pricing.** Goal-seek to a target margin, charm-round (₦149,000 / ₦147,990),
   set the quantity-tier ladder ("buy 2 save ₦X, buy 3 save ₦Y"), and design the
   cart upsell escalation. The engine refuses any number below
   `pricing_floors.min_price`.
4. **Landing page.** Drag the blocks you want (Hero, Countdown, Bundle
   Showcase, Quantity Tier Visualiser, Story, Founder Quote, Testimonials,
   UGC, FAQ, Newsletter capture). Reorder by drag. Edit copy inline. Preview
   the Before / Live / Ended states.
5. **Approvals.** Submit for approval. Anyone with `sales_campaigns.approve`
   can launch.
6. **Launch.** Hit Go Live. The engine sends the go-live blast to signups,
   updates the storefront banner, and starts the live analytics dashboard.

## What you can change after launch

You can pause, resume, edit landing copy, swap hero image, toggle pre-order
on individual bundles, and end early. **Prices and bundle composition
require a new approval** — that change is logged and the approver must
sign off again.

## What happens automatically

- Email + push to your pre-launch signup list at go-live.
- Storefront top banner during the live window.
- Daily 8am AI briefing during the campaign with one recommended action.
- Live analytics dashboard with visitors, signups, AOV, revenue, conversion.
- VIP auto-tag on the top 10 spenders when the campaign ends + a "send VIP
  gift" task assigned to the CEO.
- PDF post-campaign report attached to the campaign and emailed.
$body$,
   10, ARRAY['sales','campaigns','launch','wizard']),

  ((SELECT category_id FROM shared.help_categories WHERE slug='sales-campaigns'),
   'bundles-vs-quantity-tiers',
   'Bundles vs quantity-tier discounts — which to use when',
   'Both encourage bigger orders, but they work differently. Here''s when to pick which (and how to combine them).',
   'all', 'sales_campaigns',
$body$
# Bundles vs quantity-tier discounts

The Hub gives you **two distinct levers** for moving multiple units. Don't
treat them as the same thing.

## Bundles — fixed-composition, per-item ₦ off

A bundle is a curated package — *you* decide which 5 Full Frontals go in,
not the shopper. The landing page shows the **full retail total** crossed
out and the **bundle total** in serif underneath, with the **₦ saved**
total in accent below.

Use bundles when:
- You want to control inventory flow (move slower SKUs alongside fast ones).
- The customer should feel like they got a "set" not a discount.
- You want to advertise "5 wigs for ₦X" in IG ads.

## Quantity-tier discounts — buy more, save more

A tier ladder is applied **at the cart** based on unit count. Example: buy 2
units → ₦15,000 off the cart; buy 3 → ₦40,000 off. Fixed ₦ amounts, not
percentages.

Use tiers when:
- You want to incentivise upsell at the cart, not the product page.
- The shopper picks the items themselves.
- You're running a flash sale on a category.

## They can combine

A campaign can have **both**. The cart upsell escalator then surfaces
"add one more bundle and save ₦100,000" popups that pull from the next
tier as the cart grows. This is the Temu-style mechanic Faith described.

## The hard rail

No combination of bundle ₦ + tier ₦ + price-override may take any line
**below `pricing_floors.min_price`**. The engine clamps automatically and
shows a clear warning at the affected line — and refuses to publish if
the warning isn't acknowledged.
$body$,
   20, ARRAY['pricing','bundles','tiers','floors']),

  ((SELECT category_id FROM shared.help_categories WHERE slug='sales-campaigns'),
   'campaign-pricing-and-the-floor',
   'How campaign pricing works — and why the floor stops mistakes',
   'Goal-seek margin, charm rounding, and the floor: the three controls that keep your sales aggressive without ever losing money.',
   'all', 'sales_campaigns',
$body$
# How campaign pricing works

The campaign Pricing step runs the **same Pricing Engine** (V2.2 §6.25) used
elsewhere in the Hub, scoped to this one sale.

## Goal-seek margin

Type a target net margin (e.g. 25%) into the bundle Pricing card. The
engine reads `product_variant_cost_vault.cost_ngn`, adds freight, fees,
and your discount-loss assumption, then returns the **highest price that
hits or beats the target**. You see the breakdown — cost, freight, fees,
margin — every time.

## Charm rounding

Choose a rounding style (₦149,000 / ₦147,990 / round-up nearest 1k). The
engine rounds the goal-seek result then **re-checks the floor**. If the
rounded number breaks the floor, you see a warning and the engine refuses
to publish until you change the input.

## The hard floor

`pricing_floors.min_price` is per-product (or category-default). The engine
will:

1. Refuse to publish any campaign where any line's final price is below the
   floor — even after bundle + tier + cart upsell stacking.
2. Show the affected line(s) with a clear ❗ banner.
3. Refuse to record any Praxis-suggested number that breaches the floor.

## Pre-order pricing (when sold out)

Each bundle has a **preorder discount-loss %** (default 70%). When you flip
the preorder toggle ON for a bundle during the sale, the price during the
preorder window jumps:

`preorder_price = sale_price + (regular_price − sale_price) × discount_loss_pct`

At 70%, the customer who waited and missed it loses 70% of the discount.
Once the sale ends, the regular price returns automatically.
$body$,
   30, ARRAY['pricing','floor','charm','preorder']),

  ((SELECT category_id FROM shared.help_categories WHERE slug='sales-campaigns'),
   'using-praxis-in-the-builder',
   'Using Praxis to draft a campaign',
   'Praxis can draft copy, suggest a layout, propose discount maths, and answer dry-run pricing questions. She never finalises a number on her own.',
   'all', 'sales_campaigns',
$body$
# Using Praxis in the builder

Every step of the campaign builder has a **Praxis sidebar** (open it with the
sparkle icon top-right). She uses your brand voice profile from
`Settings → Business Setup → Public Identity` so the copy sounds like Pixie
or Faitlyn — never generic.

## What she can do

- **Draft hero copy, product blurbs, FAQ entries.** Type a brief like
  *"Black Friday 48h, frontals + Pixie collection, premium tone, no
  exclamation marks"* — she writes the copy and tags it `✦ Drafted by
  Praxis`. You accept, edit, or reject each block.
- **Suggest a block layout.** *"Suggest a layout for a flash sale on
  Pixie wigs"* — she proposes Hero + Countdown + Bundle Showcase + Quantity
  Tier Visualiser + Founder Quote + FAQ in that order with a one-line
  rationale per block. Drag to reorder.
- **Suggest discount maths.** *"Suggest bundle discounts at 25% margin"* —
  she reads costs + floors + your discount-loss assumption and returns a
  full ladder. Each suggested number is `pending` until you click Accept.
- **Dry-run pricing questions.** *"If I price the 5-bundle at ₦400k, what's
  my margin? Does it break the floor?"* — she calls the pricing engine
  read-only and gives you the answer with the maths.

## What she cannot do

- She **cannot apply** any number she suggests until you click Accept.
- She **cannot publish** a campaign — that requires your approval click.
- She **cannot fabricate reviews or superlatives** — the voice profile bans
  this with a hard rail.
- She **cannot generate or invent product images** in v1 — image suggestions
  pick from your existing `product_images` library only.

## How attribution works

Every accepted Praxis suggestion is recorded in `audit_log` with the
prompt, the diff, and your user id. The campaign report shows
"X% of copy drafted by AI" so transparency is intrinsic to every campaign
that uses her.
$body$,
   40, ARRAY['praxis','ai','assistant','drafting']),

  ((SELECT category_id FROM shared.help_categories WHERE slug='sales-campaigns'),
   'sales-subdomain-setup',
   'Setting up your sales subdomain',
   'sales.pixiegirlglobal.com and sales.thefaitlynbrand.com — and what to do for a new brand.',
   'ceo', 'sales_campaigns',
$body$
# Setting up your sales subdomain

The public landing pages live on a dedicated **sales subdomain** per brand —
intentionally separate from your main storefront so the sale is a destination,
not a tab.

## Where to set it

`Settings → Business Setup → Public Identity → Sales subdomain`. Enter the
domain (e.g. `sales.pixiegirlglobal.com`). Save.

Changes to this field require your password.

## DNS configuration

Your DNS provider (Cloudflare for Pixie, similar for Faitlyn) must point a
**CNAME** record from your chosen subdomain to the platform's edge
hostname (your engineer will provide). HTTPS certificates are minted
automatically.

## Adding a third brand

Onboard the brand normally (`bootstrap_business`), fill the
`sales_subdomain` field, and point the DNS CNAME. No code deploy needed —
the host → brand resolver reads the column on every request.

## What if I leave it empty?

The brand simply doesn't run a sales landing. The campaign builder is
hidden from that brand's admin until the field is set.
$body$,
   50, ARRAY['settings','subdomain','dns','onboarding']),

  ((SELECT category_id FROM shared.help_categories WHERE slug='sales-campaigns'),
   'campaign-three-states-and-extras',
   'The three campaign states — Before, Live, Ended (and the optional extras)',
   'How the landing page transforms across the campaign lifecycle, and the optional VIP early-access + last-call extras.',
   'all', 'sales_campaigns',
$body$
# Three states (and the extras)

The same landing-page URL renders differently based on where the campaign
is in its lifecycle. The engine handles the transition automatically.

## Before launch
- Hero with cinematic visual + headline.
- **Countdown clock** to start time in JetBrains Mono tabular numerals.
- **Email + WhatsApp signup form** ("get the heads-up when we open").
- **"Save the date"** download — iCal + Google Calendar link.
- All product cards are in `tease` state: cover image only, no prices.

## Live
- Same hero, the countdown now counts to **end** time.
- Bundles + products show **struck retail price** + **discounted price** + ₦
  saved + per-bundle stock counter (live socket).
- Quantity-tier visualiser shows the next reward (buy 2 save ₦X, buy 3 save ₦Y).
- Cart upsell popups escalate as items are added.
- "X people viewing now" pill (smart auto-hide if viewers < floor).
- "Y just bought from Lagos" ticker (real purchases, throttled to 1/8s,
  city-only).

## Ended
- Hero softens to monochrome over 6 seconds on first load.
- "Sale ended" message + **"Shop our full collection"** CTA → storefront.
- If a **next campaign is scheduled**, an auto-promote panel appears
  ("Next drop: Valentine's") with the new countdown.

## Optional extras (per-campaign toggles)

- **VIP early-access window** — signups get a personal 1h head-start before
  Live opens publicly.
- **Last-call surge** — the final 30min before Ended tilts the palette and
  speeds the tickers to lift urgency. Set the duration in the Schedule step.
- **Sold-out hold** — when a bundle depletes but the campaign is still live,
  CEO can flip preorder on per-bundle (extended delivery timeline + the
  preorder discount-loss price).
- **Waitlist-for-next-drop** — auto-promote the next scheduled campaign on
  the Ended page.
$body$,
   60, ARRAY['states','before','live','ended','vip','last-call']),

  ((SELECT category_id FROM shared.help_categories WHERE slug='sales-campaigns'),
   'best-customers-vip-gifts',
   'Best customers, VIP tag, and the gift workflow',
   'How the Hub picks your top spenders and walks the CEO through gifting them.',
   'all', 'sales_campaigns',
$body$
# Best customers + VIP gifts

When a campaign ends the engine **automatically picks the top N spenders**
(default 10, configurable per campaign), tags them as `campaign_vip`, and
adds them to a `Campaign VIP · {slug}` CRM segment.

## What happens to them

1. **Auto-tag.** Top spenders gain the `campaign_vip` tag in CRM. Anyone who
   crosses your lifetime-spend threshold (Settings → CRM → VIP) also gets
   promoted to `Platinum VIP`.
2. **Gift task.** The Hub creates a *Send VIP gift* task assigned to the
   CEO. The task carries the customer's delivery address, the order they
   placed, and a Praxis-suggested gift category based on their order.
3. **Personalised thank-you.** When the CEO approves the gift task, the
   Hub sends a personalised thank-you from the CEO via email + Instagram
   DM (if a handle exists). WhatsApp is reserved for the top 3 only.

## Ambassador attribution

If the customer arrived via an ambassador link (UTM source = ambassador
name), the ambassador also gets credited in the per-campaign attribution
table. You can pay commissions from there.
$body$,
   70, ARRAY['vip','gifts','crm','ambassadors']),

  ((SELECT category_id FROM shared.help_categories WHERE slug='sales-campaigns'),
   'analytics-and-the-ai-briefing',
   'Reading the live dashboard and the 8am briefing',
   'Visitors, conversion, drop-off, source attribution, AI Q&A — what to actually look at while a campaign is live.',
   'all', 'sales_campaigns',
$body$
# Live analytics

The Live tab opens to a real-time dashboard. The big numbers update via
socket — no refresh needed.

## What to watch

- **Conversion rate** — orders ÷ unique visitors. Anything below 1% in
  the first 30 minutes usually means the hero isn't landing. Ask Praxis
  why and try a copy edit.
- **AOV (average order value)** — moves with bundle uptake. If AOV is
  rising but conversion is flat, your tier ladder is working.
- **Drop-off funnel** — visitors → product views → add-to-cart →
  checkout-started → orders. The biggest drop is usually checkout-started
  → orders (payment friction). Make sure all your gateways are healthy.
- **Per-bundle performance** — which bundle pulled traffic vs which sold.

## The 8am AI briefing

Each morning during a campaign the Hub emails the CEO a Praxis-drafted
briefing: yesterday's numbers, the top 3 movers, and **one recommended
action** (e.g. "swap the hero image on the Pixie collection — Frontals
are converting 3× better"). This is a draft — Praxis never auto-applies
changes.

## Asking Praxis questions

Type any question into the Live tab's Praxis box. Examples:
- "Which bundle made the most yesterday?"
- "Why did conversion drop after 3pm?"
- "If I raise the 5-bundle to ₦450k, does it still beat the floor?"

She answers with the numbers + a chart, and for "why" questions adds
explicit *not certain, possible reasons:* hypotheses.
$body$,
   80, ARRAY['analytics','dashboard','briefing','praxis']),

  ((SELECT category_id FROM shared.help_categories WHERE slug='sales-campaigns'),
   'share-kit-and-ambassadors',
   'Share kit, QR codes, and ambassador trackable links',
   'Generating the WhatsApp / Instagram / email copy, the QR code, and per-ambassador UTM links.',
   'all', 'sales_campaigns',
$body$
# Share kit

Every campaign has a **Share Kit** tab. You don't have to write a single
post — the kit pre-formats:

- **WhatsApp text** — short, with the link + a 🔥 hook.
- **Instagram caption** — 3 alt-text variants.
- **Email subject + body** — plain text and HTML.
- **X / Twitter** — one-liner with hashtags.
- **Facebook** — paragraph length.

All copy honours your brand voice profile. Hit Copy → paste → send.

## QR code

Each campaign also gets a high-resolution QR (downloadable PNG) for prints,
flyers, and Instagram stories. The QR encodes the sales URL with
`utm_source=qr`.

## Ambassador trackable links

Open **Share Kit → Ambassadors**. The list pulls from contacts where
`is_ambassador = true` (you tag them in **Contacts → Ambassadors**). Pick
the ambassadors involved → one trackable link per ambassador, with
`utm_source = {ambassador_handle}`.

After the campaign you'll see attribution per ambassador in the analytics
dashboard — visitors, conversions, revenue. Pay commissions from there.
$body$,
   90, ARRAY['share-kit','qr','ambassadors','utm']),

  ((SELECT category_id FROM shared.help_categories WHERE slug='sales-campaigns'),
   'temu-style-upsells-and-the-don-t-leave-policy',
   'Temu-style upsells, exit-intent, and the don''t-leave-without-buying playbook',
   'How the Hub uses cart upsells, exit-intent modals, and free-shipping (no — DHL is real) to drive conversion without feeling cheap.',
   'all', 'sales_campaigns',
$body$
# The don't-leave-without-buying playbook

Faith's instruction was direct: every visitor who lands on the page during
a sale should leave a buyer. The Hub gives you four levers — none of them
fake, all of them on-brand.

## 1. Escalating cart upsell popups

The moment a shopper opens the cart, the cart-upsell engine surfaces the
**next best offer** from the ladder you configured: *"Add one more bundle
and save an extra ₦100,000."* Add the bundle → next message: *"Add a
second and save ₦175,000 more."* Polite glass-style popups, dismissible,
on-brand. No blink-blink Temu energy. Configurable per campaign.

## 2. Exit-intent modal

When the cursor moves to leave the page or the back gesture fires, a
one-time exclusive code surfaces ("Take ₦10,000 off your first bundle —
ends with this session"). Single-use code, CEO-toggleable per campaign.

## 3. Social proof, smart

- "X people viewing now" — real socket count, smart-hidden when below
  the floor (default 20) so the page doesn't look empty on slow hours.
- "Y just bought from Lagos" — real purchase, throttled to 1 every 8s,
  city-only (never name). Never synthetic.

## 4. Persistent cart + free-shipping meter

Sticky bottom checkout bar shows `Checkout · N items · ₦X`. The
free-shipping meter is **disabled** — DHL rates are real and we never
fake free shipping. Use the meter slot for the next-tier ladder instead
("Add ₦25,000 more to unlock the 3-bundle tier").
$body$,
   100, ARRAY['conversion','upsells','exit-intent','social-proof'])
ON CONFLICT (slug) DO NOTHING;

-- ── Mirror to RAG corpus for Praxis chat retrieval ──
INSERT INTO shared.ai_knowledge_chunks
  (source_type, source_ref, business, title, content, token_count,
   sensitivity, content_hash, metadata)
SELECT
  'custom',
  'help_article:' || a.slug,
  NULL,
  a.title,
  a.body_markdown,
  GREATEST(1, LENGTH(a.body_markdown) / 4),
  'public',
  md5(a.body_markdown),
  jsonb_build_object(
    'article_id', a.article_id,
    'slug',       a.slug,
    'audience',   a.audience,
    'related_module', a.related_module,
    'tags',       a.tags
  )
FROM shared.help_articles a
WHERE a.related_module = 'sales_campaigns'
  AND a.praxis_indexed  = true
  AND a.is_active       = true
ON CONFLICT DO NOTHING;

-- Verify:
--   SELECT slug, title FROM shared.help_articles
--    WHERE related_module = 'sales_campaigns' ORDER BY sort_order;
