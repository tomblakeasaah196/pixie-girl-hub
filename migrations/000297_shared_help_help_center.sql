-- ============================================================
-- MIGRATION 000297 — Help Center content: Using the Help Center
-- Pixie Girl Hub · V2.2 §6.30 (Help Center) · §6.30 (Help Center)  [PR3]
--
-- Meta-guides for the Help Center itself: how to use it, how Praxis
-- shares its content, and how to edit help content in-app (the editor
-- shipped in this PR).
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('help-center', 'Using the Help Center',
   'How to find answers here, how Praxis shares the same content, and how to edit the guides.',
   'HelpCircle', 77)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Using it ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'help-using-the-help-center',
  'Finding answers in the Help Center',
  'Browse by module or search across every guide — and the same content answers your questions inside Praxis.',
  $md$
## Two ways in

- **Browse** — the Help Center (`/help`) groups guides by area. Find the module
  you're in and read its overview, how-tos and FAQ.
- **Search** — the search box scans every article's title, summary and body. Type
  what you're after ("layaway", "below cost", "off-site clock-in") and jump
  straight to it.

## What's in a guide

Each module has a full set: an **overview** (what it's for), **task how-tos** (how
to do the common things), and an **FAQ** (the questions people actually ask). An
article shows who it's **for** and links to the **module** it's about.

## Ask Praxis the same questions

Every article here is indexed for **Praxis**, so instead of searching you can just
**ask** — "why can't my staff start a WhatsApp chat?" — and Praxis answers from the
very same text, in plain language. The Help Center and Praxis never disagree
because they read one source.
$md$,
  'all', 'help_center',
  ARRAY['help-center','search','browse','praxis'], 10
FROM shared.help_categories c WHERE c.slug = 'help-center'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Editing help content ──────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'help-editing-content',
  'Editing help content (the Help Editor)',
  'With edit permission you can write and update guides live — and the moment you save, Praxis learns the change too.',
  $md$
## The Help Editor

If your role has **edit** permission on the Help Center, you'll see a **Manage /
Edit** entry on the Help Center. It opens the **Help Editor**, where you can:

- **create** a new article — title, summary, category, the module it relates to,
  audience, tags and the body (written in **Markdown**),
- **edit** an existing article,
- **retire** an article (hide it without deleting the record),
- control its **sort order** within a category.

## Live to readers and to Praxis

When you save, two things happen at once: the article updates for **readers**, and
its text is **re-synced into Praxis's knowledge** — so the agent immediately
answers from the new version. There's no separate "publish to AI" step; saving is
publishing to both.

## Writing good help

- Lead with **what it's for**, then **how to do the thing**, then the **FAQ**.
- Write in plain language — the reader may be non-technical.
- Keep it **true to what's built**. The value of this help is that it reflects how
  the Hub actually works; describe what the buttons really do.

## Markdown basics

Use `##` for headings, `-` for bullets, `1.` for numbered steps, `**bold**` for
emphasis, and tables where they help. Keep paragraphs short.
$md$,
  'ceo', 'help_center',
  ARRAY['help-center','editor','markdown','praxis','authoring'], 20
FROM shared.help_categories c WHERE c.slug = 'help-center'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'help-center-faq',
  'Help Center FAQ',
  'Can''t find an article, who can edit, does Praxis update, and audiences.',
  $md$
## "I can't find an answer."

Try the **search** (it scans article bodies, not just titles), or **ask Praxis** in
plain language. If it genuinely isn't covered and you have edit rights, add it in
the Help Editor — if you don't, ask whoever manages the Hub to.

## "Who can edit the guides?"

Anyone whose role has **edit** permission on the Help Center. Most staff read;
managers/owners edit. It's the same permission model as the rest of the Hub.

## "If I edit an article, does Praxis update too?"

Yes — saving re-syncs the article into Praxis's knowledge immediately. Readers and
the AI stay in lockstep.

## "Why does an article say 'For CEO' or 'For staff'?"

That's its **audience** — a hint about who it's written for. Articles marked for a
specific audience are surfaced with that label; general ones are for everyone.
$md$,
  'all', 'help_center',
  ARRAY['help-center','faq','search','editor','audience'], 30
FROM shared.help_categories c WHERE c.slug = 'help-center'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify: SELECT slug FROM shared.help_articles WHERE related_module='help_center';
-- expected: 3 rows
-- ============================================================
