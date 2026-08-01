-- ============================================================
-- MIGRATION 000347 — CoS: workspace catalogue v4 (identity + linkage + reliability)
-- Pixie Girl Hub · V2.2 · AI Chief of Staff · Phase 0
--
-- Root causes of "CoS tasks never write to the DB" (see
-- docs/COS_ARCHITECTURE_AUDIT.md §3), fixed at the catalogue layer:
--
--   GAP 1 (identity): shared.tasks.assigned_to is an FK to shared.users, but
--   the CoS had NO tool that returns a user_id — search_contacts returns
--   contact_ids (a different table), so "assign to my BDM" either failed the
--   FK or the uuid validator. New read action workspace.search_users returns
--   real user_ids from /api/v1/tasks/assignees.
--
--   GAP 2 (linkage): the tasks endpoint accepts is_personal + reference_type/
--   reference_id (link a task to a contact) and the calendar endpoint accepts
--   participants[], but the CoS catalogue schemas exposed NONE of them — so a
--   task could never be marked personal or tied to a contact, and an event
--   could never invite anyone. The model would improvise a contact_id key and
--   the strict validator rejected the whole write. These fields are now first-
--   class in the schemas the model sees.
--
--   RELIABILITY: batch plans expired after 60 minutes — far too aggressive for
--   a CEO who reviews a plan after a meeting. Default is now 24 hours. And a
--   new nullable ai_pending_actions.preflight_note carries the plan-build-time
--   validation warning the card shows BEFORE approval (see cos.preflight).
--
-- Backward compatible: only CoS (surface='workspace') rows change; Praxis rows
-- are untouched. The new column is additive + nullable.
-- ============================================================

-- ── 1. New READ action: search_users (the missing user_id source) ──
-- is_write=false → runs IMMEDIATELY during the turn over loopback as the CEO,
-- exactly like search_contacts. Points at a light /tasks/assignees endpoint
-- (permission tasks.view — already in the CoS's remit), NOT the heavy IAM
-- admin list.
INSERT INTO shared.ai_action_catalogue (
  action_key, title, method, route, description, module, category,
  is_write, entity_scope, surface, payload_schema, required_permission,
  ai_enabled, min_confidence, requires_confirmation, examples
) VALUES
  ('workspace.search_users',
   'Find a teammate (for assignment)',
   'GET', '/api/v1/tasks/assignees',
   'Find a STAFF user_id to assign a task to, or to invite to a calendar '
   'event. Search by name or role; returns each teammate''s user_id, name and '
   'role. This is the ONLY source of a valid assigned_to / participant '
   'user_id. A contact_id from search_contacts is a customer/supplier, NOT a '
   'staff user, and can never be assigned work — use reference_type=''contact'' '
   'to link a task to a contact instead.',
   'tasks', 'read', false, 'both', 'workspace',
   '{"type":"object","properties":{"q":{"type":"string","description":"name or role to search; omit to list the whole team"},"page_size":{"type":"integer"}},"required":[]}'::jsonb,
   'tasks.view', true, 0.70, false,
   '[{"utterance":"Assign this to my BDM","payload":{"q":"BDM"}},{"utterance":"Who is on my team?","payload":{}}]'::jsonb)
ON CONFLICT (action_key) DO UPDATE SET
  title = EXCLUDED.title, method = EXCLUDED.method, route = EXCLUDED.route,
  description = EXCLUDED.description, module = EXCLUDED.module,
  category = EXCLUDED.category, is_write = EXCLUDED.is_write,
  entity_scope = EXCLUDED.entity_scope, surface = EXCLUDED.surface,
  payload_schema = EXCLUDED.payload_schema,
  required_permission = EXCLUDED.required_permission,
  ai_enabled = EXCLUDED.ai_enabled, min_confidence = EXCLUDED.min_confidence,
  requires_confirmation = EXCLUDED.requires_confirmation,
  examples = EXCLUDED.examples, updated_at = now();

-- ── 2. create_task: expose assignment + personal + contact linkage ──
UPDATE shared.ai_action_catalogue SET
  description =
    'Create a Workspace task. Datetimes are ISO 8601 with the Lagos offset '
    '(e.g. 2026-07-17T18:00:00+01:00); a bare YYYY-MM-DD due_at lands at 17:00 '
    'Lagos. assigned_to MUST be a user_id from search_users (never a name, '
    'never a contact_id) — omit it to leave the task unassigned/for the CEO. '
    'Set is_personal=true for the CEO''s private personal to-dos. To tie the '
    'task to a person in the contact book (a customer/supplier), set '
    'reference_type=''contact'' and reference_id to their contact_id from '
    'search_contacts. Set reminder_minutes or remind_at to nudge before the '
    'deadline. To attach the task to a goal/milestone, follow with a link_task '
    'step referencing {{step:N.task_id}}.',
  payload_schema = '{
    "type": "object",
    "properties": {
      "title": {"type": "string"},
      "description": {"type": "string"},
      "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
      "due_at": {"type": "string", "description": "ISO 8601 datetime with offset, e.g. 2026-07-17T18:00:00+01:00 (or YYYY-MM-DD for 17:00 Lagos)"},
      "assigned_to": {"type": "string", "description": "a STAFF user_id from search_users — NOT a contact_id, NOT a name. Omit to leave unassigned."},
      "is_personal": {"type": "boolean", "description": "true = the CEO''s private personal task, kept out of the shared business board"},
      "reference_type": {"type": "string", "enum": ["contact"], "description": "set to ''contact'' to link this task to a person in the contact book"},
      "reference_id": {"type": "string", "description": "the contact_id (from search_contacts) this task is about, when reference_type=''contact''"},
      "reminder_minutes": {"type": "integer", "description": "remind this many minutes BEFORE due_at — 60=1 hour, 1440=1 day, 2880=2 days, 10080=1 week"},
      "remind_at": {"type": "string", "description": "absolute reminder datetime (ISO 8601 with offset); overrides reminder_minutes"}
    },
    "required": ["title"]
  }'::jsonb,
  examples = '[
    {"utterance": "Task: shortlist 3 accessory suppliers by Friday, remind me a day before",
     "payload": {"title": "Shortlist 3 accessory suppliers", "priority": "high", "due_at": "2026-06-12T17:00:00+01:00", "reminder_minutes": 1440}},
    {"utterance": "Personal reminder to call the accountant Monday",
     "payload": {"title": "Call the accountant", "is_personal": true, "due_at": "2026-06-15T10:00:00+01:00", "reminder_minutes": 60}}
  ]'::jsonb,
  updated_at = now()
