-- ============================================================
-- MIGRATION 000296 — Help Center content: Notifications & Feed
-- Pixie Girl Hub · V2.2 §6.30 (Notifications) · §6.30 (Help Center) [PR3]
--
-- Grounded in src/shared/notifications + apps/admin/src/pages/
-- Notifications*: list, unread-count, mark read / read-all / bulk,
-- per-type preferences; the top-bar bell and real-time feed; push.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('notifications', 'Notifications & Feed',
   'The bell and the feed — real-time alerts, how to manage them, and which ones reach your phone.',
   'Bell', 76)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'notifications-overview',
  'How notifications work',
  'The bell in the top bar collects everything that needs you — approvals, urgent insights, mentions — in real time, in one feed.',
  $md$
## What it is

**Notifications** (the **bell** in the top bar, and `/notifications`) is the
single feed of things that need your attention — an approval waiting on you, a new
urgent Praxis insight, an event on a record you follow. It updates in **real
time**, so the bell reflects what's happening as it happens.

## The bell and the feed

- The **bell** shows an **unread count** — a glance tells you if something's
  waiting.
- The **feed** lists notifications newest-first; open one to jump straight to the
  record it's about.

## What sends notifications

Notifications come from across the Hub: workflow **approvals**, **Praxis Insights**
(new High/Critical findings ping the bell), messaging, and record activity. It's
the common surface where every module says "you're needed here."
$md$,
  'all', 'notifications',
  ARRAY['notifications','bell','feed','overview'], 10
FROM shared.help_categories c WHERE c.slug = 'notifications'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Managing & preferences ────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'notifications-managing-and-preferences',
  'Clearing notifications and choosing what you get',
  'Mark items read (one, in bulk, or all), and set per-type preferences so you only get pinged for what matters to you.',
  $md$
## Clearing the feed

Keep the bell meaningful by clearing what you've handled:

- **Mark read** on a single item,
- **bulk** actions on a selection,
- **Read all** to clear the lot.

An unread count only helps if it means "unhandled" — so clear as you go.

## Preferences

**Preferences** (here and in Settings → Notifications) let you choose, **per
notification type**, whether you're notified and how. Turn down the noise you
don't need so the important ones stand out — a bell that pings for everything gets
ignored.

## Push to your phone

Where **push** is enabled, the notifications that matter (new urgent insights,
approvals for you) can reach your **phone**, not just the app — so you don't have
to be at your desk to know something needs you.
$md$,
  'all', 'notifications',
  ARRAY['notifications','read','preferences','push','mute'], 20
FROM shared.help_categories c WHERE c.slug = 'notifications'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'notifications-faq',
  'Notifications FAQ',
  'Too many notifications, phone alerts, what pings the bell, and notifications vs the Insights Center.',
  $md$
## "I'm getting too many notifications."

Tune **Preferences** — per type, decide what you're notified about. The goal is a
bell that only lights up for things you actually need to act on.

## "How do I get alerts on my phone?"

Enable **push**. Then the important notifications (urgent insights, approvals for
you) reach your phone, not just the app.

## "What actually pings the bell?"

Things that need *you*: approvals routed to you, **new High/Critical Praxis
insights**, messages, and activity on records you're involved in. Existing/already-
seen items don't re-ping.

## "Notifications or the Insights Center?"

The **bell** tells you *something happened, act now*. The **Insights Center** is
the full, filterable list of open findings to work through. The bell is the
nudge; the Center is the worklist.

## "Do I share notifications with my team?"

No — notifications are **yours**, routed to you based on your role and what you're
involved in. Your colleague sees theirs.
$md$,
  'all', 'notifications',
  ARRAY['notifications','faq','push','preferences','insights'], 30
FROM shared.help_categories c WHERE c.slug = 'notifications'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify: SELECT slug FROM shared.help_articles WHERE related_module='notifications';
-- expected: 3 rows
-- ============================================================
