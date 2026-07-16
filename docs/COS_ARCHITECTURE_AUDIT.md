# Chief of Staff — Architecture Audit & Improvement Plan

**Date:** 2026-07-16 · **Scope:** `src/modules/chief_of_staff/`, `src/modules/praxis_ai/praxis.executor.js`,
`src/services/llm-router.js`, workspace endpoints (`src/shared/{tasks,goals,calendar}/`), catalogue migrations
(000324 / 000333 / 000334 / 000335), admin frontend (`apps/admin/src/pages/workspace/ChiefOfStaffTab.tsx`,
`BatchPlanCard.tsx`).

This audit answers four questions — *is it agentic? should it have been Python? why do task writes keep
failing? how do we make it a masterpiece?* — and ends with a prioritised fix plan.

---

## 1. What the CoS actually is (agentic vs "single AI")

The Chief of Staff **is an agent**, not a single-shot chat model. One turn today runs a genuine agentic loop:

```
CEO message
  → persona prompt + live goals snapshot + RAG memory        (cos.service.js runTurn)
  → bounded multi-round tool loop (≤10 rounds/turn)          (cos.plan-rounds.js)
       READ tools  (list_goals, search_contacts, …) execute IMMEDIATELY
                    over loopback HTTP as the CEO — real data feeds back into the loop
       WRITE tools accumulate into a batch plan (≤60 steps)
  → plan persisted (ai_pending_plans + ordered ai_pending_actions)
  → CEO approves ONCE
  → executor runs steps in order, resolving {{step:N.field}} tokens  (cos.plan-executor.js)
       each step re-enters the real REST endpoint with the CEO's JWT —
       auth / brand / RBAC / Zod / audit all re-apply
```

Plus, outside the turn: a **proactive accountability loop** (cron risk engine → follow-up state machine →
actionable notifications, `cos.scheduler.js` / `cos.followups.service.js`), **RAG memory** over
goals/notes/decisions, **playbook templates**, **smart scheduling**, and **multi-vendor failover**
(DeepSeek → Gemini → OpenAI, `llm-router.js`).

It is a **single agent** (one persona, one loop) — not a multi-agent system. Praxis and the CoS are two
personas sharing one runtime, separated by conversation `kind` and catalogue `surface`. That is the right
shape for this product; multi-agent decomposition would add coordination failure modes without adding
capability at this catalogue size (27 tools).

**What is genuinely well-built** (worth saying before the flaws):

- **Permission-inheriting loopback execution** — the agent structurally cannot exceed the CEO because every
  write re-enters the real endpoint with the CEO's own token. Most home-grown agents get this wrong.
- The **batch-plan approval gate** — the same "ask before writing" pattern that impressed you in Hostinger's
  panel. We already have it; it's the last-mile reliability that's missing.
- The **anti-truncation plan-rounds loop** with broken-promise detection and narrated-kind checking.
- **Governance**: feature flag, per-user caps, budget ledger, metered usage, vendor health + failover incidents.
- The **prompt-injection guard** in the persona and owner-scoped `restricted` memory.
- Graceful degradation to stubs when the flag is off / no vendor is configured.

The foundation is sound. The failures you're seeing are concentrated in a thin layer: **identity resolution,
payload validation timing, error recovery, and error presentation.**

---

## 2. Would Python have been better? (honest answer: no)

The CoS calls **hosted LLM APIs over HTTP**. There is no model inference, no tensor math, no training in this
codebase — the parts where Python has an edge simply don't run here. What this system actually does is
orchestration: HTTP, SQL, queues, websockets, JSON — Node is at least as good at all of these, and arguably
better at the realtime side (Socket.io is already load-bearing platform-wide).

Hostinger's panel assistant felt magical not because of its implementation language (which is not knowable
from the outside, and is very likely also just an API-orchestration layer) but because of four product
properties:

1. **Broad tool surface** — it could touch almost everything in the panel.
2. **Explicit consent steps** — "may I read? may I write?" (we have this: the plan approval gate).
3. **Self-correction** — when a step failed it retried differently instead of stopping.
4. **Reliability of the last mile** — validated inputs before acting, so actions rarely errored.

