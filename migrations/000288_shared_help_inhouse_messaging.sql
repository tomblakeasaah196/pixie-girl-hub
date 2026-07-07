-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 000288 — Help: In-house messaging (colleagues) + draggable launcher   ║
-- ║                                                                      ║
-- ║ Two additions to the messaging category so the Help Center matches   ║
-- ║ what the UI now exposes:                                             ║
-- ║  1. "Message a colleague (in-house chat)" — how to start a 1:1 DM,   ║
-- ║     the new In-house tab, deep links from Employee 360, and rules   ║
-- ║     about groups/direct messages.                                    ║
-- ║  2. "Move the floating quick-actions button" — the FAB in the bottom ║
-- ║     right is now draggable (click+drag on desktop, hold 2 s on       ║
-- ║     mobile). Mirrors to Praxis for grounded answers.                 ║
-- ║                                                                      ║
-- ║ Additive — new slugs, ON CONFLICT (slug) DO NOTHING. Praxis mirror   ║
-- ║ appended for both.                                                   ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

INSERT INTO shared.help_articles
  (category_id, slug, title, summary, audience, related_module,
   body_markdown, sort_order, tags)
VALUES
  ((SELECT category_id FROM shared.help_categories WHERE slug = 'messaging'),
   'message-a-colleague-inhouse',
   'Message a colleague (in-house chat)',
   'Two ways to start a 1:1 chat with anyone on the team — the In-house tab in the inbox, and the Message button on any employee profile.',
   'all',
   'smartcomm',
$$
# Message a colleague

The Messaging module isn't only for customers — it's also the in-house chat
for the team. There are two places you can start a conversation with a
colleague, and both end up in the same thread (so a repeat chat with Samuel
never spawns a duplicate).

## From Messaging → In-house tab

1. Open **Messaging** (sidebar, or the message icon on the floating button in
   the bottom-right).
2. Above the conversation list you'll see the tabs
   **All · Unread · In-house · Groups · WhatsApp · Instagram · Email**.
   Tap **In-house** — that filter shows only staff chats (1:1 DMs and internal
   groups), no customer threads.
3. Tap the **+** at the top-right of the inbox header. A dialog opens with the
   full staff list. Type a name or a role — for example "Samuel" or
   "Operations Manager" — and pick the person.
4. The chat opens straight away. If you've messaged them before, you're back
   in the existing thread; if not, a new one is created.

## From an employee's profile

If you're already looking at someone in HR, use the shortcut:

1. Open **HR → Employees** and click the person's name.
2. On their profile, click **Message**. It jumps you into Messaging with their
   thread open (again: same find-or-create rule — one thread per colleague).

## Groups vs 1:1 direct messages

- **1:1 DMs** are what the New-conversation button and the Employee-360
  Message button create. Only the two of you see them.
- **Group chats** are for a team huddle (e.g. "Ops daily", "Lagos store"). To
  make one, use the Groups tab and pick the members. Groups also live under
  the In-house tab.

## Notes

- The person you're messaging needs a login on the Hub (a `user_id`). Staff
  who exist only as HR profiles (no login) don't appear in the picker.
- In-house chats never cost money. WhatsApp per-message fees only apply when
  the customer is on the other end.
- Unread in-house chats count towards the red badge on the floating button
  and the sidebar, same as any other channel.
$$,
   40,
   ARRAY['messaging','in-house','team','dm','colleague','staff']),

  ((SELECT category_id FROM shared.help_categories WHERE slug = 'getting-started'),
   'move-floating-quick-actions-button',
   'Move the floating quick-actions button',
   'The Plus button in the bottom-right (Praxis · Messages · Help) can be dragged out of the way if it covers something you need to see.',
   'all',
   NULL,
$$
# Move the floating quick-actions button

The pink **Plus** button in the bottom-right corner of every screen is the
floating launcher — it fans out to Praxis AI, Messages and Help, and carries
the unread badge. It stays visible on top of every page so you can jump to a
message or ask Praxis without losing your place. Occasionally it sits on top
of something you need to see (a table total, a save button on a small
window). You can move it.

## On desktop (mouse or trackpad)

- **Click and drag** the button to the corner you want.
- A short click without moving still opens Praxis — nothing changes there.

## On mobile (touch)

- **Press and hold** the button for about **2 seconds** — you'll feel a short
  vibration and see a highlight ring appear.
- Then, keeping your finger down, **drag it** to a new spot and let go.
- A quick tap without holding still opens the mini-menu (Praxis · Messages ·
  Help) — the hold is only needed when you want to move it.

## Where it ends up

- Your new position is remembered per device (a browser setting), so it stays
  put next time you sign in on the same phone or computer.
- If you rotate the phone or resize the window and the button would fall
  off-screen, it snaps back inside so you never lose it.
- You can drag it back to the corner any time. There's no "reset" button —
  just drag it to where you want it.

## The Plus button in short

Whatever the button is on top of, drag it out of the way — desktop is a
click-and-drag, mobile is a two-second hold, then drag.
$$,
   80,
   ARRAY['ui','floating','launcher','draggable','fab','accessibility'])
ON CONFLICT (slug) DO NOTHING;

-- Mirror both new articles into the Praxis knowledge base (same idempotent
-- pattern used across the help set).
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
    'article_id',     a.article_id,
    'slug',           a.slug,
    'audience',       a.audience,
    'related_module', a.related_module,
    'tags',           a.tags
  )
FROM shared.help_articles a
WHERE a.slug IN (
        'message-a-colleague-inhouse',
        'move-floating-quick-actions-button')
  AND a.praxis_indexed = true
  AND a.is_active      = true
  AND NOT EXISTS (
    SELECT 1 FROM shared.ai_knowledge_chunks k
     WHERE k.source_type = 'custom'
       AND k.source_ref  = 'help_article:' || a.slug
  );

COMMIT;
