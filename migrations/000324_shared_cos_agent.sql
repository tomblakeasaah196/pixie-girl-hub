-- ============================================================
-- MIGRATION 000324 — Chief of Staff: agent core (PR3)
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- Turns the Praxis runtime into a second, scoped persona (the CoS) and
-- adds batch-plan approval on top of the existing single-action confirm
-- gate. NO new isolation model — CoS reuses ai_conversations / ai_messages /
-- ai_pending_actions, tagged by `kind` and `surface`.
--
--   1. ai_conversations       += kind           ('praxis' | 'chief_of_staff')
--   2. ai_action_catalogue    += surface        ('praxis' | 'workspace' | 'both')
--   3. ai_pending_plans       — the batch-plan parent (NEW table)
--   4. ai_pending_actions     += plan_id, plan_step   (batch steps)
--   5. catalogue seed         — 15 surface='workspace' actions (the CoS allowlist)
--   6. ai_feature_flags       — 'cos_chat' governance feature (default OFF)
--
-- Backward compatible: every new column defaults to the pre-CoS value, so
-- Praxis behaviour is byte-for-byte unchanged (kind='praxis', plan_id=NULL,
-- surface='praxis' on its own catalogue rows are untouched by §5).
--
-- See docs/AI_CHIEF_OF_STAFF_IMPLEMENTATION.md §1.6 and PR3.
-- ============================================================

-- ── 1. ai_conversations.kind ────────────────────────────────
ALTER TABLE shared.ai_conversations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'praxis'
    CHECK (kind IN ('praxis','chief_of_staff'));
-- CoS lists/creates only kind='chief_of_staff'; Praxis only kind='praxis'.
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_kind
  ON shared.ai_conversations (user_id, kind) WHERE is_archived = false;

-- ── 2. ai_action_catalogue.surface ──────────────────────────
ALTER TABLE shared.ai_action_catalogue
  ADD COLUMN IF NOT EXISTS surface TEXT NOT NULL DEFAULT 'praxis'
    CHECK (surface IN ('praxis','workspace','both'));
-- CoS's allowlist = surface IN ('workspace') AND ai_enabled=true. Praxis keeps
-- its full set (surface defaults to 'praxis' on every existing row).
CREATE INDEX IF NOT EXISTS idx_ai_action_catalogue_surface
  ON shared.ai_action_catalogue (surface) WHERE ai_enabled = true;

