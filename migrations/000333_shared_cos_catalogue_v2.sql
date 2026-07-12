-- ============================================================
-- MIGRATION 000333 — CoS: workspace catalogue v2 (reads + full CRUD)
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- GAP: the original 15-action allowlist (000324) was create/update only.
-- The CoS could not LIST or GET anything (its only world-knowledge was a
-- 20-goal snapshot), could not delete what it created, could not update a
-- note, and could not look up people — so "assign this to my BDM" was
-- silently dropped (assigned_to needs a user_id the model could never
-- discover).
--
-- ADDITIONS (all surface='workspace', entity_scope='both'; permissions
-- mirror the real endpoints):
--   READS (is_write=false, requires_confirmation=false — the agent runs
--   these IMMEDIATELY during the turn via the same loopback executor, so
--   RBAC applies; they never appear as plan steps):
--     list_goals, get_goal, list_tasks, list_events, list_notes,
--     search_contacts
--   WRITES (queued as plan steps, approved like any other):
--     update_note, delete_note, delete_task, delete_event,
--     delete_milestone, delete_goal
--
-- The executor sends GET payloads as query params and DELETE payloads as
-- route params only (praxis.executor), so the schemas below mirror each
-- endpoint's accepted query/route fields exactly.
-- ============================================================

INSERT INTO shared.ai_action_catalogue (
  action_key, title, method, route, description, module, category,
  is_write, entity_scope, surface, payload_schema, required_permission,
  ai_enabled, min_confidence, requires_confirmation, examples
) VALUES
  -- ── Reads ─────────────────────────────────────────────────
  ('workspace.list_goals',
   'List goals',
   'GET', '/api/v1/goals',
   'List the CEO''s goals. Run BEFORE creating a goal to avoid duplicates '
   'and to find goal_ids for updates/links.',
   'goals', 'read', false, 'both', 'workspace',
   '{"type":"object","properties":{"status":{"type":"string","enum":["active","on_hold","achieved","archived","cancelled"]},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"q":{"type":"string","description":"title search"},"page_size":{"type":"integer"}},"required":[]}'::jsonb,
   'goals.view', true, 0.70, false,
   '[{"utterance":"What goals do I have running?","payload":{"status":"active"}}]'::jsonb),

  ('workspace.get_goal',
   'Get a goal (with milestones)',
   'GET', '/api/v1/goals/:id',
   'Fetch one goal by id — returns its fields plus milestone/task counts. '
   '`id` is the goal_id.',
   'goals', 'read', false, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}'::jsonb,
   'goals.view', true, 0.70, false,
   '[{"utterance":"How is the popup goal doing?","payload":{"id":"<goal_id>"}}]'::jsonb),

  ('workspace.list_tasks',
   'List tasks',
   'GET', '/api/v1/tasks',
   'List Workspace tasks, filterable by status/priority/assignee.',
   'tasks', 'read', false, 'both', 'workspace',
   '{"type":"object","properties":{"status":{"type":"string","enum":["to_do","in_progress","in_review","done","cancelled"]},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"assigned_to":{"type":"string","description":"user_id or ''me''"},"page_size":{"type":"integer"}},"required":[]}'::jsonb,
   'tasks.view', true, 0.70, false,
   '[{"utterance":"What is still open on my board?","payload":{"status":"to_do"}}]'::jsonb),

  ('workspace.list_events',
   'List calendar events',
   'GET', '/api/v1/calendar',
   'List calendar events in a window. `from`/`to` are ISO dates or datetimes.',
   'calendar', 'read', false, 'both', 'workspace',
   '{"type":"object","properties":{"from":{"type":"string","description":"ISO date/datetime"},"to":{"type":"string","description":"ISO date/datetime"},"event_type":{"type":"string"}},"required":[]}'::jsonb,
   'calendar.view', true, 0.70, false,
   '[{"utterance":"What is on my calendar next week?","payload":{"from":"2026-07-13","to":"2026-07-19"}}]'::jsonb),

  ('workspace.list_notes',
   'List notes',
   'GET', '/api/v1/notes',
   'List the CEO''s Workspace notes; `q` searches, `goal_id` filters to a goal.',
   'goals', 'read', false, 'both', 'workspace',
   '{"type":"object","properties":{"q":{"type":"string"},"goal_id":{"type":"string"},"page_size":{"type":"integer"}},"required":[]}'::jsonb,
   'goals.view', true, 0.70, false,
   '[{"utterance":"Find my note about the salon outreach","payload":{"q":"salon"}}]'::jsonb),

  ('workspace.search_contacts',
   'Search people (contacts)',
   'GET', '/api/v1/contacts',
   'Search the contact book by name/email/phone — use this to find the '
   'contact_id before attaching a stakeholder. Read-only.',
   'contacts', 'read', false, 'both', 'workspace',
   '{"type":"object","properties":{"q":{"type":"string","description":"name/email search"},"page_size":{"type":"integer"}},"required":["q"]}'::jsonb,
   'contacts.view', true, 0.70, false,
   '[{"utterance":"Add Ada as a stakeholder","payload":{"q":"Ada"}}]'::jsonb),

  -- ── Writes (complete the CRUD set) ────────────────────────
  ('workspace.update_note',
   'Update a note',
   'PATCH', '/api/v1/notes/:id',
   'Update a note''s title/body/pin or move it under a goal. `id` is the note_id.',
   'goals', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"},"title":{"type":"string"},"body":{"type":"string","description":"markdown"},"goal_id":{"type":"string"},"pinned":{"type":"boolean"}},"required":["id"]}'::jsonb,
   'goals.edit', true, 0.70, true,
   '[{"utterance":"Append the salon shortlist to the trip note","payload":{"id":"<note_id>","body":"…updated markdown…"}}]'::jsonb),

  ('workspace.delete_note',
   'Delete a note',
   'DELETE', '/api/v1/notes/:id',
   'Delete a Workspace note. `id` is the note_id.',
   'goals', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}'::jsonb,
   'goals.delete', true, 0.75, true,
   '[{"utterance":"Bin the duplicate trip note","payload":{"id":"<note_id>"}}]'::jsonb),

  ('workspace.delete_task',
   'Delete a task',
   'DELETE', '/api/v1/tasks/:id',
   'Delete a Workspace task. `id` is the task_id. Prefer cancelling '
   '(update_task status=cancelled) when history should be kept.',
   'tasks', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}'::jsonb,
   'tasks.delete', true, 0.75, true,
   '[{"utterance":"Delete the duplicate packing task","payload":{"id":"<task_id>"}}]'::jsonb),

  ('workspace.delete_event',
   'Delete a calendar event',
   'DELETE', '/api/v1/calendar/:id',
   'Delete a calendar event. `id` is the event_id.',
   'calendar', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}'::jsonb,
   'calendar.delete', true, 0.75, true,
   '[{"utterance":"Cancel the Friday check-in event","payload":{"id":"<event_id>"}}]'::jsonb),

  ('workspace.delete_milestone',
   'Delete a milestone',
   'DELETE', '/api/v1/goals/:id/milestones/:mid',
   'Remove a milestone from a goal. `id`=goal_id, `mid`=milestone_id.',
   'goals', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"},"mid":{"type":"string"}},"required":["id","mid"]}'::jsonb,
   'goals.edit', true, 0.75, true,
   '[{"utterance":"Drop the redundant outreach milestone","payload":{"id":"<goal_id>","mid":"<milestone_id>"}}]'::jsonb),

  ('workspace.delete_goal',
   'Delete a goal',
   'DELETE', '/api/v1/goals/:id',
   'Soft-delete a goal and everything under it. Destructive — prefer '
   'update_goal status=archived unless the CEO explicitly wants it gone.',
   'goals', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}'::jsonb,
   'goals.delete', true, 0.85, true,
   '[{"utterance":"Delete the duplicate popup goal entirely","payload":{"id":"<goal_id>"}}]'::jsonb)
ON CONFLICT (action_key) DO UPDATE SET
  title               = EXCLUDED.title,
  method              = EXCLUDED.method,
  route               = EXCLUDED.route,
  description         = EXCLUDED.description,
  module              = EXCLUDED.module,
  category            = EXCLUDED.category,
  is_write            = EXCLUDED.is_write,
  entity_scope        = EXCLUDED.entity_scope,
  surface             = EXCLUDED.surface,
  payload_schema      = EXCLUDED.payload_schema,
  required_permission = EXCLUDED.required_permission,
  ai_enabled          = EXCLUDED.ai_enabled,
  min_confidence      = EXCLUDED.min_confidence,
  requires_confirmation = EXCLUDED.requires_confirmation,
  examples            = EXCLUDED.examples,
  updated_at          = now();

-- ============================================================
-- Verify
--   SELECT action_key, is_write FROM shared.ai_action_catalogue
--    WHERE surface='workspace' ORDER BY action_key;   -- expect 27 rows
-- ============================================================
