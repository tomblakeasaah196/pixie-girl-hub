-- ============================================================
-- MIGRATION 000349 — CoS: search_users matches job titles + disambiguation
-- Pixie Girl Hub · V2.2 · AI Chief of Staff
--
-- "Tell the operations manager…" used to dead-end: workspace.search_users
-- (GET /tasks/assignees) matched name/email/RBAC role only, but the CEO
-- refers to people by JOB TITLE (shared.staff_profiles.job_title) — a field
-- the query never touched and the result never returned. And when a bare
-- first name matched two people, the tool description gave the model no
-- protocol, so it picked one silently.
--
-- The repo now joins staff_profiles, tokenises the query (every word must
-- match name/email/job title/roles, any order) and returns job_title. This
-- migration teaches the catalogue row the same truth:
--   • description says what is searchable and what comes back;
--   • it hard-codes the disambiguation protocol (several matches → ask the
--     CEO, never pick silently) — mirrored in cos.persona so the rule holds
--     even if one of the two surfaces regresses;
--   • examples cover the job-title utterance.
--
-- Backward compatible: one UPDATE to an existing surface='workspace' row;
-- Praxis rows untouched.
-- ============================================================

UPDATE shared.ai_action_catalogue SET
  description =
    'Find a STAFF user_id to assign a task to, or to invite to a calendar '
    'event. Searches name, email, job title (e.g. ''Operations Manager'') and '
    'role (e.g. ''BDM''); a multi-word query matches its words in any order, '
    'so ''operations manager'' and ''manager operations'' both work — if a '
    'full phrase finds nobody, retry once with a shorter fragment. Returns '
    'each teammate''s user_id, name, email, job_title and role. If SEVERAL '
    'teammates match an ambiguous name (two Samuels), do NOT pick one — ask '
    'the CEO which she means, listing each candidate''s name + job title, and '
    'hold dependent steps until she answers. This is the ONLY source of a '
    'valid assigned_to / participant user_id. A contact_id from '
    'search_contacts is a customer/supplier, NOT a staff user, and can never '
    'be assigned work — use reference_type=''contact'' to link a task to a '
    'contact instead.',
  payload_schema = '{
    "type": "object",
    "properties": {
      "q": {"type": "string", "description": "name, job title or role to search (words match in any order); omit to list the whole team"},
      "page_size": {"type": "integer"}
    },
    "required": []
  }'::jsonb,
  examples = '[
    {"utterance": "Assign this to my BDM", "payload": {"q": "BDM"}},
    {"utterance": "Tell the operations manager immediately", "payload": {"q": "operations manager"}},
    {"utterance": "Put Samuel on it", "payload": {"q": "Samuel"}},
    {"utterance": "Who is on my team?", "payload": {}}
  ]'::jsonb,
  updated_at = now()
WHERE action_key = 'workspace.search_users';

-- ============================================================
-- Verify
--   SELECT description FROM shared.ai_action_catalogue
--    WHERE action_key = 'workspace.search_users';   -- mentions job title
--   SELECT jsonb_array_length(examples) FROM shared.ai_action_catalogue
--    WHERE action_key = 'workspace.search_users';   -- 4
-- ============================================================