WHERE action_key = 'workspace.create_task';

-- ── 3. update_task: same new fields on edit ──
UPDATE shared.ai_action_catalogue SET
  description =
    'Update a task. `id` is the task_id (or {{step:N.task_id}}). assigned_to '
    'must be a user_id from search_users (send null to unassign). is_personal '
    'toggles the CEO''s private flag. reference_type=''contact'' + reference_id '
    '(a contact_id) links it to a person. Datetimes are ISO 8601 with the '
    'Lagos offset. Reminders: reminder_minutes (relative) or remind_at '
    '(absolute); null clears.',
  payload_schema = '{
    "type": "object",
    "properties": {
      "id": {"type": "string"},
      "title": {"type": "string"},
      "description": {"type": "string"},
      "status": {"type": "string", "enum": ["to_do", "in_progress", "in_review", "done", "cancelled"]},
      "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
      "due_at": {"type": "string", "description": "ISO 8601 datetime with offset, e.g. 2026-07-17T18:00:00+01:00"},
      "assigned_to": {"type": "string", "description": "a STAFF user_id from search_users; null to unassign"},
      "is_personal": {"type": "boolean"},
      "reference_type": {"type": "string", "enum": ["contact"]},
      "reference_id": {"type": "string", "description": "contact_id when reference_type=''contact''"},
      "reminder_minutes": {"type": "integer", "description": "minutes before due_at — 1440=1 day, 2880=2 days, 10080=1 week; null clears"},
      "remind_at": {"type": "string", "description": "absolute reminder datetime (ISO 8601 with offset); overrides reminder_minutes; null clears"}
    },
    "required": ["id"]
  }'::jsonb,
  updated_at = now()
WHERE action_key = 'workspace.update_task';