-- ── 3. ai_pending_plans (batch-plan parent) ─────────────────
CREATE TABLE IF NOT EXISTS shared.ai_pending_plans (
  plan_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      UUID        NOT NULL REFERENCES shared.ai_conversations (conversation_id) ON DELETE CASCADE,
  business             TEXT        REFERENCES shared.business_config (business_key) ON DELETE SET NULL,
  proposed_by_user_id  UUID        NOT NULL REFERENCES shared.users (user_id) ON DELETE RESTRICT,
  title                TEXT        NOT NULL,
  summary              TEXT        NOT NULL,   -- plain-language plan description
  status               TEXT        NOT NULL DEFAULT 'proposed'
                       CHECK (status IN ('proposed','confirmed','executing','executed',
                                         'partially_failed','rejected','expired','cancelled')),
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '60 minutes'),
  confirmed_by_user_id UUID        REFERENCES shared.users (user_id) ON DELETE SET NULL,
  confirmed_at         TIMESTAMPTZ,
  rejected_at          TIMESTAMPTZ,
  rejection_reason     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_ai_pending_plans_updated_at
  BEFORE UPDATE ON shared.ai_pending_plans
  FOR EACH ROW EXECUTE FUNCTION shared.fn_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_ai_pending_plans_conversation
  ON shared.ai_pending_plans (conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_pending_plans_open
  ON shared.ai_pending_plans (proposed_by_user_id, status)
  WHERE status IN ('proposed','confirmed','executing');

-- ── 4. ai_pending_actions += plan_id, plan_step ─────────────
-- A single-action proposal keeps plan_id = NULL (fully backward compatible
-- with Praxis). CoS batch steps carry plan_id + a 0-based plan_step order.
ALTER TABLE shared.ai_pending_actions
  ADD COLUMN IF NOT EXISTS plan_id   UUID REFERENCES shared.ai_pending_plans (plan_id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS plan_step SMALLINT;
CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_plan
  ON shared.ai_pending_actions (plan_id, plan_step) WHERE plan_id IS NOT NULL;

-- ── 5. CoS action catalogue (the scoped allowlist) ──────────
-- EXACTLY the §0.2 workspace endpoints, surface='workspace', ai_enabled=true,
-- entity_scope='both'. required_permission mirrors the real endpoint's
-- requirePermission(...) key. payload_schema mirrors the Zod validator (route
-- params like :id are included as properties so the model fills them — or uses
-- a {{step:N.field}} cross-step token, resolved by the plan executor).
INSERT INTO shared.ai_action_catalogue (
  action_key, title, method, route, description, module, category,
  is_write, entity_scope, surface, payload_schema, required_permission,
  ai_enabled, min_confidence, requires_confirmation, examples
) VALUES
  ('workspace.create_goal',
   'Create a goal',
   'POST', '/api/v1/goals',
   'Create a new goal (top-level objective). Milestones are added as separate '
   'add_milestone steps that reference this goal via {{step:N.goal_id}}.',
   'goals', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"title":{"type":"string"},"description":{"type":"string"},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"target_date":{"type":"string","description":"YYYY-MM-DD"}},"required":["title"]}'::jsonb,
   'goals.create', true, 0.70, true,
   '[{"utterance":"Launch the accessories line in August","payload":{"title":"Launch accessories line","priority":"high","target_date":"2026-08-31"}}]'::jsonb),

  ('workspace.update_goal',
   'Update a goal',
   'PATCH', '/api/v1/goals/:id',
   'Update a goal''s fields (title, description, status, priority, target date). '
   '`id` is the goal_id (or {{step:N.goal_id}}).',
   'goals', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"},"title":{"type":"string"},"description":{"type":"string"},"status":{"type":"string","enum":["active","on_hold","achieved","archived","cancelled"]},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"target_date":{"type":"string","description":"YYYY-MM-DD"}},"required":["id"]}'::jsonb,
   'goals.edit', true, 0.70, true,
   '[{"utterance":"Bump the launch goal to urgent","payload":{"id":"<goal_id>","priority":"urgent"}}]'::jsonb),

  ('workspace.add_milestone',
   'Add a milestone to a goal',
   'POST', '/api/v1/goals/:id/milestones',
   'Add an ordered milestone under a goal. `id` is the goal_id (often '
   '{{step:0.goal_id}} for a goal created earlier in the same plan).',
   'goals', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string","description":"goal_id, e.g. {{step:0.goal_id}}"},"title":{"type":"string"},"description":{"type":"string"},"target_date":{"type":"string","description":"YYYY-MM-DD"},"display_order":{"type":"integer"}},"required":["id","title"]}'::jsonb,
   'goals.edit', true, 0.70, true,
   '[{"utterance":"First milestone: finalise supplier by June","payload":{"id":"{{step:0.goal_id}}","title":"Finalise supplier","target_date":"2026-06-15","display_order":0}}]'::jsonb),

  ('workspace.update_milestone',
   'Update a milestone',
   'PATCH', '/api/v1/goals/:id/milestones/:mid',
   'Update a milestone''s status/date/order. `id`=goal_id, `mid`=milestone_id '
   '(or {{step:N.milestone_id}}).',
   'goals', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"},"mid":{"type":"string"},"title":{"type":"string"},"status":{"type":"string","enum":["pending","in_progress","done","skipped"]},"target_date":{"type":"string","description":"YYYY-MM-DD"},"display_order":{"type":"integer"}},"required":["id","mid"]}'::jsonb,
   'goals.edit', true, 0.70, true,
   '[{"utterance":"Mark the supplier milestone done","payload":{"id":"<goal_id>","mid":"<milestone_id>","status":"done"}}]'::jsonb),

  ('workspace.create_task',
   'Create a task',
   'POST', '/api/v1/tasks',
   'Create a Workspace task. To attach it to a goal/milestone, follow with a '
   'link_task step referencing {{step:N.task_id}}.',
   'tasks', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"title":{"type":"string"},"description":{"type":"string"},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"due_at":{"type":"string","description":"ISO 8601 datetime"},"assigned_to":{"type":"string","description":"user_id"}},"required":["title"]}'::jsonb,
   'tasks.create', true, 0.70, true,
   '[{"utterance":"Task: shortlist 3 accessory suppliers by Friday","payload":{"title":"Shortlist 3 accessory suppliers","priority":"high","due_at":"2026-06-12T17:00:00Z"}}]'::jsonb),

  ('workspace.update_task',
   'Update a task',
   'PATCH', '/api/v1/tasks/:id',
   'Update a task''s fields. `id` is the task_id (or {{step:N.task_id}}).',
   'tasks', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"},"title":{"type":"string"},"description":{"type":"string"},"status":{"type":"string","enum":["to_do","in_progress","in_review","done","cancelled"]},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"due_at":{"type":"string","description":"ISO 8601 datetime"},"assigned_to":{"type":"string"}},"required":["id"]}'::jsonb,
   'tasks.edit', true, 0.70, true,
   '[{"utterance":"Push the supplier task to next Friday","payload":{"id":"<task_id>","due_at":"2026-06-19T17:00:00Z"}}]'::jsonb),

  ('workspace.move_task',
   'Move a task to a new status',
   'POST', '/api/v1/tasks/:id/status',
   'Move a task across the board (change its status). `id` is the task_id.',
   'tasks', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"},"status":{"type":"string","enum":["to_do","in_progress","in_review","done","cancelled"]}},"required":["id","status"]}'::jsonb,
   'tasks.edit', true, 0.70, true,
   '[{"utterance":"Mark the supplier task done","payload":{"id":"<task_id>","status":"done"}}]'::jsonb),

  ('workspace.add_subtask',
   'Add a subtask to a task',
   'POST', '/api/v1/tasks/:id/subtasks',
   'Add a checklist subtask under a task. `id` is the task_id '
   '(or {{step:N.task_id}}).',
   'tasks', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"},"title":{"type":"string"},"display_order":{"type":"integer"}},"required":["id","title"]}'::jsonb,
   'tasks.edit', true, 0.70, true,
   '[{"utterance":"Add a checklist item: request samples","payload":{"id":"{{step:4.task_id}}","title":"Request samples"}}]'::jsonb),

  ('workspace.create_event',
   'Create a calendar event',
   'POST', '/api/v1/calendar',
   'Create a calendar event. To attach it to a goal, follow with a link_event '
   'step referencing {{step:N.event_id}}.',
   'calendar', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"title":{"type":"string"},"event_type":{"type":"string","enum":["meeting","call","review","reminder","follow_up","appointment","training","task_deadline","other"]},"start_at":{"type":"string","description":"ISO 8601 datetime with offset"},"end_at":{"type":"string","description":"ISO 8601 datetime with offset"},"location":{"type":"string"},"description":{"type":"string"}},"required":["title","event_type","start_at","end_at"]}'::jsonb,
   'calendar.create', true, 0.70, true,
   '[{"utterance":"Book a supplier review call next Tuesday 3pm","payload":{"title":"Supplier review call","event_type":"call","start_at":"2026-06-16T15:00:00+01:00","end_at":"2026-06-16T15:30:00+01:00"}}]'::jsonb),

  ('workspace.update_event',
   'Update a calendar event',
   'PATCH', '/api/v1/calendar/:id',
   'Update an event''s fields. `id` is the event_id (or {{step:N.event_id}}).',
   'calendar', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"},"title":{"type":"string"},"event_type":{"type":"string","enum":["meeting","call","review","reminder","follow_up","appointment","training","task_deadline","other"]},"start_at":{"type":"string"},"end_at":{"type":"string"},"location":{"type":"string"},"description":{"type":"string"}},"required":["id"]}'::jsonb,
   'calendar.edit', true, 0.70, true,
   '[{"utterance":"Rename the review call to kickoff","payload":{"id":"<event_id>","title":"Kickoff call"}}]'::jsonb),

  ('workspace.reschedule_event',
   'Reschedule a calendar event',
   'PATCH', '/api/v1/calendar/:id',
   'Move an event to a new time. `id`=event_id; provide the new start_at/end_at.',
   'calendar', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"},"start_at":{"type":"string","description":"ISO 8601 datetime with offset"},"end_at":{"type":"string","description":"ISO 8601 datetime with offset"}},"required":["id","start_at","end_at"]}'::jsonb,
   'calendar.edit', true, 0.70, true,
   '[{"utterance":"Push the kickoff to Thursday same time","payload":{"id":"<event_id>","start_at":"2026-06-18T15:00:00+01:00","end_at":"2026-06-18T15:30:00+01:00"}}]'::jsonb),

  ('workspace.create_note',
   'Create a note',
   'POST', '/api/v1/notes',
   'Create a personal Workspace note (markdown). Optionally link it to a goal/'
   'milestone via goal_id/milestone_id (e.g. {{step:0.goal_id}}).',
   'goals', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"title":{"type":"string"},"body":{"type":"string","description":"markdown"},"goal_id":{"type":"string"},"milestone_id":{"type":"string"},"pinned":{"type":"boolean"}},"required":["body"]}'::jsonb,
   'goals.create', true, 0.70, true,
   '[{"utterance":"Note under this goal: target 30% margin","payload":{"body":"Target 30% margin on the accessories line.","goal_id":"{{step:0.goal_id}}"}}]'::jsonb),

  ('workspace.attach_stakeholder',
   'Attach a stakeholder to a goal',
   'POST', '/api/v1/goals/:id/stakeholders',
   'Attach a user or contact as a goal stakeholder. `id`=goal_id; provide '
   'exactly one of user_id or contact_id.',
   'goals', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"},"user_id":{"type":"string"},"contact_id":{"type":"string"},"role":{"type":"string"}},"required":["id"]}'::jsonb,
   'goals.edit', true, 0.70, true,
   '[{"utterance":"Add Ada as sponsor of this goal","payload":{"id":"{{step:0.goal_id}}","user_id":"<user_id>","role":"sponsor"}}]'::jsonb),

  ('workspace.link_task',
   'Link an existing task to a goal',
   'POST', '/api/v1/goals/:id/tasks/:taskId/link',
   'Link a task to a goal (and optionally a milestone). `id`=goal_id, '
   '`taskId`=task_id — typically {{step:0.goal_id}} + {{step:N.task_id}}.',
   'goals', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"},"taskId":{"type":"string"},"milestone_id":{"type":"string"}},"required":["id","taskId"]}'::jsonb,
   'goals.edit', true, 0.70, true,
   '[{"utterance":"Link the supplier task to the launch goal","payload":{"id":"{{step:0.goal_id}}","taskId":"{{step:4.task_id}}"}}]'::jsonb),

  ('workspace.link_event',
   'Link an existing event to a goal',
   'POST', '/api/v1/goals/:id/events/:eventId/link',
   'Link a calendar event to a goal. `id`=goal_id, `eventId`=event_id — '
   'typically {{step:0.goal_id}} + {{step:N.event_id}}.',
   'goals', 'write', true, 'both', 'workspace',
   '{"type":"object","properties":{"id":{"type":"string"},"eventId":{"type":"string"},"milestone_id":{"type":"string"}},"required":["id","eventId"]}'::jsonb,
   'goals.edit', true, 0.70, true,
   '[{"utterance":"Link the review call to the launch goal","payload":{"id":"{{step:0.goal_id}}","eventId":"{{step:8.event_id}}"}}]'::jsonb)
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

-- ── 6. Governance feature flag for the CoS chat turn ────────
-- canUseFeature('cos_chat') gates every CoS turn (flag + grant + budget).
-- Default OFF: a fresh deploy leaves CoS resting until the CEO enables it in
-- AI Control — matching COS_ENABLED=false → graceful stub. DO NOTHING on
-- conflict so a redeploy never re-disables an already-enabled feature.
INSERT INTO shared.ai_feature_flags (
  feature_key, display_name, description, is_enabled,
  default_provider, default_model, feature_scope,
  enabled_for_pxg, enabled_for_flh
) VALUES (
  'cos_chat', 'Chief of Staff', 'The CoS execution assistant — goals, tasks, calendar & notes with batch-plan approval.',
  false, 'deepseek', 'deepseek-chat', 'internal', true, true
)
ON CONFLICT (feature_key) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT action_key, surface, ai_enabled FROM shared.ai_action_catalogue
--    WHERE surface='workspace' ORDER BY action_key;   -- expect 15 rows
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='shared' AND table_name='ai_pending_actions'
--      AND column_name IN ('plan_id','plan_step');     -- expect 2 rows
--   SELECT to_regclass('shared.ai_pending_plans');      -- not null
-- ============================================================
