-- ============================================================
-- MIGRATION 000284 — Help Center content: Contacts & Directory
-- Pixie Girl Hub · V2.2 §6.1 (Contacts) · §6.30 (Help Center)  [PR2]
--
-- Seeds the full Contacts set: overview (the shared directory), profiles
-- & timeline, tags & segments, import/export, and a FAQ.
--
-- Grounded in src/shared/contacts + apps/admin/src/pages/contacts:
-- segments, milestones, stats, tags (merge), import-template/import/
-- export, contact timeline/summary/tags/addresses; loyalty tab.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('contacts', 'Contacts & Directory',
   'The one shared directory of people — customers, suppliers and staff — with tags, segments and history.',
   'Contact', 64)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-overview',
  'The one directory everything shares',
  'Every person the Hub knows lives here once — customers, suppliers, staff — and every other module reads the same record.',
  $md$
## What it is

**Contacts** (sidebar → **Contacts**, or `/contacts`) is the **single directory**
of everyone the business deals with — customers, suppliers, partners and staff.
The point is *one record per person*: CRM, Sales, Invoicing, Purchasing, HR and
Messaging all read the same contact, so there's no re-typing and no conflicting
copies.

## What a contact carries

- core details (name, channels, addresses),
- **tags** and **segments** for grouping,
- a **timeline** of interactions,
- a **summary** and **stats** (their value, activity),
- links to their orders, invoices, loyalty and more.

## Why one directory matters

When a customer changes their phone number, you change it **once** and it's
correct in Sales, Messaging and Invoicing at the same time. Duplicate or siloed
contacts are how businesses message the wrong number and lose history — the shared
directory is the fix.
$md$,
  'all', 'contacts',
  ARRAY['contacts','directory','overview','shared'], 10
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Profiles & timeline ───────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-profile-and-timeline',
  'The contact profile, timeline and addresses',
  'Open anyone to see their full history, log an interaction, and keep their addresses on file for delivery and billing.',
  $md$
## The profile

Open a contact for their full profile — details, tags, stats, and the modules
they touch. It's the 360° view the whole Hub contributes to: a sale, a message, a
loyalty change all show up here.

## The timeline

The **timeline** is the running history of interactions with that person —
messages, orders, activities, milestones. **Log an activity** to record a call or
a visit, so the next person sees the full story rather than starting cold.

## Addresses

Keep a contact's **addresses** on file (delivery, billing). Logistics quotes
delivery to them and Invoicing bills to them from these, so getting the address
right once saves errors downstream.

## Milestones

**Milestones** mark meaningful moments (first order, anniversary, VIP status) —
the hooks Retention and Marketing use to reach out at the right time.
$md$,
  'all', 'contacts',
  ARRAY['contacts','profile','timeline','addresses','milestones'], 20
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Tags, segments & import/export ────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-tags-segments-import',
  'Tags, segments and importing contacts',
  'Group people with tags, build reusable segments for targeting, and bring in (or export) your directory in bulk.',
  $md$
## Tags

**Tags** are free labels you attach to contacts (VIP, wholesale, stylist,
lapsed). You can **merge** tags to tidy duplicates. Tags are the quick way to
group people without a rigid structure.

## Segments

A **segment** is a defined group of contacts (e.g. "customers who bought in the
last 90 days"). Segments are reusable in **Marketing** and **Retention** for
targeting — build the audience once, use it across campaigns.

## Import & export

For bulk work, use the **import template**: export the template, fill it with your
contacts, and **import**. You can also **export** the directory. This is how you
onboard an existing customer list or hand off data — without typing hundreds of
records.

## Keep it clean

Because everything shares this directory, duplicates and bad tags spread
everywhere. Merging tags, de-duplicating and consistent segments are small habits
that keep every module that reads Contacts accurate.
$md$,
  'all', 'contacts',
  ARRAY['contacts','tags','segments','import','export'], 30
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'contacts-faq',
  'Contacts FAQ',
  'One record vs many, duplicates, tags vs segments, importing a list, and who the directory includes.',
  $md$
## "Do customers, suppliers and staff all live here?"

Yes — Contacts is the **one directory** for everyone. A person is one record,
whatever role they play, and each module reads the parts it needs.

## "I think there are duplicate contacts."

Search before adding, and use tag **merge** and de-duplication to tidy up.
Duplicates are costly because the history splits across them — better to catch
them early.

## "Tag or segment — what's the difference?"

A **tag** is a simple label you stick on a contact. A **segment** is a defined
group (often rule-based) you reuse for targeting in Marketing/Retention. Tags
describe; segments target.

## "How do I bring in my existing customer list?"

Use the **import template**: download it, fill it in, import. That loads many
contacts at once instead of adding them one by one.

## "If I edit a contact here, does it change everywhere?"

Yes — that's the point of a shared directory. Update once and Sales, Messaging,
Invoicing and the rest all see the corrected record.
$md$,
  'all', 'contacts',
  ARRAY['contacts','faq','duplicates','tags','segments','import'], 40
FROM shared.help_categories c WHERE c.slug = 'contacts'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'contacts'
--   ORDER BY sort_order;  -- expected: 4 rows
-- ============================================================
