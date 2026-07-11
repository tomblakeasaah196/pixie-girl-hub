# Goals & Notes (`src/shared/goals`)

The **Goals** layer of the Workspace — the data foundation of the AI Chief of
Staff (see `docs/AI_CHIEF_OF_STAFF_IMPLEMENTATION.md`). PR1 is backend-only and
AI-free: the CEO can run the whole goal system by hand; the Chief of Staff agent
(PR3) later drives these same endpoints through the confirm gate.

## Surfaces

- `GET/POST /api/v1/goals`, `GET/PATCH/DELETE /api/v1/goals/:id`
- `POST/PATCH/DELETE /api/v1/goals/:id/milestones[/:mid]`
- `POST/DELETE /api/v1/goals/:id/stakeholders[/:sid]` — attach users/contacts
- `POST/DELETE /api/v1/goals/:id/tasks/:taskId/link` — link an existing task
- `POST/DELETE /api/v1/goals/:id/events/:eventId/link` — link an existing event
- `GET/POST /api/v1/notes`, `GET/PATCH/DELETE /api/v1/notes/:id`

All gated on `requirePermission("goals", …)`. Notes ride under the same
permission and are **personal to their owner** (owner-scoped reads/writes).

## Tables (shared schema, business-tagged)

`shared.goals`, `shared.goal_milestones`, `shared.goal_stakeholders`,
`shared.workspace_notes` — migrations `000320`–`000321`. `shared.tasks` and
`shared.calendar_events` gain nullable `goal_id`/`milestone_id` back-references
(a goal *links* tasks/events, it does not own their rows).

## Progress

`goals.progress_pct` is a cached rollup = `round(100 * done / total)` over
milestones (excluding `skipped`) + directly-linked tasks (excluding
`cancelled`), equal weight per item. It is recomputed:

- on every goal-owned write (milestone CRUD, task/event link) — `goals.service`;
- lazily on `GET /goals/:id` (the detail read self-heals the cache);
- when a linked task's status changes on the board — `goals.subscribers.js`
  listens to the `tasks` domain events and refreshes the owning goal.

## Module shape

`goals.routes → goals.controller → goals.service → goals.repo`, with
`goals.validator` (Zod) and `goals.events` (domain events). Notes mirror the
same split (`notes.*`). `goals.subscribers.registerGoalsSubscribers()` is wired
in `src/config/socket.js` and `src/jobs/worker.js`.
