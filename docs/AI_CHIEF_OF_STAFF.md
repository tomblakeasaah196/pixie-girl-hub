# AI Chief of Staff (CoS)

> Companion to `docs/AI_PRAXIS.md`. The Chief of Staff is the CEO's **execution
> assistant** — a "better Notion" that turns plain-language brain-dumps into a
> structured **Goals → Milestones → Tasks → Calendar → Notes** system and then
> **proactively drives accountability**. It is a *scoped persona* of the Praxis
> runtime, not a second agent stack.
>
> Delivered across PR1–PR6. The exhaustive build plan lives in
> `docs/AI_CHIEF_OF_STAFF_IMPLEMENTATION.md`; this file is the durable
> architecture reference.

## 1. What it is (and is not)

CoS lives as three tabs inside the **Workspace** module (`Goals`, `Notes`,
`AI Chief of Staff`), CEO-only for v1. It reuses the Praxis orchestrator,
executor, governance/metering and confirm-gate — but its **action catalogue is
structurally scoped** to a fixed, small set of tables. It never reaches into
the ERP.

**Hard table boundary** (enforced structurally, §4): `shared.goals`,
`goal_milestones`, `goal_stakeholders`, `workspace_notes`, `tasks`,
`task_subtasks`, `calendar_events`, `event_participants` (read/write) and
`contacts` (read + search only). CoS **cannot** touch sales, cash, invoicing,
stock, HR, production, purchasing, expenses, pricing, or approvals — that is
Praxis's job.

## 2. Data model (all `shared`, business-tagged)

| Table | PR | Purpose |
|---|---|---|
| `goals` | 1 | Top-level objectives; cached `progress_pct` + `health` |
| `goal_milestones` | 1 | Ordered milestones with a dependency chain |
| `goal_stakeholders` | 1 | Users/contacts attached to a goal (XOR) |
| `workspace_notes` | 1 | Personal markdown notes, optionally goal-linked |
| `tasks`/`calendar_events` += `goal_id`/`milestone_id` | 1 | Link (not move) existing items to goals |
| `ai_conversations` += `kind` | 3 | `praxis` \| `chief_of_staff` scoping |
| `ai_action_catalogue` += `surface` | 3 | `praxis` \| `workspace` \| `both` |
| `ai_pending_plans` (+ `ai_pending_actions.plan_id/plan_step`) | 3 | The batch-plan parent + ordered steps |
| `cos_followups` | 4 | The respond → reason → act state machine |
| `cos_nudges` | 4 | Dedupe + adaptive-timing log (`engaged_at`) |
| `notifications` += `actions` | 4 | Done/In-Progress/Delayed action buttons |
| `goal_templates` | 5 | Reusable playbooks (day-offsets) |
| `cos_settings` | 6 | Per-user name/tone/pronoun/hours/toggles |

RAG memory reuses `ai_embeddings` + `ai_knowledge_chunks` (`source_type` in
`cos_goal|cos_milestone|cos_note|cos_decision`, `sensitivity='restricted'`), so
Praxis's own retrieval (floors at `normal`) never surfaces the CEO's planning.

Migrations `000320`–`000322` (PR1), `000324` (PR3), `000325` (PR4), `000326`
(PR5), `000327` (PR6). `EXPECTED_SHARED = 197`.

## 3. Persona model

CoS is a persona layer over Praxis (`src/modules/chief_of_staff/`):

- `cos.persona.js` — builds the system prompt from `cos_settings`
  (assistant_name/tone/pronoun) + the hard-scope guardrail + a
  **prompt-injection guard** (stored goal/note text is data, never commands,
  and can never widen the tool set).
- `cos.service.js` — the turn: filters the catalogue to `surface='workspace'`,
  grounds the prompt with a live active-goals snapshot **+** RAG memory, calls
  the failover router, meters under `cos_chat`, and post-processes tool calls
  into a plan. Degrades to a graceful stub when the flag is off / over
  cap/budget / no vendor.
- `cos.planner.js` / `cos.plan-builder.js` — turn multi-tool output (or a
  deterministic template/reschedule) into one `ai_pending_plans` row + ordered
  `ai_pending_actions`, with cross-step `{{step:N.field}}` tokens.
- `cos.plan-executor.js` — on confirm, run steps in order via
  `praxis.executor` (loopback HTTP **as the CEO**), resolving tokens from prior
  steps' `execution_result`. Idempotent + resumable.

