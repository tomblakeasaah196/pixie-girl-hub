-- ============================================================
-- MIGRATION 000335 — CoS: workspace catalogue v3 (datetime + reminders)
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- GAP 1: task/event writes from the CoS failed Zod with "Invalid datetime" —
-- the model naturally emits Lagos offsets ("2026-07-17T18:00:00+01:00") while
-- the schema descriptions only said "ISO 8601 datetime" and the task
-- validator only accepted UTC. The validators are now flexible (000334-era
-- code), and these descriptions spell out the preferred shape so the model
-- emits it first time.
--
-- GAP 2: reminders existed on tasks (reminder_minutes) but the CoS schemas
-- never exposed them, so "remind me the day before" was silently dropped.
-- Tasks AND events now take reminder_minutes (relative) or remind_at
-- (absolute custom reminder) — see migration 000334.
--
-- Also widens the event_type enum to the full calendar vocabulary so the CoS
-- can file deliveries, fittings, photoshoots etc. correctly.
-- ============================================================

UPDATE shared.ai_action_catalogue SET
  description =
    'Create a Workspace task. Datetimes are ISO 8601 with the Lagos offset '
    '(e.g. 2026-07-17T18:00:00+01:00); a bare YYYY-MM-DD due_at lands at 17:00 '
    'Lagos. Set reminder_minutes or remind_at so the CEO is nudged before the '
    'deadline. To attach the task to a goal/milestone, follow with a link_task '
    'step referencing {{step:N.task_id}}.',
  payload_schema = '{
    "type": "object",
    "properties": {
      "title": {"type": "string"},
      "description": {"type": "string"},
      "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
      "due_at": {"type": "string", "description": "ISO 8601 datetime with offset, e.g. 2026-07-17T18:00:00+01:00 (or YYYY-MM-DD for 17:00 Lagos)"},
      "assigned_to": {"type": "string", "description": "user_id"},
      "reminder_minutes": {"type": "integer", "description": "remind this many minutes BEFORE due_at — 60=1 hour, 1440=1 day, 2880=2 days, 10080=1 week"},
      "remind_at": {"type": "string", "description": "absolute reminder datetime (ISO 8601 with offset); overrides reminder_minutes"}
    },
    "required": ["title"]
  }'::jsonb,
  examples = '[
    {"utterance": "Task: shortlist 3 accessory suppliers by Friday, remind me a day before",
     "payload": {"title": "Shortlist 3 accessory suppliers", "priority": "high", "due_at": "2026-06-12T17:00:00+01:00", "reminder_minutes": 1440}}
  ]'::jsonb,
  updated_at = now()
WHERE action_key = 'workspace.create_task';

UPDATE shared.ai_action_catalogue SET
  description =
    'Update a task. `id` is the task_id (or {{step:N.task_id}}). Datetimes are '
    'ISO 8601 with the Lagos offset (e.g. 2026-07-17T18:00:00+01:00). Reminders '
    'are editable: change reminder_minutes (relative to due_at) or set remind_at '
    '(absolute); send null to clear.',
  payload_schema = '{
    "type": "object",
    "properties": {
      "id": {"type": "string"},
      "title": {"type": "string"},
      "description": {"type": "string"},
      "status": {"type": "string", "enum": ["to_do", "in_progress", "in_review", "done", "cancelled"]},
      "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
      "due_at": {"type": "string", "description": "ISO 8601 datetime with offset, e.g. 2026-07-17T18:00:00+01:00"},
      "assigned_to": {"type": "string"},
      "reminder_minutes": {"type": "integer", "description": "remind this many minutes BEFORE due_at — 1440=1 day, 2880=2 days, 10080=1 week; null clears"},
      "remind_at": {"type": "string", "description": "absolute reminder datetime (ISO 8601 with offset); overrides reminder_minutes; null clears"}
    },
    "required": ["id"]
  }'::jsonb,
  examples = '[
    {"utterance": "Push the supplier task to next Friday and remind me two days before",
     "payload": {"id": "<task_id>", "due_at": "2026-06-19T17:00:00+01:00", "reminder_minutes": 2880}}
  ]'::jsonb,
  updated_at = now()
WHERE action_key = 'workspace.update_task';