Points 3 and 4 are exactly where our CoS is weak (see §3), and neither requires Python. A rewrite would cost
months, lose the battle-tested RBAC/audit/loopback machinery, and land us in the same place. **Verdict: keep
Node, invest in the agent loop's last mile.**

---

## 3. Why task writes keep failing — root causes (ranked)

Goals and milestones create fine because their payloads are trivial (title + `YYYY-MM-DD` dates — no UUIDs,
no datetimes, no cross-references). Tasks and events carry exactly the fields the pipeline fumbles. Confirmed
causes, in order of likely blame:

### 3.1 The `assigned_to` identity gap (HIGH — almost certainly your headline bug)

`shared.tasks.assigned_to` is a **foreign key to `shared.users`** (migration 000005:80), and the validator
requires a UUID (`tasks.validator.js:32`). But the model has **no tool that returns a `user_id`**:

- The only people-lookup tool is `workspace.search_contacts` → returns **`contact_id`s** — a different table.
  A contact UUID passes Zod, then the INSERT dies on the FK → step fails with a raw 500.
- "Assign it to me" — the persona never tells the model the CEO's own `user_id`, so it guesses or emits a
  name → Zod 400 "Invalid uuid".
- Migration 000333's header even documents this ("assigned_to needs a user_id the model could never
  discover") — the fix added `search_contacts`, which returns the *wrong kind of id* for assignment.

Everything downstream of the failed step then never runs (§3.4), so it reads as "tasks never write".

### 3.2 Contact-linked / personal tasks are structurally impossible (HIGH — your exact question)

You asked *"if the task is linked to a contact or is a personal task — how does it identify that?"*
**Today it can't.** The endpoint supports it — `taskCreate` accepts `is_personal`, `reference_type`,
`reference_id` (`tasks.validator.js:35-37`) — but the catalogue schema for `workspace.create_task`
(migration 000335:28-40) exposes **none of those fields**, and the persona says nothing about the
distinction. So:

- Every CoS task lands as a default business task (`is_personal=false`, no contact reference).
- When the model *does* try to link a contact it invents a field the schema doesn't allow (`contact_id`) —
  and because all task validators are `.strict()`, the write is rejected with
  `Unrecognized key(s) in object` — **an error caused purely by the catalogue/validator mismatch**.

Same class of problem: `create_event` in the catalogue has no `participants[]`, though the calendar
validator accepts participants with `contact_id` — so the CoS can find a contact but can never invite them
to the meeting it's booking.

### 3.3 Strict validators reject the model's natural output (MEDIUM-HIGH)

