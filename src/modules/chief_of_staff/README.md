# Chief of Staff (CoS) — agent core (PR3)

A **scoped persona of the Praxis runtime**, mounted at `/api/v1/cos`. The CoS
turns the CEO's plain-language intentions into a **batch plan** — a goal, its
milestones, tasks, calendar events and notes — that the CEO approves **once**;
the plan then executes step-by-step as the CEO.

It never touches the ERP. Its action catalogue is limited **structurally** to
`surface='workspace'` rows (goals / tasks / calendar / notes / contacts). Praxis
is byte-for-byte unchanged.

## Files

| File | Role |
|---|---|
| `cos.routes.js` | `/cos` router; `requireCeo` guard (v1 CEO-only) |
| `cos.controller.js` | thin HTTP handlers |
| `cos.service.js` | the CoS turn: scoped catalogue → persona prompt → failover router → planner; conversations; plan confirm/reject; graceful stub |
| `cos.persona.js` | system prompt (scope guardrail + `{{step:N.field}}` batch instructions) |
| `cos.planner.js` | model tool-calls → `ai_pending_plans` + ordered `ai_pending_actions`; token resolution (`resolveTokens`) |
| `cos.plan-executor.js` | on confirm: run steps in order via `praxis.executor` (loopback as CEO), resolve cross-step tokens, idempotent + resumable |
| `cos.repo.js` | `ai_pending_plans` + plan-tagged `ai_pending_actions` SQL |
| `cos.validator.js` | Zod input schemas |
| `cos.events.js` | plan lifecycle events (PR4 realtime subscribes) |
| `cos.risk.js` · `cos.followups.service.js` · `cos.accountability.repo.js` · `cos.briefing.js` | **PR4** — risk engine, follow-up state machine, accountability data, briefing section |
| `cos.plan-builder.js` | **PR5** — build a PROPOSED batch plan from explicit steps (templates + reschedule reuse the approval gate) |
| `cos.memory.js` · `cos.memory.repo.js` · `cos.memory.subscribers.js` | **PR5** — RAG memory over goals/notes/decisions (shared corpus, owner-scoped, `restricted`) |
| `cos.templates.js` · `cos.templates.repo.js` | **PR5** — playbooks: capture a goal as day-offsets, re-date into a batch plan |
| `cos.scheduler.js` | **PR5** — pure free-slot finder + load/overload; find-focus, today's load, batch reschedule |
| `cos.meeting.js` | **PR5** — meeting prep brief for a calendar event |
| `cos.overview.js` · `cos.overview.repo.js` | **PR5** — CEO cross-brand portfolio (documented isolation exception) |

Reused as-is: `praxis.executor`, `praxis.repo` (conversations/messages, now
`kind`-aware), `governance.service` (feature `cos_chat`, usage ledger),
`transcription.service`, and the new reusable `src/services/llm-router.js`.

## Batch plan + cross-step references

The model proposes the whole plan as several tool calls in one turn. A step that
needs an id from an earlier step uses `{{step:N.field}}` (N = 0-based step
index; field ∈ `goal_id`/`milestone_id`/`task_id`/`event_id`). Example:

```
step 0  create_goal        → returns goal_id
step 1  add_milestone       id = {{step:0.goal_id}}
step 2  create_task
step 3  link_task           id = {{step:0.goal_id}}, taskId = {{step:2.task_id}}
```

The executor resolves tokens from prior steps' `execution_result` (the endpoint
body, `{data:…}` envelope handled) before each loopback call.

## Endpoints

```
GET    /api/v1/cos/conversations
POST   /api/v1/cos/conversations
GET    /api/v1/cos/conversations/:id
DELETE /api/v1/cos/conversations/:id
POST   /api/v1/cos/conversations/:id/messages   → may return a plan
POST   /api/v1/cos/conversations/:id/save-note   → summarise → upsert Workspace note
GET    /api/v1/cos/plans/:planId
POST   /api/v1/cos/plans/:planId/confirm         → approve → execute batch
POST   /api/v1/cos/plans/:planId/reject

# Accountability (PR4)
GET    /api/v1/cos/followups
POST   /api/v1/cos/followups/:id/respond|reason|act|snooze|dismiss

# Intelligence (PR5)
GET    /api/v1/cos/prep/:eventId                 → meeting prep brief
POST   /api/v1/cos/schedule/focus                → find focus slots + a booking plan
GET    /api/v1/cos/schedule/load?date=           → day load / overload
POST   /api/v1/cos/schedule/reschedule           → shift matching tasks (batch plan)
GET    /api/v1/cos/cross-brand/overview          → CEO portfolio across brands
GET    /api/v1/cos/templates                     → list playbooks
POST   /api/v1/cos/templates                     → save a goal as a playbook
POST   /api/v1/cos/templates/:id/instantiate     → reuse a playbook → batch plan
```

## Intelligence (PR5)

- **Memory (wow #7)**: goal/note/decision changes are indexed into the shared
  RAG corpus (`ai_knowledge_chunks` + `ai_embeddings`), owner-scoped via
  `metadata.user_id` and `sensitivity='restricted'` so Praxis never retrieves
  them. The CoS turn injects a live goals snapshot + nearest memory as context,
  so "how is X doing?" is grounded. Degrades to [] with no embeddings vendor.
- **Meetings (wow #4)**: `prep/:eventId` assembles a deterministic brief; voice
  brain-dump → goal reuses the existing transcription + planner path.
- **Scheduling (wow #5)**: a pure free-slot finder (no double-book, work + quiet
  hours) and load/overload math; find-focus books via a create_event plan.
- **Cross-brand (wow #6)**: a CEO-only aggregate read (see
  `docs/ENTITY_ISOLATION.md` — CEO cross-brand exception).
- **Playbooks (wow #9)**: capture a goal as day-offsets; reuse re-dates them into
  a batch plan through the same one-tap approval gate.

## Gates & failover

- **Audience**: `requireCeo` (v1). RBAC re-applies on every executed step.
- **On/off switch**: the `cos_chat` feature flag, toggled from **AI Control →
  Feature Flags** (`canUseFeature('cos_chat')`; also enforces per-user cap +
  budget). No env var, no redeploy — the CEO owns it. Off ⇒ graceful stub.
- **LLM routing**: `llm-router.chatWithFailover` — DeepSeek → Gemini → OpenAI,
  skips `red`/unconfigured vendors, records a `failover_engaged` incident when a
  fallback engages. Usage metered on the governance ledger under `cos_chat`.