UPDATE shared.ai_action_catalogue SET
  description =
    'Create a calendar event. start_at/end_at are ISO 8601 datetimes WITH the '
    'Lagos offset (e.g. 2026-06-16T15:00:00+01:00). Set reminder_minutes or '
    'remind_at so the CEO is nudged before it starts. To attach it to a goal, '
    'follow with a link_event step referencing {{step:N.event_id}}.',
  payload_schema = '{
    "type": "object",
    "properties": {
      "title": {"type": "string"},
      "event_type": {"type": "string", "enum": ["meeting", "call", "delivery", "pickup", "fitting", "photoshoot", "training", "review", "reminder", "task_deadline", "viewing", "follow_up", "leave", "appointment", "service_booking", "production_milestone", "stylist_appointment", "other"]},
      "start_at": {"type": "string", "description": "ISO 8601 datetime with offset, e.g. 2026-06-16T15:00:00+01:00"},
      "end_at": {"type": "string", "description": "ISO 8601 datetime with offset, e.g. 2026-06-16T15:30:00+01:00"},
      "location": {"type": "string"},
      "description": {"type": "string"},
      "reminder_minutes": {"type": "integer", "description": "remind this many minutes BEFORE start_at — 15, 60=1 hour, 1440=1 day, 2880=2 days, 10080=1 week"},
      "remind_at": {"type": "string", "description": "absolute reminder datetime (ISO 8601 with offset); overrides reminder_minutes"}
    },
    "required": ["title", "event_type", "start_at", "end_at"]
  }'::jsonb,
  examples = '[
    {"utterance": "Book a supplier review call next Tuesday 3pm, remind me an hour before",
     "payload": {"title": "Supplier review call", "event_type": "call", "start_at": "2026-06-16T15:00:00+01:00", "end_at": "2026-06-16T15:30:00+01:00", "reminder_minutes": 60}}
  ]'::jsonb,
  updated_at = now()
WHERE action_key = 'workspace.create_event';

UPDATE shared.ai_action_catalogue SET
  description =
    'Update an event. `id` is the event_id (or {{step:N.event_id}}). Datetimes '
    'are ISO 8601 with the Lagos offset. Reminders are editable: change '
    'reminder_minutes (relative to start_at) or set remind_at (absolute); send '
    'null to clear.',
  payload_schema = '{
    "type": "object",
    "properties": {
      "id": {"type": "string"},
      "title": {"type": "string"},
      "event_type": {"type": "string", "enum": ["meeting", "call", "delivery", "pickup", "fitting", "photoshoot", "training", "review", "reminder", "task_deadline", "viewing", "follow_up", "leave", "appointment", "service_booking", "production_milestone", "stylist_appointment", "other"]},
      "start_at": {"type": "string", "description": "ISO 8601 datetime with offset, e.g. 2026-06-16T15:00:00+01:00"},
      "end_at": {"type": "string", "description": "ISO 8601 datetime with offset"},
      "location": {"type": "string"},
      "description": {"type": "string"},
      "reminder_minutes": {"type": "integer", "description": "remind this many minutes BEFORE start_at; null clears"},
      "remind_at": {"type": "string", "description": "absolute reminder datetime (ISO 8601 with offset); overrides reminder_minutes; null clears"}
    },
    "required": ["id"]
  }'::jsonb,
  examples = '[
    {"utterance": "Rename the review call to kickoff and remind me 15 minutes before",
     "payload": {"id": "<event_id>", "title": "Kickoff call", "reminder_minutes": 15}}
  ]'::jsonb,
  updated_at = now()
WHERE action_key = 'workspace.update_event';

UPDATE shared.ai_action_catalogue SET
  description =
    'Move an event to a new time. `id`=event_id; provide the new start_at/'
    'end_at as ISO 8601 datetimes WITH the Lagos offset (e.g. '
    '2026-06-18T15:00:00+01:00). Any relative reminder re-anchors to the new '
    'start automatically.',
  updated_at = now()
WHERE action_key = 'workspace.reschedule_event';

-- ============================================================
-- Verify
--   SELECT action_key, payload_schema->'properties'->'reminder_minutes'
--     FROM shared.ai_action_catalogue
--    WHERE action_key IN ('workspace.create_task','workspace.create_event');
-- ============================================================
