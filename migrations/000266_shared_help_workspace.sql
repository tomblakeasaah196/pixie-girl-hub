-- ============================================================
-- MIGRATION 000266 — Help Center content: Workspace (Tasks & Calendar)
-- Pixie Girl Hub · V2.2 §6.28 (Tasks) / §6.29 (Calendar) · §6.30 (Help)
--
-- Seeds the full Workspace set: overview, My Day, Tasks (board &
-- subtasks), Calendar (views & linking to records), and a FAQ.
--
-- Grounded in apps/admin/src/pages/workspace (tabs My Day / Calendar /
-- Tasks; calendar views Month/Week/Day/Agenda) and the shared tasks +
-- calendar routers (task board, subtasks, status; events by-reference).
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('workspace', 'Workspace: Tasks & Calendar',
   'Your day in one place — a personal My Day, assignable tasks, and a shared calendar linked to records.',
   'CalendarDays', 18)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'workspace-overview',
  'What Workspace is',
  'The personal command deck: My Day pulls together what matters today, Tasks organise the work, and the Calendar keeps the schedule — all linked to real records.',
  $md$
## What it is

**Workspace** (sidebar → **Workspace**, or `/workspace`) is your personal
command deck. Instead of hunting across modules for what you owe today, it
gathers your tasks and events into one place.

## The three tabs

- **My Day** — today at a glance: tasks due, events coming up, the things that
  need you now.
- **Tasks** — a board of assignable to-dos with statuses and subtasks.
- **Calendar** — a shared schedule with Month, Week, Day and Agenda views.

## Why it's linked, not standalone

Tasks and calendar events can be **attached to records** elsewhere — a task on
a deal, an event tied to a delivery or a customer. That's what makes Workspace
more than a notepad: the work here points back to the actual thing it's about,
and updating one is visible from the other.
$md$,
  'all', 'workspace',
  ARRAY['workspace','overview','my-day','tasks','calendar'], 10
FROM shared.help_categories c WHERE c.slug = 'workspace'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Tasks ─────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'workspace-tasks',
  'Using the task board',
  'Create tasks, assign them, break them into subtasks, and move them across the board as they progress.',
  $md$
## The board

The **Tasks** tab is a board grouped by status (e.g. To-do → In progress →
Done). Drag a card to change its status, or use the status action. Each task
has an assignee, a due date and a priority.

## Subtasks

A task can hold **subtasks** — the checklist of smaller steps inside it. Tick
them off as you go; the parent shows the progress.

## Priorities and due dates

Set a **priority** (Urgent tasks are treated more aggressively) and a **due
date**. An overdue task — especially an Urgent one — is exactly what Praxis
Insights flags, so the board and the alerts stay in sync.

## Assigning work

Assign a task to a colleague and it shows up in their **My Day**. That's how
work moves between people without a separate chat: the task is the instruction
and the record of it.
$md$,
  'all', 'workspace',
  ARRAY['workspace','tasks','board','subtasks','assign','priority'], 20
FROM shared.help_categories c WHERE c.slug = 'workspace'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Calendar ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'workspace-calendar',
  'The shared calendar',
  'Schedule events in Month, Week, Day or Agenda view, and link them to the customer, deal or delivery they belong to.',
  $md$
## The views

The **Calendar** tab offers four views of the same schedule:

- **Month** — the big picture,
- **Week** — the working week,
- **Day** — a single day in detail,
- **Agenda** — a straight list of what's coming, ideal on mobile.

## Creating events

Add an **event** with a time, attendees and notes. It appears for the people
involved and rolls up into their **My Day**.

## Linking to records

An event can be tied **by reference** to a record — a customer appointment, a
delivery window, a follow-up on a deal. Opening the record can show its related
events, and the event points back to the record, so the schedule and the work
stay connected.

## Shared, with permissions

The calendar is shared across the team within your business and scoped by your
permissions — you see what you're allowed to, and changes are visible to the
people an event concerns.
$md$,
  'all', 'workspace',
  ARRAY['workspace','calendar','events','schedule','views'], 30
FROM shared.help_categories c WHERE c.slug = 'workspace'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'workspace-faq',
  'Workspace FAQ',
  'My Day vs Tasks, who sees an assigned task, linking to records, and overdue-task alerts.',
  $md$
## "What's the difference between My Day and Tasks?"

**Tasks** is the full board of everything. **My Day** is the filtered "what's
mine and due now" view that also folds in today's calendar events. Same data,
different focus.

## "I assigned a task — will they know?"

Yes. An assigned task appears in that person's **My Day** and task list. No
separate message needed; the task *is* the handoff.

## "Can I attach a task or event to a customer or order?"

Yes — both tasks and calendar events can be linked **by reference** to a record
elsewhere in the Hub, so the work stays connected to the thing it's about.

## "Why did a task get flagged by Praxis?"

Because it's **past its due date** and not done (more aggressively if its
priority is Urgent). Complete it or move the date and the flag clears.

## "Do other people see my calendar?"

The calendar is shared within your business and scoped by permissions. You see
what you're allowed to; people an event concerns see that event.
$md$,
  'all', 'workspace',
  ARRAY['workspace','faq','my-day','tasks','calendar','alerts'], 40
FROM shared.help_categories c WHERE c.slug = 'workspace'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'workspace'
--   ORDER BY sort_order;  -- expected: 4 rows
-- ============================================================