`.strict()` on `taskCreate`/`taskUpdate` means any extra key 400s the whole write. LLMs routinely inline
`goal_id` on a task right after creating a goal (the catalogue tells them to use a separate `link_task`
step, but models take the shortcut constantly). One stray key → the entire step fails → plan
`partially_failed`. Strictness is correct for humans/API clients; for the agent path we must **pre-validate
and strip/repair** before execution (§5, fix #2).

### 3.4 Fail-stop execution amplifies every failure (HIGH impact multiplier)

`executePlan` (`cos.plan-executor.js:83-154`) **breaks on the first failed step**, even when later steps are
completely independent. One bad `assigned_to` on task 3 of 12 kills tasks 4–12 and every event and note after
it. This single design choice converts "one field was wrong" into "nothing was created", which is exactly
the experience you described. Only steps whose tokens reference the failed step actually need to be skipped.

### 3.5 Result truncation silently breaks cross-step tokens (MEDIUM)

`praxis.executor.js` trims every `execution_result` to 4 000 chars; over the limit it stores
`{_truncated: true, preview: "…"}` — **destroying the very fields (`task_id`, `goal_id`) that later
`{{step:N.field}}` tokens must resolve from**. A task or note with a long description busts the limit, and
the following `link_task` fails with "Unresolved cross-step reference". Reads suffer too: a default
`list_tasks` page (50 rows) is far beyond 4 000 chars, so the model is often fed a JSON fragment cut
mid-record.

### 3.6 Stateful regex bug in token detection (LOW frequency, real — reproduced)

`TOKEN_RE` is a module-level `/g` regex used with `.test()` (`cos.planner.js:20,74`). Global regexes carry
`lastIndex` between calls, so detection alternates: after one positive match, the next payload's token can be
**missed** (reproduced: second `.test()` returns `false` on a string that plainly contains a token). A missed
detection sends a literal `{{step:0.goal_id}}` to the endpoint as an id → confusing 400/404. Fix: use
`.match()` or construct the regex per call.

### 3.7 Errors are shown raw (UX — makes everything feel broken)

`execution_error` stores `JSON.stringify(exec.result)` — the endpoint's raw error envelope — and
`BatchPlanCard.tsx:144-146` renders it verbatim. The CEO sees
`{"error":{"code":"VALIDATION_ERROR","message":"Unrecognized key(s)…"}}` instead of
*"This task names a person I couldn't match to a staff account — edit the step and retry."* Even recoverable
failures read as system breakage.

### 3.8 Plans expire in 60 minutes (LOW)

`ai_pending_plans.expires_at` defaults to `now() + 60 min` (000324:52). A plan reviewed after lunch or the
next morning throws `EXPIRED — ask me to re-plan`. For a CEO workflow this is far too aggressive; nothing
about a proposed goal/task plan goes stale in an hour.

### 3.9 Deployment caveat worth ruling out on the VPS

Migrations run as a one-shot pre-deploy job. 000333–000335 fixed earlier waves of exactly these symptoms
(datetime shapes, reminders, read tools). If production hasn't applied them, the catalogue is still steering
the model into the old failure modes. Verify with:
`SELECT action_key, updated_at FROM shared.ai_action_catalogue WHERE surface='workspace' ORDER BY action_key;`
(expect 27 rows, task/event rows updated by 000335).

---

## 4. Smaller findings

| # | Finding | Where | Severity |
|---|---------|-------|----------|
| 4.1 | Plan execution runs **inline in the confirm HTTP request** — a 20-step plan = 20 sequential loopback calls inside one request; slow plans risk client/proxy timeouts. Realtime events already exist to stream progress, so moving execution to BullMQ is natural — but needs a service-token story (executor currently requires the CEO's live JWT). | `cos.plan-executor.js` | Medium |
| 4.2 | The same JWT coupling means the **accountability cron cannot execute anything** — all autonomy is limited to notifying; every actual write needs the CEO online. Fine for v1 ("act as the CEO"), but it caps how proactive the CoS can ever be. | `cos.scheduler.js`, followups | Design note |
| 4.3 | No idempotency keys on steps — a network blip mid-`create_task` + "Retry remaining" can double-create (executor re-runs any non-`executed` step). | executor | Medium |
| 4.4 | History budget math: 60 msgs × 8 000 chars ≈ 120k tokens *before* system prompt + tools — over DeepSeek's context on long threads. Needs token-based (not char-based) budgeting. | `cos.service.js:46` | Low |
| 4.5 | `min_confidence` is stored per step and never used by the plan path — dead weight or missed guardrail. | planner | Low |
| 4.6 | No per-turn trace (rounds, vendor, latency, tool calls) queryable in AI Control — debugging a bad turn today means reading Pino logs. | observability | Medium |
| 4.7 | No planner regression suite: catalogue/persona changes ship with no eval that "utterance X still yields steps shaped Y". The unit tests (144, all passing) cover mechanics, not planning quality. | tests | Medium |
| 4.8 | No response streaming — a 10-round turn can take a minute+ with only a spinner. | ChiefOfStaffTab | UX |

---

## 5. The fix plan (prioritised)

### Phase 0 — make writes reliable (the "tasks never save" killers)

1. **Close the identity gap.**
   - New read action `workspace.search_users` (name/role → `user_id`, `display_name`, `role`) mirroring the
     staff endpoint, so "assign to my BDM" resolves to a real user id.
   - Inject the CEO's own `user_id` (and optionally a compact team roster — it's a small org) into the
     persona context so "assign to me" needs no lookup.
   - Persona rule: *"`assigned_to` must be a `user_id` from search_users. Contacts are not assignable — for a
     task about a contact, set `reference_type='contact'` + `reference_id` and leave it unassigned or
     assigned to a staff member."*
2. **Pre-flight validation at plan-build time.** When `planner.buildSteps` persists steps, run each payload
   through the endpoint's Zod schema (export the schemas from validators; skip fields holding
   `{{step:N…}}` tokens). Invalid steps surface **on the plan card before approval** with a plain-language
   note and the ✎ editor — errors move from run time to review time. Also strip unknown keys for
   agent-originated payloads instead of hard-failing (log what was stripped).
