# AI Chief of Staff — Implementation Guide (6 PRs)

> Status: **PR1–PR4 delivered · PR5–PR6 pending.** This document is the single source
> of truth for the Chief of Staff (CoS) feature. It is exhaustive by intent: every
> table, column, endpoint, file, permission, job, and acceptance criterion is named.
> No step is left to interpretation.

## Build state & workflow (read this first)

**Each PR ships as its own GitHub pull request that merges to `main`, and every
merge to `main` triggers a deploy** (migrations run as a one-shot pre-deploy job).
So:

- Do **not** stack PRs on a branch whose PR is already merged — a merged PR is
  closed and cannot deploy new commits. Start each PR from the latest `main`
  (`git fetch origin main && git checkout -B <branch> origin/main`), build, open a
  **new** PR.
- **Migration numbers are shared across all feature branches.** `main` moves fast
  (other teams merge constantly). Always pick the **next free number above the
  current max on `main`** at the moment you open your PR, and reconcile
  `scripts/verify-schema.js` `EXPECTED_SHARED` against `main`'s current value
  (not the number written here) — rebasing will surface both as conflicts; resolve
  by keeping both deltas.

| PR | Scope | Status | Migrations | Branch |
|---|---|---|---|---|
| 1 | Goals/milestones/notes backend | ✅ **Delivered** | `000320`–`000322` | `claude/cos-pr1-goals-data-api` (PR0 concept was `…-concept-gla3zu`, merged in #442) |
| 2 | Goals/Notes frontend | ✅ **Delivered** | — | `claude/cos-pr2-goals-frontend` (branched off `main` after PR1 merged in #447) |
| 3 | CoS agent core + failover router | ✅ **Delivered** | `000324` | `claude/chief-of-staff-pr3-z9wmy7` (branched off `main` after PR2 merged in #450) |
| 4 | Accountability loop | ✅ **Delivered** | `000325` | `claude/chief-of-staff-pr4-1uxza4` (branched off `main` after PR3 merged in #452) |
| 5 | Intelligence (RAG, meetings, scheduling, cross-brand) | ⬜ pending | next free on `main` | " |
| 6 | Personality, settings, polish, docs | ⬜ pending | next free on `main` | " |

**Parallelisable now (PR1–PR3 merged):** a second engineer can start **PR4's
backend** — the risk engine (`cos.risk.js`), the hourly `cos-accountability`
scheduler, the follow-up state machine (respond/reason/snooze/dismiss), and the
`cos_followups`/`cos_nudges` migrations — against PR1's data alone. Three seams
must coordinate with a PR3 that is now merged (so they are unblocked, not
blocking): the **re-plan-on-delay** path reuses `cos.plan-executor.js`; the
briefing **LLM narrative** reuses `src/services/llm-router.js`; and the shared
**migration sequence** (take the next free number above `000324` and bump
`EXPECTED_SHARED`). PR4's UI (the `GoalDetailPanel` AI-Insights card) sits on
PR2's components, already merged.

---

## 0. Scope, philosophy, and hard boundaries

### 0.1 What CoS is

A **"better Notion" execution assistant** for the CEO, living as tabs inside the existing
**Workspace** module (`apps/admin/src/pages/workspace/WorkspacePage.tsx`). It turns natural-language
brain-dumps into structured **Goals → Milestones → Tasks → Calendar events → Notes**, then
**proactively follows up** to drive accountability.

It is a **persona of the existing Praxis agent runtime** — it reuses the orchestrator, the
permission-inheriting executor, governance/metering, and the human-in-the-loop confirm gate — but
its **action catalogue is scoped to a fixed, small set of tables**. It never reaches into the ERP.

### 0.2 Hard table boundary (the "specific tables" rule)

CoS may **only** read/write these tables. This is enforced structurally (§3.4), not by prompt.

| Table | Access | Notes |
|---|---|---|
| `shared.goals` | read/write | **new** |
| `shared.goal_milestones` | read/write | **new** |
| `shared.goal_stakeholders` | read/write | **new** — links contacts/users to a goal |
| `shared.workspace_notes` | read/write | **new** — the "Notes" surface |
| `shared.tasks` | read/write | existing; CoS sets `goal_id`/`milestone_id` |
| `shared.task_subtasks` | read/write | existing |
| `shared.calendar_events` | read/write | existing; CoS sets `goal_id` |
| `shared.event_participants` | read/write | existing; attach contacts/users to events |
| `shared.contacts` | **read + search only** | attach as stakeholders/participants. **No contact CRUD** — that stays in CRM/Praxis. |

CoS **CANNOT** touch sales, cash, invoicing, stock, HR, production, purchasing, expenses,
approvals, pricing, or any other module. Those are Praxis's job. (Wow-list items 1 & 2 —
"business-aware accountability" and "delegation chasing staff across the ERP" — are **explicitly
out of scope** and must not appear in the catalogue.)

### 0.3 Feature set (wow-list 3–8, confirmed)

3. **Proactive risk radar & re-planning** — no-progress detection, slippage prediction, propose a re-planned schedule.
4. **Meeting intelligence** — voice brain-dump → structured goal; meeting prep briefs; decision capture → tasks/notes.
5. **Smart scheduling & focus protection** — find focus time, batch reschedule, overload detection.
6. **Cross-brand command** — one CoS spanning Pixie Girl + Faitlynhair for the CEO.
7. **Memory & narrative (full RAG)** — "how is X doing?", "what did I decide?", pattern learning.
8. **Delight** — custom name/tone/avatar, win celebrations, adaptive nudge timing.

### 0.4 Locked product decisions

| # | Decision |
|---|---|
| Data model | New `shared.goals` + `shared.goal_milestones`; tasks/events link via explicit nullable `goal_id`/`milestone_id` FKs |
| Agent | CoS = **Praxis persona**, scoped catalogue subset, own conversation kind, own system prompt |
| Writes | **Batch-plan approval** — CoS proposes the whole plan; CEO approves once; executor runs the batch |
| Audience | **CEO only** for v1 (`is_ceo`), designed to open up later |
| Proactive | **Full build** — scheduler + conversational follow-up state machine + notification action-buttons |
| Briefing | **Extend** the existing 07:00 `ai-briefing` + weekly (do not multiply cron jobs) |
| Memory | **Full RAG** over goal/task/note history + LLM narrative |
| Delivery | **In-app + web-push + email** (no WhatsApp) |
| Templates | **Generate fresh, then offer the last matching playbook as a template** (hybrid) |
| LLM routing | **Multi-vendor failover**: DeepSeek (primary) → Gemini (fallback) → OpenAI, driven by `ai_model_catalogue` + vendor health |
| Naming | **CoS only** carries the custom name. Praxis keeps its name. |

### 0.5 Reused infrastructure (do not rebuild)

- **Agent runtime**: `src/modules/praxis_ai/` — `praxis.service.postMessage`, `praxis.orchestrator`, `praxis.executor` (loopback-HTTP execution as the confirming user), `praxis.repo`.
- **Confirm gate**: `shared.ai_pending_actions` (has `execution_result JSONB` — used to thread created IDs between batch steps).
- **Governance/metering**: `src/modules/ai_governance/governance.service` — `canUseFeature`, `listActions`, usage ledger, `ai_feature_flags`, `ai_vendor_credentials`, `ai_model_catalogue`, `ai_vendor_health_pings`.
- **Chat UI**: `apps/admin/src/components/praxis/` — `PraxisConversation` (`variant="page"`), `ChatThread`, `PraxisInput`, `PendingActionCard`, `src/lib/praxis-api.ts`.
- **Tasks/calendar backend**: `src/shared/tasks/`, `src/shared/calendar/` (mounted at `/api/v1/tasks`, `/api/v1/calendar` in `src/routes/index.js`).
- **Tasks/calendar frontend**: `apps/admin/src/pages/workspace/` (`api.ts`, `hooks.ts`, `types.ts`, `TaskFormModal`, `EventFormModal`, `TaskDetailPanel`, calendar views).
- **Notifications**: `src/services/notifications.service.js` (in-app + socket + web-push; per-type/channel prefs). Email: `src/services/email.service.js`.
- **Voice**: `src/services/transcription.service.js` (already wired into `praxis.service.postMessage`).
- **Embeddings/RAG**: `src/services/embeddings.service.js`, `shared.ai_embeddings`, `shared.ai_knowledge_chunks`; `src/ai/rag-pipeline.js`.
- **Learning**: `src/modules/praxis_ai/learning.service.js`, `shared.ai_learning`.
- **Schedulers**: `src/jobs/schedulers/ai-briefing.js` (07:00 Africa/Lagos), `weekly-reports.js`, cron-lock, `src/jobs/queue.js`.
- **Realtime**: `src/realtime/emitter.js`, `rooms.js`, `praxis-realtime.js`.

### 0.6 Cross-cutting rules (apply to every PR)

- **Module pattern**: `routes → controller → service → repo`, `validator` (Zod), `events`. Controllers never call repos; services never touch req/res; repos never emit events.
- **RBAC**: every write goes through `requirePermission(module, action)` → `req.permission_scope`. CEO bypasses. CoS's executor re-enters this pipeline over loopback HTTP, so CoS can never exceed the CEO.
- **Money**: none of the CoS tables carry money. If a goal ever shows a figure it is display-only via `MoneyText` (no recompute).
- **Errors**: throw `AppError` with `code`/`httpStatus`/`userMessage`. Never leak SQL.
- **Audit**: every service write calls `audit({...})`.
- **Design canon** (`docs/FRONTEND_INSTRUCTION_MUST_READ.md`): Maroon Noir tokens only, glassmorphism on overlays, Playfair/Montserrat/JetBrains Mono, four states on every screen (loading/empty/error/permission-denied), mobile-first.
- **Feature flag**: the `cos_chat` row in `ai_feature_flags`, toggled from **AI Control → Feature Flags** (no env var, no redeploy — the CEO owns the on/off). Degrades gracefully to a stub when off, over cap/budget, or no vendor. *(As-built: PR3 dropped the originally-sketched `COS_ENABLED` env switch to remove the backend-engineer dependency.)*
- **Brand context**: `shared.goals`/`workspace_notes` carry a `business` column (same as `tasks`/`calendar_events`); every query filters by `req.brand` **except** the explicit cross-brand CEO path (§PR5).

---

## 1. Data model (all new objects, one place)

All new tables live in the `shared` schema (goals/tasks/calendar are shared, business-tagged).
Full DDL ships inside the migrations named per-PR; this is the consolidated reference.

### 1.1 `shared.goals`  (PR1)
```
goal_id         UUID PK default gen_random_uuid()
business        TEXT NOT NULL FK shared.business_config(business_key) ON DELETE CASCADE
title           TEXT NOT NULL
description      TEXT
status          TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','on_hold','achieved','archived','cancelled'))
priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent'))
owner_user_id   UUID FK shared.users(user_id) ON DELETE SET NULL
target_date     DATE
progress_pct    SMALLINT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100)  -- cached rollup
health          TEXT NOT NULL DEFAULT 'on_track'
                CHECK (health IN ('on_track','at_risk','behind','achieved'))          -- cached, computed by risk engine (PR4)
source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','cos','template'))
template_id     UUID FK shared.goal_templates(template_id) ON DELETE SET NULL          -- if built from a playbook (PR5)
created_by      UUID NOT NULL FK shared.users(user_id) ON DELETE RESTRICT
is_deleted      BOOLEAN NOT NULL DEFAULT false
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()  -- trigger shared.fn_set_updated_at()
```
Indexes: `(business, status) WHERE is_deleted=false`; `(owner_user_id, status)`; `(target_date) WHERE target_date IS NOT NULL AND is_deleted=false`.

### 1.2 `shared.goal_milestones`  (PR1)
```
milestone_id    UUID PK
goal_id         UUID NOT NULL FK shared.goals(goal_id) ON DELETE CASCADE
title           TEXT NOT NULL
description     TEXT
status          TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','in_progress','done','skipped'))
target_date     DATE
display_order   SMALLINT NOT NULL DEFAULT 0
depends_on_milestone_id UUID FK shared.goal_milestones(milestone_id) ON DELETE SET NULL  -- dependency chain (PR4/PR5)
completed_at    TIMESTAMPTZ
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```
Index: `(goal_id, display_order)`.

### 1.3 `shared.goal_stakeholders`  (PR1)
```
goal_id       UUID NOT NULL FK shared.goals ON DELETE CASCADE
user_id       UUID FK shared.users(user_id) ON DELETE CASCADE
contact_id    UUID FK shared.contacts(contact_id) ON DELETE CASCADE
role          TEXT              -- 'supplier','sponsor','collaborator', free text
CHECK ((user_id IS NOT NULL) <> (contact_id IS NOT NULL))   -- exactly one
PRIMARY KEY (goal_id, COALESCE(user_id, contact_id))  -- implemented via unique partial indexes
```

### 1.4 `shared.workspace_notes`  (PR1)
```
note_id       UUID PK
business      TEXT NOT NULL FK shared.business_config(business_key) ON DELETE CASCADE
user_id       UUID NOT NULL FK shared.users(user_id) ON DELETE CASCADE   -- owner (personal by default)
title         TEXT
body          TEXT NOT NULL DEFAULT ''         -- markdown
goal_id       UUID FK shared.goals(goal_id) ON DELETE SET NULL           -- optional link
milestone_id  UUID FK shared.goal_milestones(milestone_id) ON DELETE SET NULL
pinned        BOOLEAN NOT NULL DEFAULT false
source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','cos','meeting'))
is_deleted    BOOLEAN NOT NULL DEFAULT false
created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
```
Indexes: `(business, user_id) WHERE is_deleted=false`; `(goal_id) WHERE goal_id IS NOT NULL`; GIN trgm on `body` for search.

### 1.5 Link columns on existing tables  (PR1)
```
ALTER TABLE shared.tasks
  ADD COLUMN goal_id      UUID REFERENCES shared.goals(goal_id) ON DELETE SET NULL,
  ADD COLUMN milestone_id UUID REFERENCES shared.goal_milestones(milestone_id) ON DELETE SET NULL;
ALTER TABLE shared.calendar_events
  ADD COLUMN goal_id      UUID REFERENCES shared.goals(goal_id) ON DELETE SET NULL,
  ADD COLUMN milestone_id UUID REFERENCES shared.goal_milestones(milestone_id) ON DELETE SET NULL;
CREATE INDEX idx_tasks_goal            ON shared.tasks (goal_id) WHERE goal_id IS NOT NULL;
CREATE INDEX idx_calendar_events_goal  ON shared.calendar_events (goal_id) WHERE goal_id IS NOT NULL;
```

### 1.6 CoS agent objects  (PR3)
- `shared.ai_conversations` += `kind TEXT NOT NULL DEFAULT 'praxis' CHECK (kind IN ('praxis','chief_of_staff'))`. CoS lists/creates only `kind='chief_of_staff'`; Praxis only `kind='praxis'`.
- `shared.ai_action_catalogue` += `surface TEXT DEFAULT 'praxis' CHECK (surface IN ('praxis','workspace','both'))`. CoS's allowlist = `surface IN ('workspace')` AND `ai_enabled=true`. (Praxis keeps its full set unchanged.)
- `shared.ai_pending_plans` (**new** — batch-plan parent):
```
plan_id         UUID PK
conversation_id UUID NOT NULL FK shared.ai_conversations ON DELETE CASCADE
business        TEXT FK shared.business_config(business_key)
proposed_by_user_id UUID NOT NULL FK shared.users ON DELETE RESTRICT
title           TEXT NOT NULL
summary         TEXT NOT NULL                    -- plain-language plan description
status          TEXT NOT NULL DEFAULT 'proposed'
                CHECK (status IN ('proposed','confirmed','executing','executed','partially_failed','rejected','expired','cancelled'))
expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '60 minutes')
confirmed_by_user_id UUID FK shared.users
confirmed_at    TIMESTAMPTZ
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```
- `shared.ai_pending_actions` += `plan_id UUID REFERENCES shared.ai_pending_plans(plan_id) ON DELETE CASCADE`, `plan_step SMALLINT`. A single-action proposal keeps `plan_id = NULL` (fully backward compatible with Praxis).

### 1.7 Accountability objects  (PR4)
- `shared.cos_followups`:
```
followup_id   UUID PK
business       TEXT NOT NULL FK shared.business_config
user_id        UUID NOT NULL FK shared.users ON DELETE CASCADE
subject_type   TEXT NOT NULL CHECK (subject_type IN ('goal','milestone','task'))
subject_id     UUID NOT NULL
trigger        TEXT NOT NULL CHECK (trigger IN ('due_tomorrow','due_today','overdue','no_progress','slippage','weekly_review'))
state          TEXT NOT NULL DEFAULT 'open'
               CHECK (state IN ('open','asked','answered','resolved','snoozed','dismissed'))
question       TEXT
answer         TEXT CHECK (answer IN ('done','in_progress','delayed') OR answer IS NULL)
reason         TEXT
suggested_actions JSONB NOT NULL DEFAULT '[]'   -- [{label, kind, payload}]
notification_id UUID FK shared.notifications(notification_id) ON DELETE SET NULL
snooze_until   TIMESTAMPTZ
resolved_at    TIMESTAMPTZ
created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
```
Partial unique index to prevent duplicate open follow-ups: `UNIQUE (subject_type, subject_id, trigger) WHERE state IN ('open','asked')`.
- `shared.cos_nudges` (adaptive-timing + dedupe log):
```
nudge_id     UUID PK
user_id      UUID NOT NULL FK shared.users ON DELETE CASCADE
business      TEXT NOT NULL
type         TEXT NOT NULL          -- 'morning_briefing','evening_review','weekly_review','followup','celebration'
channel      TEXT NOT NULL          -- 'in_app','push','email'
sent_at      TIMESTAMPTZ NOT NULL DEFAULT now()
engaged_at   TIMESTAMPTZ            -- set when the user acts (adaptive timing signal, PR6)
reference_type TEXT
reference_id UUID
```
- `shared.notifications` += `actions JSONB NOT NULL DEFAULT '[]'` (array of `{label, value, endpoint}` for the Done/In-Progress/Delayed buttons). Backward compatible.

### 1.8 Intelligence objects  (PR5)
- `shared.goal_templates`:
```
template_id   UUID PK
business       TEXT FK shared.business_config           -- NULL = global/shared across CEO's brands
name           TEXT NOT NULL
description     TEXT
structure      JSONB NOT NULL      -- {milestones:[{title,offset_days,tasks:[{title,offset_days}]}]}
source_goal_id UUID FK shared.goals(goal_id) ON DELETE SET NULL
usage_count    INTEGER NOT NULL DEFAULT 0
created_by     UUID FK shared.users
created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
```
- **RAG memory** reuses `shared.ai_embeddings` + `shared.ai_knowledge_chunks` with `source_type` values `cos_goal`, `cos_milestone`, `cos_note`, `cos_decision`, scoped by `user_id`/`business`. No new embedding table.

### 1.9 Personalisation objects  (PR6)
- `shared.cos_settings`:
```
user_id         UUID PK FK shared.users(user_id) ON DELETE CASCADE
assistant_name  TEXT NOT NULL DEFAULT 'Chief of Staff'
tone            TEXT NOT NULL DEFAULT 'warm' CHECK (tone IN ('warm','concise','formal'))
avatar_url      TEXT
pronoun         TEXT NOT NULL DEFAULT 'she' CHECK (pronoun IN ('she','he','they','it'))
work_start      TIME NOT NULL DEFAULT '08:00'
work_end        TIME NOT NULL DEFAULT '18:00'
timezone        TEXT NOT NULL DEFAULT 'Africa/Lagos'
morning_brief_at TIME NOT NULL DEFAULT '07:00'
evening_review_at TIME NOT NULL DEFAULT '18:00'
quiet_start     TIME NOT NULL DEFAULT '21:00'
quiet_end       TIME NOT NULL DEFAULT '06:00'
celebrate_wins  BOOLEAN NOT NULL DEFAULT true
adaptive_timing BOOLEAN NOT NULL DEFAULT true
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```

---

## PR 1 — Goals data model + Goals/Notes backend

**Objective:** the complete data foundation and REST surface for goals, milestones, stakeholders,
and notes — with tasks/events linkable to goals. **No AI in this PR.** Fully testable via API.

**Depends on:** nothing. **Status: ✅ delivered** (commit `feat(goals): Chief of Staff PR1`).

### Migrations (`migrations/`) — as built
- `000320_shared_goals.sql` — §1.1 `goals`, §1.2 `goal_milestones`, §1.3 `goal_stakeholders`, §1.5 link columns + indexes, `fn_set_updated_at` triggers.
- `000321_shared_workspace_notes.sql` — §1.4 `workspace_notes` + indexes.
- `000322_shared_goals_permissions.sql` — seeds `shared.permissions` (`goals` × view/create/edit/delete at `all` scope) for owner/admin/manager.
- `scripts/verify-schema.js` `EXPECTED_SHARED` reconciled to **192** (`main` was at 188 + 4 new shared tables). NOTE: numbers `000318`/`000319` were taken by `recruitment` + `whatsapp_calls` merged to `main` first — hence `000320`+. Future PRs must re-check the max on `main` at open time.

### RBAC / module governance (mandatory, per CLAUDE.md)
- `src/shared/access/access.catalog.js`: add to `MODULES` and the module list:
  `{ key: "goals", group: "workspace", label: "Goals", description: "Your goals, milestones & notes" }`.
  (Notes ride under `goals`; no separate permission.)
- Seed `shared.permissions` rows for `goals` × `{view,create,edit,delete}` for CEO/exec roles (CEO bypasses anyway).
- `apps/admin/src/lib/modules.ts`: the `workspace` nav entry already exists; add `permission: "goals"` awareness where the Goals tab renders (tab-level gate, §PR2).
- Verify `MODULES` == distinct `requirePermission("goals", …)` keys (governance invariant).

### Backend module — `src/shared/goals/`
Files (module pattern): `goals.routes.js`, `goals.controller.js`, `goals.service.js`, `goals.repo.js`, `goals.validator.js`, `goals.events.js`, `README.md`.
Mount in `src/routes/index.js`: `["/goals", goalsRouter]` (beside `/tasks`, `/calendar`).

Endpoints (`/api/v1/goals`), all `requirePermission("goals", …)`, Zod-validated, brand-scoped:
| Method | Route | Purpose |
|---|---|---|
| GET | `/goals` | list (filters: status, owner, priority, target range, `q`) |
| POST | `/goals` | create goal |
| GET | `/goals/:id` | goal detail (milestones, tasks, events, notes, stakeholders, progress) |
| PATCH | `/goals/:id` | update fields |
| DELETE | `/goals/:id` | soft-delete |
| POST | `/goals/:id/milestones` | add milestone |
| PATCH | `/goals/:id/milestones/:mid` | update milestone (status, date, order, dependency) |
| DELETE | `/goals/:id/milestones/:mid` | remove milestone |
| POST | `/goals/:id/stakeholders` | attach user/contact |
| DELETE | `/goals/:id/stakeholders/:sid` | detach |
| POST | `/goals/:id/tasks/:taskId/link` | link existing task → goal/milestone |
| DELETE | `/goals/:id/tasks/:taskId/link` | unlink |
| POST | `/goals/:id/events/:eventId/link` | link existing event → goal |
| GET | `/notes` | list notes (filters: goal_id, pinned, `q`) |
| POST | `/notes` | create note |
| GET/PATCH/DELETE | `/notes/:id` | note detail / update / soft-delete |

### Progress rollup (service)
`progress_pct` computed in `goals.service` on any child change:
`round(100 * (weighted done) / (total))`, weighting milestones and directly-linked tasks
(config constant `MILESTONE_WEIGHT`/`TASK_WEIGHT`, default equal). Persisted to `goals.progress_pct`
(cached) and recomputed transactionally when a linked task/milestone status changes — hook into
`tasks.service` completion path (emit `task.completed` → goals subscriber recomputes). `health` stays
default here; the risk engine (PR4) owns it.

### Events / realtime — `goals.events.js`
`goal.created|updated|deleted`, `milestone.created|updated`, `note.created|updated`. Subscribers:
Socket.io room `brand:{business}:goals` + `user:{uuid}:goals`; `audit`. Wire in `src/realtime/`.

### Tests
- `tests/unit/goals/progress.test.js` — rollup math (0 children, all done, mixed, weighting).
- `tests/unit/goals/repo-scope.test.js` — brand isolation + soft-delete filter + `own/team/all` scope.
- `tests/integration/goals.routes.test.js` (RUN_DB_TESTS) — CRUD, link/unlink, validation 422s.

### As-built notes (deviations from the sketch)
- **Notes ride inside the `goals` module** (`src/shared/goals/notes.*`), mounted at `/api/v1/notes`, gated on `requirePermission("goals", …)`, and **owner-scoped** (personal to the creator).
- **Progress is a pure, unit-tested JS formula** (`goals.repo.progressPct`) applied over four DB counts — not raw SQL arithmetic — so the rollup is testable without a DB. Recomputed on every goal-owned write, lazily on `GET /goals/:id` (self-heals the cache), and via `goals.subscribers.js` which listens to `tasks` domain events and is registered in **both** `src/config/socket.js` (API) and `src/jobs/worker.js` (workers/in-process dev).
- Tests shipped: `tests/unit/goals/progress.test.js` + `tests/unit/goals/validator.test.js` (14 tests). DB-integration tests (progress + brand isolation end-to-end) are deferred to a live-DB pass — no Postgres was available in the build session.

### Definition of Done
- [x] Migrations apply cleanly (DDL uses only existing primitives: `fn_set_updated_at`, `pg_trgm`); `verify-schema` `EXPECTED_SHARED` bumped to 192.
- [x] All endpoints return correct shapes; unknown fields rejected by Zod (`.strict()`).
- [x] Progress rollup covered by unit tests (empty/all-done/partial/rounding/coercion).
- [x] Brand isolation enforced on every repo query (`WHERE business = $1`); notes additionally owner-scoped.
- [x] `eslint` clean on new/edited files; goals + access unit suites green; audit rows on every write.
- [ ] DB-integration test (progress + isolation against live Postgres) — deferred to a migrated-DB pass.

---

## PR 2 — Goals & Notes frontend (My Goals dashboard, Goal detail, Notes, tabs)

**Objective:** the full Workspace UI for goals & notes — **no AI**. The CEO can manually run her
whole goal system. Testable end-to-end in the browser.

**Depends on:** PR1.

### Tab wiring — `apps/admin/src/pages/workspace/`
- `types.ts`: extend `WorkspaceTab` union → add `"goals" | "notes" | "chief-of-staff"`.
- `WorkspacePage.tsx`: extend the `TABS` array. **Order:** `My Day · Goals · Tasks · Calendar · Notes · AI Chief of Staff · My HR`. Icons: `Target` (goals), `StickyNote` (notes), `Sparkles` (CoS). The CoS + Goals tabs render only when `user.is_ceo` for v1 (tab-level guard; API also enforces). Add `activeTab === "goals" | "notes" | "chief-of-staff"` branches. (CoS tab body lands in PR3.)

### New files (mirror the Tasks pattern exactly)
- `goals-api.ts` (or extend `api.ts`) — typed client for every §PR1 endpoint.
- `goals-hooks.ts` — TanStack Query keyed `["workspace", biz, "goals", …]`, mutations invalidate board+goals.
- `goals-types.ts` — `Goal`, `Milestone`, `Stakeholder`, `Note`, `GoalCreateInput`, etc.
- `GoalsTab.tsx` — the **My Goals executive dashboard**:
  - KPI row: Active Goals, Avg Progress, Upcoming Deadlines, Overdue Items (reuse `KpiTile`).
  - Active goals list with progress ring + health chip + target date + owner avatar.
  - "Today's Priorities" and "Recent Activity" panels (from goal events).
  - Four states (skeleton / empty-with-CTA / error-with-retry / permission-denied).
- `GoalDetailPanel.tsx` — mirrors `TaskDetailPanel`: header (title, status, priority, progress ring),
  Milestones list (reorder, toggle status), linked Tasks (reuse `TaskCard`), linked Calendar events,
  Stakeholders (contact/user chips), Notes section, and an **AI Insights** placeholder card (filled by PR4).
- `GoalFormModal.tsx` — create/edit goal (title, description, priority, owner, target date). Glass modal per canon.
- `MilestoneRow.tsx`, `StakeholderPicker.tsx` (contact search via `/api/v1/contacts` read), `NotesTab.tsx` + `NoteEditor.tsx` (markdown, pin, link-to-goal).
- Extend `TaskFormModal.tsx` and `EventFormModal.tsx` with an optional **Goal/Milestone picker** so manual tasks/events can attach on creation.

### Design canon checks
- Run the 10-question gate. Palette tokens only (`--accent-deep`, etc.), no inline hex.
- Progress ring uses accent tokens; money never appears here.
- Mobile: Goals dashboard stacks; detail panel becomes a bottom-sheet (reuse the existing mobile overlay pattern in `WorkspacePage.tsx`).

### Tests
- Component tests for `GoalsTab` states; `goals-hooks` query-key invalidation; a Playwright happy-path (create goal → add milestone → link task → see progress move).

### As-built notes
- Tabs order: **My Day · Goals · Tasks · Calendar · Notes · AI Chief of Staff · My HR**. Goals/Notes/CoS are **CEO-gated** (`user.isCeo`) via a `ceoOnly` flag on the tab list, with a matching guard so a non-CEO hitting `?tab=goals` falls back to My Day (API also enforces).
- `GoalsTab` owns selection + the `GoalDetailPanel` drawer + create/edit `GoalFormModal`, so `WorkspacePage` only gains tab entries + three render lines.
- `GoalDetailPanel` (glass right-drawer) does milestones (add / inline status / delete), linked tasks (link an existing task via picker / unlink), linked events (read-only), per-goal notes (quick-add), and goal edit/delete (two-step confirm).
- `NotesTab` = personal notes grid (pin, search, create/edit/delete via `NoteEditor` modal). `ChiefOfStaffTab` is a polished stub (chat lands in PR3).
- Reused `ProgressRing`, all four states (loading/empty/error), design-canon tokens only.

### Definition of Done
- [x] Goals, Notes, and a stub CoS tab appear in the Workspace tab bar (CEO only).
- [x] Full manual CRUD works (goals, milestones, notes, task-linking); all four states render.
- [x] `cd apps/admin && npm run build` (tsc + vite) green; `eslint` clean on new files.
- [x] Maroon-Noir tokens only (no inline hex); glass overlays; mobile-first grids.
- [ ] Live visual QA against `docs/frontend-demo` — deferred to a running-app pass (no browser/live API in the build session).

---

## PR 3 — CoS agent core (persona, scoped catalogue, batch-plan approval, chat tab)

**Objective:** the Chief of Staff can chat, propose a **batch plan** (goal + milestones + tasks +
events + notes), and — on **one approval** — execute the whole plan as the CEO. Includes the
multi-vendor failover router.

**Depends on:** PR1, PR2.

### Migrations
- `0003XX_shared_cos_agent.sql`:
  - `ai_conversations` += `kind` (§1.6).
  - `ai_action_catalogue` += `surface` (§1.6).
  - `ai_pending_plans` table (§1.6); `ai_pending_actions` += `plan_id`, `plan_step` (§1.6).
  - Seed `ai_action_catalogue` rows (`surface='workspace'`, `ai_enabled=true`, `entity_scope='both'`, correct `required_permission`) for **exactly** the §0.2 endpoints:
    `workspace.create_goal`, `workspace.update_goal`, `workspace.add_milestone`, `workspace.update_milestone`,
    `workspace.create_task`, `workspace.update_task`, `workspace.move_task`, `workspace.add_subtask`,
    `workspace.create_event`, `workspace.update_event`, `workspace.reschedule_event`,
    `workspace.create_note`, `workspace.attach_stakeholder`, `workspace.link_task`, `workspace.link_event`.
    Each row's `payload_schema` mirrors the Zod validator; each has few-shot `examples`.
  - Seed `ai_feature_flags` row `chief_of_staff` (default off) + governance `feature_key = 'cos_chat'`.

### LLM failover router — `src/services/llm-router.js` (**new**, reusable)
- `chatWithFailover({ capability:'chat', messages, tools, user, brand })`:
  1. Resolve ordered vendor chain from `ai_model_catalogue` defaults + `ai_vendor_credentials` health (`last_health_status`), preferring DeepSeek → Gemini → OpenAI, skipping `red`/unconfigured.
  2. Call `llm.service.chat` per vendor; on transient error/timeout/parse-leak, advance to next.
  3. On failover, insert a `ai_vendor_health_pings` row and mark `failover_engaged` (existing incident concept).
  4. Return `{content, tool_calls, usage, vendor, model}`; caller meters usage on the governance ledger.
- CoS orchestrator uses this router; Praxis can adopt it later (no Praxis behaviour change in this PR).

### CoS agent — reuse Praxis, add a persona layer
- `src/modules/chief_of_staff/` (thin — delegates to Praxis runtime):
  - `cos.routes.js` mounted `/api/v1/cos` (conversations list/create/get/archive, postMessage, plan confirm/reject). Guard: `requireCeo` middleware for v1.
  - `cos.controller.js`, `cos.service.js` — wrap `praxis.service` with `kind='chief_of_staff'`, the scoped catalogue filter (`surface='workspace'`), CoS system prompt, and `cos_chat` governance feature.
  - `cos.persona.js` — builds the system prompt from `cos_settings` (name/tone/pronoun — PR6; defaults until then) + the "you only manage goals/tasks/calendar/notes/contacts; hand anything else to Praxis" guardrail.
  - `cos.planner.js` — post-processes the model's multi-tool output into a **plan**: one `ai_pending_plans` row + ordered `ai_pending_actions` (`plan_step`). Supports cross-step references via token syntax `{{step:N.field}}` in payloads (e.g. milestone step references `{{step:0.goal_id}}`).
  - `cos.plan-executor.js` — on confirm: set plan `executing`; run steps in `plan_step` order via `praxis.executor.executeAction` (loopback HTTP as the CEO); after each step resolve `{{step:N.field}}` tokens from prior steps' `execution_result`; persist per-step status; final plan status `executed` / `partially_failed`. Idempotent + resumable (re-run skips `executed` steps).
- **Reused as-is:** `praxis.executor.js` (no change — it already executes one catalogued action as the user), `governance.service`, `ai_usage_ledger`, `transcription.service` (voice → text at turn start).

### Endpoints (`/api/v1/cos`)
| Method | Route | Purpose |
|---|---|---|
| GET | `/cos/conversations` | list CoS threads (kind filter) |
| POST | `/cos/conversations` | new thread |
| GET | `/cos/conversations/:id` | thread + messages + pending plans/actions |
| POST | `/cos/conversations/:id/messages` | post message → CoS turn (may return a plan) |
| POST | `/cos/plans/:planId/confirm` | approve → execute batch |
| POST | `/cos/plans/:planId/reject` | reject (reason) |

### Frontend — CoS chat tab
- `apps/admin/src/lib/cos-api.ts` — mirrors `praxis-api.ts` for `/cos/*`.
- `ChiefOfStaffTab.tsx` — renders `PraxisConversation` (`variant="page"`) **pointed at the CoS API** (parameterise the conversation source, or a thin `CosConversation` wrapper reusing `ChatThread`/`PraxisInput`).
- `BatchPlanCard.tsx` (**new**, extends `PendingActionCard` semantics) — shows the plan title + summary + the ordered steps grouped (Goal → Milestones → Tasks → Events → Notes), each with a human summary and expandable payload; **one Approve / one Reject**; live per-step status after approval (queued → executing → done/failed); expiry countdown.
- Wire `activeTab === "chief-of-staff"` in `WorkspacePage.tsx` to `ChiefOfStaffTab`.

### Tests
- `cos.planner` token-reference resolution; `cos.plan-executor` ordering + partial-failure + resume.
- Catalogue scoping: a CoS turn cannot select any `surface='praxis'` action (guardrail test).
- `llm-router` failover order + health-skip + incident write.
- Integration: "Launch Accessories in August" → plan with N steps → confirm → rows exist with correct FKs and cross-step goal_id wired.

### Definition of Done
- [x] Chatting in the CoS tab proposes a batch plan; approving it creates the goal + children in one gate.
- [x] CoS provably cannot call a non-workspace action (structural: tools built only from `surface='workspace'`; planner rejects any other; guardrail test).
- [x] Failover works when the primary vendor key is invalid (falls to Gemini, records incident) — `llm-router` unit-tested.
- [x] Usage metered on the governance ledger under `cos_chat`; the AI Control `cos_chat` flag off (or over cap/budget / no vendor) degrades to a graceful stub — no env switch.
- [x] Praxis behaviour byte-for-byte unchanged (only pre-existing test failures remain; no CoS-caused regression).

### As-built notes (deviations from the sketch)
- **Migration `000324`** (next free above `main`'s `000323`); `EXPECTED_SHARED` 192 → **193** (one new table, `ai_pending_plans`; `ai_conversations.kind`, `ai_action_catalogue.surface`, `ai_pending_actions.plan_id/plan_step` are ALTERs).
- **Scoped catalogue is enforced structurally**: `governance.repo.listActions` gained a `surface` filter; the CoS turn only ever builds tools from `surface IN ('workspace','both')`, so a Praxis action is un-callable — the planner also rejects any action not in the workspace allowlist (belt-and-braces).
- **`kind` scoping** is applied to `praxis.repo` conversation list/create (default `'praxis'`); CoS passes `'chief_of_staff'`. Existing Praxis threads are unaffected (migration defaults `kind='praxis'`).
- **Frontend**: the CoS tab body fills the PR2 stub (`ChiefOfStaffTab.tsx`) reusing the Praxis composer (`PraxisInput`) + `Markdown`; `BatchPlanCard.tsx` groups steps Goal → Milestones → Tasks → Calendar → Notes → People/links with one Approve/Reject, live per-step status, expiry countdown, and a Retry (resume) on partial failure. `cos-api.ts` mirrors `praxis-api.ts`.
- **Tests**: `tests/unit/chief_of_staff/{planner,plan-executor,scoping}.test.js` + `tests/unit/services/llm-router.test.js` (22 tests). A live-DB integration test (plan → confirm → rows with FKs) is deferred to a migrated-DB pass, as in PR1.

---

## PR 4 — Proactive accountability loop (scheduler + follow-up state machine + action-buttons + briefing)

**Objective:** CoS stops waiting. It detects risk, pings the CEO with **Done / In Progress /
Delayed** buttons, asks "why?", and offers/executes a re-plan. Extends the existing briefings.

**Depends on:** PR1, PR3 (re-plan reuses the batch executor).

### Migrations
- `0003XX_shared_cos_accountability.sql`: `cos_followups` (§1.7), `cos_nudges` (§1.7), `shared.notifications` += `actions JSONB` (§1.7).

### Risk engine — `src/modules/chief_of_staff/cos.risk.js`
Pure functions over goals/milestones/tasks (no LLM):
- `no_progress`: goal/milestone with no child status change in ≥ N days (config `COS_STALE_DAYS=14`).
- `slippage`: projected completion date > `target_date`, from remaining-milestone velocity → sets `goals.health` (`on_track|at_risk|behind`), persisted.
- `due_today` / `due_tomorrow` / `overdue`: from `tasks.due_at` and `milestone.target_date`.
Writes `goals.health` and emits per-subject follow-up candidates.

### Scheduler — `src/jobs/schedulers/cos-accountability.js` (**one new cron**, cron-locked)
- Runs hourly (cheap; deterministic), timezone-aware per `cos_settings`.
- For each due candidate not already covered by an **open** follow-up (partial-unique guard), create a `cos_followups` row (`state='open'`) and a **notification with `actions`**: `[{label:'✅ Done',value:'done'},{label:'🟡 In Progress',value:'in_progress'},{label:'🔴 Delayed',value:'delayed'}]`, delivered in-app + push + email per prefs (§0.4). Log `cos_nudges`.
- Respects quiet hours (§1.9) and dedupe.

### Follow-up state machine — endpoints (`/api/v1/cos`)
| Method | Route | Purpose |
|---|---|---|
| POST | `/cos/followups/:id/respond` | body `{answer:'done'\|'in_progress'\|'delayed'}` → advances state; on `done` marks subject done + `resolved`; on `delayed` returns `question:"What caused the delay?"` |
| POST | `/cos/followups/:id/reason` | body `{reason}` → generates `suggested_actions` (move deadline / notify stakeholder / reschedule dependents / propose re-plan) |
| POST | `/cos/followups/:id/act` | body `{action}` → executes a suggestion; a "reschedule dependents" suggestion builds a **batch re-plan** (PR3 executor) shifting dependent milestones/tasks |
| POST | `/cos/followups/:id/snooze` | `{until}` |
| POST | `/cos/followups/:id/dismiss` | close |

### Briefing extension (reuse — do NOT add morning/weekly crons)
- Extend `src/jobs/schedulers/ai-briefing.js` (07:00 Africa/Lagos): after the insights block, append a **CoS goals section** for the CEO — active goals w/ progress, at-risk/behind, overdue milestones/tasks, today's priorities. Deterministic (Tier-1) always; optional LLM narrative (Tier-2) via `llm-router`, metered, degrading to Tier-1 on any miss (same pattern already in the file). Log `cos_nudges type='morning_briefing'`.
- Extend `weekly-reports.js` with the **Monday executive review** (5 active goals, open tasks, overdue, meetings, "priority this week"). Deterministic + optional narrative.
- **Evening review (18:00):** handled by the same hourly `cos-accountability` scheduler firing an end-of-day summary at `cos_settings.evening_review_at` (completed / pending / overdue today, "reschedule unfinished?") — no separate cron.

### Frontend — actionable notifications + insights
- `apps/admin/src/pages/NotificationsPage.tsx` + the notifications drawer: render `notification.actions` as buttons; clicking calls `/cos/followups/:id/respond`; then inline "why?" input; then suggestion chips → `/act`. Optimistic + invalidate goals.
- `GoalDetailPanel` **AI Insights** card now shows health, slippage projection, and open follow-ups (fills the PR2 placeholder).
- Real-time: `cos-realtime.js` pushes follow-up + health updates to `user:{uuid}:goals`.

### Tests
- Risk-engine unit tests (stale, slippage projection, due buckets).
- State-machine transitions (open→asked→answered→resolved; delayed→reason→suggestions→act→re-plan).
- Dedupe guard (no duplicate open follow-up); quiet-hours suppression.
- Notification `actions` round-trip; email + push fan-out (mock transports).

### Definition of Done
- [x] A task due tomorrow produces exactly one follow-up + a 3-button notification across in-app/push/email.
- [x] Answering "Delayed" → "why?" → a suggestion that, when accepted, reschedules dependents via an approved batch re-plan.
- [x] Morning briefing and Monday review include the goals section; no new cron beyond `cos-accountability`.
- [x] `goals.health` reflects slippage; visible on the dashboard + detail panel.

### As-built notes (deviations from the sketch)
- **Migration `000325`** (next free above `main`'s `000324`); `EXPECTED_SHARED` 193 → **195** (two new tables, `cos_followups` + `cos_nudges`; `notifications.actions` is an ALTER). The `trigger` column is quoted (`"trigger"`) — it's a SQL keyword.
- **Risk engine (`cos.risk.js`) is pure** (no DB/LLM): `assessGoal` takes plain rows + a `now` and returns `{ health, slip, candidates }`. The hourly scheduler fetches, calls it, persists `goals.health` (new `goals.repo.setHealth`, writes only on change), and turns candidates into follow-ups. Fully unit-tested (`tests/unit/chief_of_staff/risk.test.js`).
- **Scheduler `cos-accountability.js`** is **one** new hourly cron (`CRON_COS_ACCOUNTABILITY`, default `0 * * * *`), cron-locked, registered in `worker.js`. It scans per brand for the CEO, raises follow-ups (partial-unique + cooldown dedupe), sends the 3-button notification (in-app + push + **email opt-in**), logs `cos_nudges`, and fires the **evening review** at 18:00 — all quiet-hours aware (defaults until `cos_settings`/PR6). Health still updates during quiet hours; only the nudge is suppressed.
- **Notifications**: `notifications.service.notify()` gained a backward-compatible `actions` param (persisted to the new `notifications.actions` JSONB, echoed over socket) and an **opt-in `email` flag** — off by default so this never turns on email for every notification type; only CoS asks for it, still gated by the user's per-type email pref.
- **Follow-up state machine** lives in `cos.followups.service.js` (respond/reason/act/snooze/dismiss under `/api/v1/cos/followups/:id/*`). `done` marks the subject done and `reschedule_dependents` builds a **batch re-plan** — both reuse the PR3 `praxis.executor` / `cos.plan-executor` (loopback as the CEO, RBAC re-applies). Action `endpoint`s are client-relative (`/cos/...`) so the admin API client can post them directly.
- **Briefings**: the CoS goals section is appended in `ai-briefing.js` (deterministic Tier-1 always; optional Tier-2 narrative via `llm-router`, metered, degrading on any miss). The **Monday executive review** folds into Monday's morning briefing (weekday-detected) rather than a new Monday cron — honouring "extend, don't multiply" + "no new cron". `weekly-reports.js` (Saturday) is left untouched to avoid a `report_templates` dependency.
- **Realtime**: `cos-realtime.js` pushes `followup.*` + `goal.health_changed` to `user:{id}:goals` (new room), registered in both socket init + worker. The frontend joins the room and invalidates goals/follow-ups on `pgh:cos:changed`.
- **Frontend**: `FollowupActions.tsx` drives the answer → why? → suggestion-chips flow inline in `NotificationsPage`; `GoalDetailPanel` gains the **AI Insights** card (health + note + open follow-ups with snooze/dismiss), filling the PR2 placeholder. `cos-api.ts` adds the follow-up hooks.
- **Tests**: `tests/unit/chief_of_staff/{risk,followups,accountability}.test.js` (22 new tests). A live-DB integration test (scan → follow-up → respond → re-plan against real Postgres) is deferred to a migrated-DB pass, as in PR1/PR3.

---

## PR 5 — Intelligence: RAG memory + meeting intelligence + smart scheduling + cross-brand + templates

**Objective:** the "wow" cognition — memory, meeting help, scheduling, cross-brand, playbooks.

**Depends on:** PR1, PR3, PR4.

### RAG memory (wow #7) — reuse embeddings
- `cos.memory.js`: on goal/milestone/note/decision change, upsert a chunk into `shared.ai_knowledge_chunks` + `shared.ai_embeddings` via `embeddings.service`, `source_type IN ('cos_goal','cos_milestone','cos_note','cos_decision')`, scoped `user_id`+`business`. Enqueue via existing `ai-embed-processor` job.
- Retrieval in CoS orchestrator: for "how is X doing?" / "what did I decide about Y?" queries, `rag-pipeline` retrieves CoS chunks (scoped) → LLM narrative: progress %, remaining, risks, recommendation (matches the concept's example output). Metered.
- Pattern learning (wow #7): via `learning.service` — record completion timing/preferences (e.g. "approvals cleared Tuesdays") into `ai_learning`; surfaced as gentle nudges.

### Meeting intelligence (wow #4)
- **Voice brain-dump → goal**: reuse `transcription.service` (already in the turn) — a long voice note routes through `cos.planner` to a batch plan. No new transport.
- **Meeting prep**: `GET /cos/prep/:eventId` — assembles a brief for a calendar event: linked goal status, recent linked notes, participant contacts (read `/contacts`), open questions. Rendered as a card in the CoS tab and optionally pushed 30 min before (via `cos-accountability`).
- **Decision capture**: `POST /cos/conversations/:id/messages` with intent "capture decisions" → creates tasks/notes + goal updates as a batch plan; decisions embedded as `cos_decision` chunks.

### Smart scheduling (wow #5)
- `cos.scheduler.js` read helpers over `calendar_events`:
  - **Find focus time**: `POST /cos/schedule/focus` `{duration, within}` → scans free/busy in work hours → proposes a slot → books via `workspace.create_event` (batch/confirm).
  - **Batch reschedule**: "move all marketing tasks to next week" → resolves matching tasks → batch re-plan (PR3).
  - **Overload detection**: `GET /cos/schedule/load?date=` → sums meeting hours + high-priority tasks vs a threshold → warning + "reschedule N?" suggestion.

### Cross-brand command (wow #6) — CEO only
- Because `shared.goals`/`tasks`/`calendar_events` are shared-schema + business-tagged, cross-brand is a **filter relaxation for the CEO**, not new isolation-breaking code.
- `GET /cos/cross-brand/overview` (guard `requireCeo`) → goals/health/overdue aggregated `WHERE business IN (ceo's brands)`. Presented in the CoS tab and the morning briefing ("FLH on track; PXG 2 weeks behind"). Explicitly documented as a CEO-scoped exception to brand-context middleware in `docs/ENTITY_ISOLATION.md`.

### Templates / playbooks (wow #9 hybrid)
- On goal creation from a plan, offer **"Save as playbook"** → `shared.goal_templates` (`structure` captures milestones/tasks as day-offsets).
- On a new similar goal, `cos.templates.js` matches by title/embedding similarity → CoS offers: *"Reuse your Accessories Launch playbook (6 milestones)?"* → instantiates the template as a batch plan with recomputed dates. `usage_count++`.
- Endpoints: `GET /cos/templates`, `POST /cos/templates` (save), `POST /cos/templates/:id/instantiate`.

### Tests
- RAG scoping (user A cannot retrieve user B's goal chunks); narrative shape.
- Focus-finder correctness (no double-book, respects work/quiet hours); overload threshold.
- Cross-brand aggregation returns both brands for CEO, denied for non-CEO.
- Template capture → instantiate round-trip with date recomputation.

### Definition of Done
- [ ] "How is Pixie doing?" returns progress %, remaining, risks, recommendation from memory.
- [ ] A voice note becomes a batch plan; meeting prep card renders for an event.
- [ ] "Find me 2 hours this week" books a real slot; cross-brand overview shows both companies.
- [ ] Saving and reusing a playbook works with correct future dates.

---

## PR 6 — Personality, settings, polish, docs, hardening

**Objective:** naming/personality, adaptive timing, celebrations, notification prefs, docs, tests,
accessibility — production-ready. **Only CoS is renamed; Praxis keeps its name.**

**Depends on:** PR1–PR5.

### Migrations
- `0003XX_shared_cos_settings.sql`: `cos_settings` (§1.9). Seed a default row lazily on first CoS use.
- Seed notification types for CoS in the notification-preferences catalogue (`cos_briefing`, `cos_followup`, `cos_celebration`) so the existing per-type/channel prefs UI covers them.

### Naming propagation (CoS-only)
One source of truth (`cos_settings.assistant_name`, default "Chief of Staff") read everywhere:
- **Tab label** in `WorkspacePage.tsx` (`TABS` label becomes dynamic for the CoS entry).
- **Chat persona/system prompt** (`cos.persona.js`) + greeting.
- **Notification sender/title + signature** (`cos-accountability`, briefings) → e.g. push title "Ada:", digests signed "— Ada".
- **Briefing headers** (morning/evening/weekly).
Praxis strings are untouched (`src/modules/praxis_ai/`, Praxis UI, nav "Praxis AI").

### Settings UI
- `apps/admin/src/pages/workspace/CosSettings.tsx` (or a section in the CoS tab / Settings): name, tone, avatar upload (reuse media/storage service), pronoun, work/quiet hours, brief times, celebrate-wins, adaptive-timing toggles. Endpoints `GET/PUT /cos/settings`.

### Adaptive timing (wow #8)
- Nightly (fold into `cos-accountability`): analyse `cos_nudges.engaged_at` vs `sent_at`; if `adaptive_timing` on, shift default nudge windows toward the hours the CEO actually engages (bounded to work hours). Store learned offset (or in `ai_learning`).

### Win celebrations (wow #8)
- On milestone/goal `done` (event subscriber), if `celebrate_wins`, send a celebratory notification ("🎉 3 of 6 — right on pace"), `cos_nudges type='celebration'`, respecting quiet hours.

### Polish & hardening
- Empty/onboarding states for all CoS surfaces; first-run "meet your Chief of Staff" intro.
- Help Center article (follow the `migrations/000266_shared_help_workspace.sql` pattern → add a CoS help doc).
- Rate-limit the CoS post endpoint; expiry sweep for stale `ai_pending_plans` (extend `ai-pending-expiry.js`).
- Accessibility (keyboard on plan card + action buttons, ARIA), mobile/PWA per canon, i18n-ready strings.
- Security review: confirm executor cannot be coerced beyond `surface='workspace'`; prompt-injection guard in CoS persona (untrusted note/goal text cannot expand the action set).

### Documentation (mandatory)
- `docs/AI_CHIEF_OF_STAFF.md` — architecture (companion to `docs/AI_PRAXIS.md`): persona model, scoped catalogue, batch-plan gate, failover, accountability loop, RAG memory, cross-brand exception.
- Update: `docs/SCHEMA.md` (new tables + link columns), `docs/RBAC.md` (`goals` module), `docs/API_CONVENTIONS.md` (if any new patterns), `docs/openapi.yaml` (all `/goals`, `/notes`, `/cos` endpoints), `docs/ENTITY_ISOLATION.md` (CEO cross-brand exception), `docs/CONFORMANCE_GAPS.md` (mark items delivered), `README` RBAC/module-governance section (+`goals`), and this file's status → Delivered.

### Tests
- Naming propagation (rename → tab/chat/notification all reflect it; Praxis unchanged).
- Settings CRUD + validation; quiet-hours + adaptive-timing behaviour; celebration trigger.
- Full E2E: brain-dump → plan → approve → follow-up → delay → re-plan → win → celebration.

### Definition of Done
- [ ] CEO renames CoS to "Ada"; the tab, chat, and every notification say "Ada"; Praxis still says "Praxis".
- [ ] Settings persist and drive scheduling/quiet hours; celebrations and adaptive timing work.
- [ ] All docs updated; `openapi.yaml` covers every new endpoint; help article live.
- [ ] Full lint/test/build green (backend + `apps/admin`); security review notes filed.

---

## Appendix A — Feature → PR traceability (no gaps)

| Feature / requirement | PR |
|---|---|
| `shared.goals` / `goal_milestones` / stakeholders / notes | 1 |
| Link tasks/events to goals; progress rollup | 1 |
| Goals/Notes REST + RBAC module `goals` | 1 |
| My Goals dashboard, Goal detail, Notes UI, tabs | 2 |
| Goal/Milestone pickers in task/event modals | 2 |
| CoS persona, scoped catalogue (`surface='workspace'`), conversation `kind` | 3 |
| Batch-plan approval (`ai_pending_plans`, cross-step `{{step:N.field}}`) | 3 |
| CoS chat tab + `BatchPlanCard` | 3 |
| Multi-vendor failover router (DeepSeek→Gemini→OpenAI) | 3 |
| Proactive risk radar + slippage → `goals.health` (wow 3) | 4 |
| Follow-up state machine + Done/In-Progress/Delayed buttons | 4 |
| Re-planning on delay (batch) | 4 |
| Morning/evening/weekly briefings (extend, not multiply) | 4 |
| Actionable notifications (in-app/push/email) | 4 |
| RAG memory + "how is X doing" (wow 7) | 5 |
| Meeting intelligence: voice→goal, prep, capture (wow 4) | 5 |
| Smart scheduling: focus time, batch reschedule, overload (wow 5) | 5 |
| Cross-brand command (wow 6) | 5 |
| Playbook templates (wow 9 hybrid) | 5 |
| Custom name/tone/avatar — CoS only (wow 8) | 6 |
| Adaptive nudge timing + win celebrations (wow 8) | 6 |
| Settings UI, notification prefs, help, docs, hardening | 6 |

## Appendix B — Guardrails checklist (every PR)
- [ ] CoS catalogue never contains a non-`workspace` action.
- [ ] Executor runs as the CEO over loopback HTTP; RBAC re-applies.
- [ ] Every write audited; every AI turn metered.
- [ ] Brand isolation preserved (except the documented CEO cross-brand read).
- [ ] `cos_chat` flag off (AI Control) → graceful stub; no vendor → graceful stub.
- [ ] Design canon 10-question gate passed for each screen.
- [ ] Praxis behaviour unchanged by every PR.

## Appendix C — Assumptions to confirm
1. **Notes** are personal to the CEO by default (owner = user); shared/business notes can come later. (Included because "better Notion" implies a real notes surface; say if Notes should be dropped from v1.)
2. **Contacts** are read/search + attach only inside CoS; contact creation stays in CRM/Praxis.
3. Goals are **shared-schema, business-tagged** (like tasks/calendar) — this is what makes cross-brand a clean filter for the CEO.
4. Migration numbers `0003XX` are placeholders; assign the next free sequence at implementation time.
5. v1 is CEO-only via `is_ceo` + a `requireCeo` guard; the `goals` permission module exists so it can open to execs later without a rework.