-- ── 4. create_event: expose participants + contact linkage ──
UPDATE shared.ai_action_catalogue SET
  description =
    'Create a calendar event. start_at/end_at are ISO 8601 datetimes WITH the '
    'Lagos offset (e.g. 2026-06-16T15:00:00+01:00). Invite people via '
    'participants[]: each is {user_id} for a teammate (from search_users) or '
    '{contact_id} for a customer/supplier (from search_contacts) — never '
    'invent an id, look it up first. Set reminder_minutes or remind_at to nudge '
    'before it starts. To attach it to a goal, follow with a link_event step '
    'referencing {{step:N.event_id}}.',
  payload_schema = '{
    "type": "object",
    "properties": {
      "title": {"type": "string"},
      "event_type": {"type": "string", "enum": ["meeting", "call", "delivery", "pickup", "fitting", "photoshoot", "training", "review", "reminder", "task_deadline", "viewing", "follow_up", "leave", "appointment", "service_booking", "production_milestone", "stylist_appointment", "other"]},
      "start_at": {"type": "string", "description": "ISO 8601 datetime with offset, e.g. 2026-06-16T15:00:00+01:00"},
      "end_at": {"type": "string", "description": "ISO 8601 datetime with offset, e.g. 2026-06-16T15:30:00+01:00"},
      "location": {"type": "string"},
      "description": {"type": "string"},
      "participants": {"type": "array", "description": "people to invite", "items": {"type": "object", "properties": {"user_id": {"type": "string", "description": "a STAFF user_id from search_users"}, "contact_id": {"type": "string", "description": "a contact_id from search_contacts"}}}},
      "reference_type": {"type": "string", "enum": ["contact"], "description": "set to ''contact'' to tie the event to a person"},
      "reference_id": {"type": "string", "description": "contact_id when reference_type=''contact''"},
      "reminder_minutes": {"type": "integer", "description": "remind this many minutes BEFORE start_at — 15, 60=1 hour, 1440=1 day, 2880=2 days, 10080=1 week"},
      "remind_at": {"type": "string", "description": "absolute reminder datetime (ISO 8601 with offset); overrides reminder_minutes"}
    },
    "required": ["title", "event_type", "start_at", "end_at"]
  }'::jsonb,
  examples = '[
    {"utterance": "Book a supplier review call next Tuesday 3pm with Ada, remind me an hour before",
     "payload": {"title": "Supplier review call", "event_type": "call", "start_at": "2026-06-16T15:00:00+01:00", "end_at": "2026-06-16T15:30:00+01:00", "reminder_minutes": 60, "participants": [{"contact_id": "<contact_id>"}]}}
  ]'::jsonb,
  updated_at = now()
WHERE action_key = 'workspace.create_event';

-- ── 5. Reliability: 24-hour plan approval window (was 60 minutes) ──
ALTER TABLE shared.ai_pending_plans
  ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '24 hours');
-- Give every currently-open plan the roomier window too, so nothing the CEO is
-- mid-review on expires under the old 60-minute rule right after deploy.
UPDATE shared.ai_pending_plans
   SET expires_at = GREATEST(expires_at, created_at + INTERVAL '24 hours')
 WHERE status IN ('proposed', 'confirmed', 'executing');

-- ── 6. Pre-flight note: the review-time validation warning on a step ──
-- Populated by cos.preflight at plan-build time (missing required field, bad
-- enum, an id/date that won't parse). Shown on the plan card BEFORE approval so
-- the CEO fixes it with the ✎ editor instead of discovering it as a run error.
ALTER TABLE shared.ai_pending_actions
  ADD COLUMN IF NOT EXISTS preflight_note TEXT;

-- ============================================================
-- Verify
--   SELECT action_key FROM shared.ai_action_catalogue
--    WHERE surface='workspace' ORDER BY action_key;         -- expect 28 rows
--   SELECT column_default FROM information_schema.columns
--    WHERE table_schema='shared' AND table_name='ai_pending_plans'
--      AND column_name='expires_at';                         -- 24:00:00 interval
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='shared' AND table_name='ai_pending_actions'
--      AND column_name='preflight_note';                     -- 1 row
-- ============================================================