3. **Expose the missing task/event fields in the catalogue** (`is_personal`, `reference_type`,
   `reference_id` on create/update task; `participants[]` on create/update event) + persona guidance on
   personal vs business vs contact-linked. This directly answers "how does it identify that".
4. **Dependency-aware execution instead of fail-stop.** Build a step-dependency map from the tokens; on
   failure, skip only dependents, run everything independent, and report per-step outcomes.
5. **One bounded self-repair round.** On a step failure that looks like a validation error, feed the error +
   payload back to the model for a single corrected payload (write goes through the same Zod gate), then
   continue. This is the Hostinger-feel feature: the agent fixes itself instead of parking the plan.
6. **Stop truncation from eating ids.** Extract id fields (`*_id`) into a compact `extracted` map before
   trimming, and resolve tokens against it; give reads a larger/structured budget with explicit
   "N of M shown" metadata instead of a sliced JSON string.
7. **Fix the `/g` regex state leak** in `hasUnresolvedTokens` (use `.match()` / fresh regex).
8. **Humanise `execution_error`** (map Zod issues, FK violations, 404s to sentences + a suggested fix) and
   extend plan expiry to 24 h (or re-validate on confirm instead of expiring).

### Phase 1 — the feedback loop you asked for (like / dislike / comment)

Praxis already has the whole mechanism: `POST /praxis/messages/:id/feedback` with 👍/👎 + a correction that
becomes an embedded knowledge chunk (`learning.service.js`). Reuse it:

- **Backend**: `POST /api/v1/cos/messages/:id/feedback` `{rating: 'up'|'down', comment?}` → store on
  `ai_messages`; a 👎-with-comment becomes a **CoS memory chunk** (owner-scoped, `sensitivity='restricted'`,
  `source_type='correction'`) so the very next turn retrieves it. Audit each event.
- **Prompt**: inject a small "RECENT CORRECTIONS FROM THE CEO" block (top-K by recency) into the persona —
  behavioural feedback ("stop suggesting 8am events") must reach the prompt, not just RAG.
- **Frontend** (`ChiefOfStaffTab.tsx`): 👍/👎 under each assistant message; 👎 opens a small inline
  popover/toast with a comment box (exactly the interaction you described), optimistic update, toast confirm.
- **AI Control**: a feedback report (ratio per day/model/vendor) so you can see whether the CoS is improving.

### Phase 2 — capability & feel

- **Streaming turns** (Socket.io is already there; `cos-realtime.js` exists): stream narration tokens and
  step cards as rounds complete, replacing the long spinner.
- **Plan execution as a BullMQ job** with per-step progress events (needs a scoped service-token pattern —
  short-lived, CEO-bound, workspace-only — which then *also* unlocks scheduled autonomy like "every Friday,
  draft next week's plan for my approval").
- **Idempotency keys** per step; safe retries.
- **Turn traces** (round count, vendor, model, latency, tool calls, failure class) in AI Control.
- **Planner eval suite in CI**: golden utterances → expected step shapes; run on every catalogue/persona
  change so regressions are caught before the CEO finds them.

---

## 6. Bottom line

- **Agentic?** Yes — a single, well-scoped agent with tool use, an execution engine, memory, and a proactive
  loop. Not multi-agent, and it doesn't need to be.
- **Python?** No. The architecture is provider-orchestration; the language is not the bottleneck. The gap to
  a Hostinger-grade feel is identity resolution, pre-flight validation, self-repair, dependency-aware
  execution, streaming, and friendly errors — all incremental work on what exists.
- **Why tasks don't save:** chiefly §3.1 (no way to get a `user_id`), §3.2 (contact/personal fields missing
  from the catalogue), §3.3 (strict Zod vs LLM output), amplified by §3.4 (fail-stop) and presented terribly
  by §3.7 (raw JSON errors).
- **Masterpiece path:** Phase 0 (≈1 PR-sized wave) removes the daily pain; Phase 1 adds the training loop;
  Phase 2 makes it feel alive. Nothing here requires a rewrite.
