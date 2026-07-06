-- ============================================================
-- MIGRATION 000295 — Help Center content: Storefront Studio
-- Pixie Girl Hub · V2.2 §6.21 (Storefront Studio) · §6.30 (Help)  [PR3]
--
-- Grounded in src/modules/storefront_studio + apps/admin/src/pages/
-- storefront-studio: tabs Theme / Branding / Toolbar / Navigation /
-- Pages / Content / Popups / Preview / Revisions; theme/navigation/pages/
-- content publish, popups, section templates, preview, revisions.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('storefront-studio', 'Storefront Studio',
   'Designing the storefront — theme, branding, navigation, pages, content and pop-ups, with preview and revisions.',
   'Palette', 75)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'studio-storefront-overview',
  'What Storefront Studio does',
  'The no-code designer for your public storefront: theme, branding, navigation, pages and content — previewed before you publish.',
  $md$
## What it is

**Storefront Studio** (sidebar → **Storefront Studio**, or `/storefront-studio`)
is the no-code designer for how your **public storefront** looks and reads. You
shape the theme, branding, menus, pages and content here, preview it, and publish
when it's right.

## The tabs

- **Theme** — colours, fonts and the overall look.
- **Branding** — logos and brand assets.
- **Toolbar** — the storefront's top-bar controls.
- **Navigation** — the menus customers use to get around.
- **Pages** — the storefront pages themselves.
- **Content** — content blocks / posts on the site.
- **Popups** — promotional or informational pop-ups.
- **Preview** — see changes before they go live.
- **Revisions** — the version history, so you can roll back.

## Draft, preview, publish

Nothing you change is live until you **publish** it. Work in draft, check it in
**Preview**, and publish theme, navigation, a page or content when you're happy —
so customers only ever see finished work.
$md$,
  'ceo', 'storefront_studio',
  ARRAY['storefront','studio','overview','theme'], 10
FROM shared.help_categories c WHERE c.slug = 'storefront-studio'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Building the storefront ───────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'studio-building-the-storefront',
  'Theme, pages, content and pop-ups',
  'Set the theme and branding, build pages from section templates, add content and pop-ups, then publish each piece independently.',
  $md$
## Theme & branding

Set your **theme** (colours, type) and **branding** (logo, assets) so the
storefront matches the business. These are the look every page inherits.

## Pages & section templates

Build **pages** from **section templates** — pre-made building blocks you arrange
rather than coding from scratch. Add and order sections to compose a page, then
**publish** it.

## Content & pop-ups

- **Content** blocks/posts add editorial to the site (announcements, stories).
- **Popups** surface a message or offer at the right moment.

Each publishes on its own, so you can update a single page or pop-up without
republishing the whole site.

## Navigation & toolbar

**Navigation** defines the menus customers use, and the **Toolbar** the top-bar
controls. Getting these right is what makes the storefront easy to move around —
publish them like anything else.
$md$,
  'ceo', 'storefront_studio',
  ARRAY['storefront','pages','content','popups','navigation','publish'], 20
FROM shared.help_categories c WHERE c.slug = 'storefront-studio'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Preview & revisions ───────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'studio-preview-and-revisions',
  'Previewing and rolling back changes',
  'See exactly what customers will see before publishing, and use revisions to roll back if a change didn''t land.',
  $md$
## Preview

**Preview** shows your draft as customers will see it — before it's live. Always
preview a significant change; it's the difference between catching a broken layout
yourself and hearing about it from a customer.

## Revisions

**Revisions** keep the version history of your storefront. If a published change
turns out wrong, you can **roll back** to a previous version rather than
scrambling to undo it by hand. It's your safety net for going live confidently.

## The connection to Logistics

Storefront Studio also owns the **vocabulary and templates** used elsewhere — the
delivery-letter templates and the tracking-timeline wording that **Logistics**
uses. Studio defines them; Logistics applies them. So a change to how your delivery
letters read is made here.
$md$,
  'ceo', 'storefront_studio',
  ARRAY['storefront','preview','revisions','rollback','templates'], 30
FROM shared.help_categories c WHERE c.slug = 'storefront-studio'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'studio-storefront-faq',
  'Storefront Studio FAQ',
  'Do changes go live instantly, rolling back, delivery-letter wording, and Studio vs the Catalogue.',
  $md$
## "Do my changes go live instantly?"

No — you work in **draft**, check **Preview**, and **publish** when ready. Each
piece (theme, a page, content, a pop-up) publishes on its own, so customers only
see finished changes.

## "I published something that broke — can I undo it?"

Yes — use **Revisions** to roll back to a previous version. That's exactly what
the version history is for.

## "Where do I change how my delivery letters read?"

Here — Storefront Studio owns the **templates and vocabulary** (delivery letters,
tracking-timeline wording) that Logistics uses to generate and display them.

## "Studio or Catalogue — which do I use?"

**Catalogue** defines the products (what you sell). **Storefront Studio** defines
how the site that sells them looks and reads. Products come from Catalogue; the
shopfront around them is built here.
$md$,
  'ceo', 'storefront_studio',
  ARRAY['storefront','faq','publish','revisions','logistics','catalogue'], 40
FROM shared.help_categories c WHERE c.slug = 'storefront-studio'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify: SELECT slug FROM shared.help_articles WHERE related_module='storefront_studio';
-- expected: 4 rows
-- ============================================================