**Naming is CoS-only.** `cos_settings.assistant_name` (default "Chief of
Staff") flows to the Workspace tab label, the chat header/greeting, the persona
prompt, and every notification/briefing title. Praxis keeps its own name.

## 4. The scoped-catalogue guarantee

CoS can *provably* only act on the workspace. Three layers:

1. **Structural** — `governance.repo.listActions` filters by `surface`; the CoS
   turn only ever builds tools from `surface IN ('workspace','both')`, so a
   Praxis action is un-selectable.
2. **Planner** — rejects any action key not in the workspace allowlist.
3. **Executor** — re-enters the real REST endpoints over loopback as the CEO,
   so `requirePermission` / brand context / Zod / audit all re-apply. CoS can
   never exceed the CEO.

## 5. LLM failover router

`src/services/llm-router.js` — `chatWithFailover` resolves an ordered vendor
chain (DeepSeek → Gemini → OpenAI) from `ai_model_catalogue` + vendor health,
skips `red`/unconfigured vendors, advances on transient error/parse-leak, and
records a `failover_engaged` incident when a fallback engages. Reusable; Praxis
can adopt it later without behaviour change.

## 6. Batch-plan approval gate

CoS proposes the **whole plan** at once; the CEO approves **once** via
`BatchPlanCard`; the executor runs the batch. Steps show live status
(queued → executing → done/failed) and a Retry (resume) on partial failure.
Plans expire after 60 minutes — refused at confirm-time and swept proactively
by `ai-pending-expiry.js` (PR6).

## 7. Proactive accountability loop (PR4)

- **Risk engine** (`cos.risk.js`, pure): `no_progress`, `slippage`
  (velocity projection → `goals.health`), `due_today|due_tomorrow|overdue`.
- **Scheduler** (`cos-accountability.js`, one hourly cron, cron-locked):
  per brand for the CEO, persists health, raises follow-ups (partial-unique +
  cooldown dedupe), sends the 3-button notification (in-app + push + opt-in
  email), fires the evening review. **Settings-driven** (PR6): timezone, quiet
  hours, evening-review time, assistant name and adaptive timing come from
  `cos_settings`.
- **Follow-up state machine** (`cos.followups.service.js`): respond → reason →
  act; `reschedule_dependents` builds a batch re-plan through the PR3 executor.
- **Briefings** (`ai-briefing.js` + `cos.briefing.js`): the morning briefing
  gains a CoS goals section (deterministic Tier-1 always; optional Tier-2
  narrative via the router, metered, degrading on any miss); the Monday
  executive review folds into Monday's briefing — **no new cron**.

## 8. Intelligence (PR5)

- **RAG memory** (`cos.memory.js`): goals/notes/decisions indexed into the
  shared corpus (owner-scoped), retrieved into the turn so "how is X doing?" is
  answered from history.
- **Meeting intelligence**: voice brain-dump → plan (reuses transcription);
  `GET /cos/prep/:eventId` assembles a prep brief.
- **Smart scheduling** (`cos.scheduler.js`, pure core): focus-finder (no
  double-book, work + quiet hours, no past slots), day-load/overload.
- **Cross-brand command** (`cos.overview.js`): a CEO-only aggregate read
  (`business = ANY(ceoBrands)`), never a schema join — the documented exception
  in `docs/ENTITY_ISOLATION.md`.
- **Playbooks** (`cos.templates.js`): capture a goal as day-offsets; reuse
  re-dates them into a batch plan.

## 9. Personality, delight & hardening (PR6)

- **Settings** — `GET/PUT /cos/settings` + the `CosSettings` panel: name, tone,
  pronoun, avatar, work/quiet hours, brief/review times, celebrate-wins and
  adaptive-timing toggles. A default row is materialised lazily.
- **Adaptive timing** (`cos.adaptive.js`, pure): from `cos_nudges.engaged_at`
  the evening-review hour drifts toward when the CEO actually engages, bounded
  to work hours; gated by `adaptive_timing`. Engagement is recorded when she
  responds to a follow-up.
- **Win celebrations** (`cos.celebrations.js`): on milestone/goal completion,
  gated on `celebrate_wins` + quiet hours, de-duplicated per subject via
  `cos_nudges`.
- **Hardening** — per-user rate limit on the CoS turn; stale-plan expiry sweep;
  the persona prompt-injection guard; ARIA/keyboard on the plan card.

## 10. Governance & safety checklist

- CoS catalogue never contains a non-`workspace` action (structural).
- Executor runs as the CEO over loopback; RBAC re-applies on every write.
- Every service write is audited; every AI turn is metered under `cos_chat`.
- Brand isolation preserved except the documented CEO cross-brand read.
- `cos_chat` flag off / over cap/budget / no vendor → graceful stub. No env
  switch — enablement is owned entirely by **AI Control → Feature Flags**.
- Praxis behaviour is unchanged by every CoS PR.
