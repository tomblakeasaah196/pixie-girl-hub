-- ============================================================
-- MIGRATION 000288 — Help Center content: Social Media
-- Pixie Girl Hub · V2.2 §6.15 (Social) · §6.30 (Help Center)  [PR3]
--
-- Grounded in src/modules/social_media + apps/admin/src/pages/social:
-- accounts, posts (publish now / draft / schedule), post metrics refresh,
-- DM ingest; platform accounts, reach metrics.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('social', 'Social Media',
   'Connecting accounts, publishing and scheduling posts, and reading reach — free at any volume.',
   'Share2', 70)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'social-overview',
  'What Social Media does',
  'Connect your platforms once, then publish or schedule posts and track their reach — all from inside the Hub.',
  $md$
## What it is

**Social** (sidebar → **Social**, or `/social`) lets you connect your social
accounts, publish or schedule posts to them, and see how those posts performed —
without hopping between apps.

## What you can do

- **Connect accounts** — link your platform accounts (Instagram, Facebook and the
  others you use).
- **Publish now / Save draft / Schedule** — post immediately, park a draft, or
  set it to go out later.
- **Read metrics** — refresh a post's metrics to see its reach and engagement.
- **DM ingest** — inbound DMs flow into **Messaging** (the unified inbox), so a
  comment or DM that starts a conversation lands where you can reply.

## The cost angle

Social posts and Instagram/Facebook reach are **free at any volume** — which is
exactly why the Hub's channel policy pushes marketing here and to email rather
than paid WhatsApp blasts. Posting to your followers costs nothing; reaching the
same people on WhatsApp would cost per message.
$md$,
  'all', 'social',
  ARRAY['social','overview','posts','reach'], 10
FROM shared.help_categories c WHERE c.slug = 'social'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Posting & scheduling ──────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'social-posting-and-scheduling',
  'Publishing and scheduling posts',
  'Compose once, choose the platforms, and publish now or schedule for later — then refresh metrics to see how it did.',
  $md$
## Composing a post

Write your post, pick the **platforms** it should go to and the **post type**,
and attach media. One composer can target several accounts at once, so you're not
re-posting the same thing app by app.

## Now, draft or scheduled

- **Publish now** — it goes out immediately.
- **Save draft** — keep it to finish or approve later.
- **Schedule** — set a date/time and the Hub publishes it for you.

## Metrics

After a post is live, **refresh its metrics** to pull reach and engagement back
from the platform. That's how you learn what content works — the same numbers
feed your Marketing view of what's driving attention.

## When something fails

Praxis Insights flags a **scheduled post that failed to publish** (or is overdue)
and a platform **access token expiring within 7 days** (High on the last day).
Reconnect the account before the token lapses so publishing doesn't silently
break.
$md$,
  'all', 'social',
  ARRAY['social','posts','schedule','metrics','tokens'], 20
FROM shared.help_categories c WHERE c.slug = 'social'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'social-faq',
  'Social FAQ',
  'Connecting accounts, where DMs go, a failed scheduled post, and why social is the cheap channel.',
  $md$
## "How do I connect an account?"

Add it under **accounts** and authorise the platform. Once connected you can post
to it and pull its metrics. If a post starts failing, the account's **token** may
have expired — reconnect it.

## "A customer replied to my post — where does that go?"

Inbound DMs are **ingested into Messaging** (the unified inbox), so you reply
there in one thread rather than inside each platform's app.

## "My scheduled post didn't go out."

Praxis flags failed/overdue scheduled posts. Usually it's an expired **access
token** — reconnect the account and re-schedule. The insight clears once it
publishes.

## "Why does the Hub push me to post here instead of WhatsApp?"

Because social posts reach your audience for **free** at any volume, while a
WhatsApp blast costs per recipient. For broad reach, Social and email are the
cost-smart channels — WhatsApp is reserved for time-sensitive, one-to-one moments.
$md$,
  'all', 'social',
  ARRAY['social','faq','accounts','dm','tokens','cost'], 30
FROM shared.help_categories c WHERE c.slug = 'social'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify: SELECT slug FROM shared.help_articles WHERE related_module='social';
-- expected: 3 rows
-- ============================================================
