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
GET    /api/v1/cos/plans/:planId
POST   /api/v1/cos/plans/:planId/confirm         → approve → execute batch
POST   /api/v1/cos/plans/:planId/reject
```

## Gates & failover

- **Audience**: `requireCeo` (v1). RBAC re-applies on every executed step.
- **Governance**: `canUseFeature('cos_chat')` (flag + grant + budget).
- **Master switch**: `COS_ENABLED` (env) — off ⇒ graceful stub even with a vendor.
- **LLM routing**: `llm-router.chatWithFailover` — DeepSeek → Gemini → OpenAI,
  skips `red`/unconfigured vendors, records a `failover_engaged` incident when a
  fallback engages. Usage metered on the governance ledger under `cos_chat`.
