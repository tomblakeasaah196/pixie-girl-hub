# PR3 — Background plan execution (BullMQ) + scoped service token

**Status:** brief for a parallel engineer. Runs alongside PR2 (streaming, idempotency,
turn traces, planner evals). Branch off latest `main`.

## Goal

Move Chief-of-Staff **plan execution** out of the synchronous confirm request into a
**BullMQ background job**, so a long plan (goal + dozens of milestones/tasks/events)
can't time out the HTTP request or the proxy — and so execution can later run
*without a live user request* (scheduled autonomy: "every Friday, draft and run next
week's plan").

## Why it's non-trivial: the auth model

The executor works by **loopback HTTP as the CEO** — every step re-enters the real
REST endpoint carrying the CEO's `Authorization: Bearer <jwt>` so RBAC/validation
re-apply (`src/modules/praxis_ai/praxis.executor.js`). Today that JWT comes from the
live confirm request. In a background job there is **no live request**, and you can't
reuse the CEO's access token because of `src/middleware/auth.js`:

1. The JWT is verified against `config.JWT_SECRET` (fine).
2. **It requires a `sid` claim keyed to a Redis idle-marker with a 45-minute TTL.** A
   job that runs after the CEO closes the tab fails with `SESSION_IDLE_TIMEOUT` even
   though the JWT is still valid. **This is the blocker.**
3. `payload.sub` → user loaded from `identity-cache`, must be `status='active'`.

So background execution needs a **service token** that passes auth *without* the
human-session idle check, while still resolving to the real CEO user so RBAC is
unchanged.

## Recommended design — a `cos_plan_exec` service token

Mint a short-lived JWT **at confirm time** (while the CEO's request is live and
authorized), hand it to the job, and teach `auth.js` to accept it on a bypass path.

- **Mint** (in `confirmPlan`, before enqueue), reusing the `jwt.sign` already in
  `src/shared/hr_payroll/auth.service.js`:
  ```js
  jwt.sign(
    { sub: user.user_id, typ: "cos_plan_exec", plan_id, brand },
    config.JWT_SECRET,
    { expiresIn: "2h" }          // ≥ max run time, ≤ plan expiry
  )
  ```
- **Accept** in `src/middleware/auth.js`: add an early branch — if
  `payload.typ === "cos_plan_exec"`, **skip the `sid`/idle check**, still load the
  user from `identity-cache` and build `req.user` exactly as normal (so
  `requirePermission` runs as the CEO). Everything else unchanged.
- **Contain the blast radius** (do all three):
  1. Tag `req.user.is_service = true` + the `plan_id`; add a guard so a
     `cos_plan_exec` token is **only** accepted on the workspace routes the CoS
     catalogue uses (goals / tasks / calendar / notes / contacts) — reject it
     everywhere else. A leaked token then can't touch sales/cash/HR.
  2. Short TTL (2h) + it dies with the plan.
  3. Never log the token; store it only on the job payload (Redis), not in Postgres.

*(Alternative — a DB-backed service principal + per-plan capability grant — is cleaner
long-term but heavier; the signed short-lived token reuses existing infra and is
enough for v1.)*

## Wiring (all infra already exists)

- **Enqueue** from `confirmPlan` (`src/modules/chief_of_staff/cos.plan-executor.js`)
  via `enqueue("cos-plan-exec", "execute", { plan_id, brand, service_token }, { attempts: 3 })`
  (`src/jobs/queue-producer.js`). Then set the plan to `executing` and **return
  immediately** — the frontend `BatchPlanCard` already renders `status==='executing'`
  as "Running your plan…".
- **New processor** `src/jobs/processors/cos-plan-exec-processor.js` → calls the
  *unchanged* `planExecutor.executePlan({ plan, auth_header: service_token, request_id })`.
  Register it in `src/jobs/worker.js`'s `handlers` map as `"cos-plan-exec"`.
- **Completion push:** `executePlan` already `events.emit("plan.executed", …)`; the
  realtime bridge (`src/realtime/emitter.js` `getBroadcaster()` is **process-agnostic /
  Redis-bridged**, so worker-emitted events reach the browser) should broadcast to the
  `user:{id}` room so the client re-fetches. Confirm/extend `src/realtime/cos-realtime.js`
  handles `plan.executed`.
- **Idempotency:** PR2 adds a per-step idempotency guard (deterministic
  `Idempotency-Key` header `cos:<plan_id>:<plan_step>` + a Redis reserve-then-store
  middleware, already on `main` once PR2 lands), so a BullMQ retry won't double-create.
  **Don't build your own** — keep `attempts` modest (≤3).

## The seam with PR2 (so we don't collide)

- **You own:** `confirmPlan` (enqueue instead of inline run), the service-token mint +
  `auth.js` accept branch, the new processor, `worker.js` registration, the realtime
  completion broadcast.
- **PR2 owns:** everything *inside* `executePlan`'s step loop, the chat-turn streaming,
  the AI-Control trace UI. PR2 will **not** touch `confirmPlan` or change `executePlan`'s
  signature.
- `executePlan({ plan, auth_header, request_id, repair, actionByKey })` stays the stable
  contract. Pass `repair: null` in the worker if you don't want self-repair there
  (already supported).

## Acceptance criteria

1. Approving a large plan returns `executing` in <500ms; steps run in the worker; the
   card flips to executed/partially_failed via realtime with no client polling.
2. A `cos_plan_exec` token works on workspace routes and is **rejected** on a
   non-workspace route (add a test).
3. An idle CEO session (no activity for 45m) does **not** break an in-flight execution.
4. Worker crash mid-plan → BullMQ retry resumes cleanly (executePlan already skips
   `executed` steps + re-seeds token results; idempotency covers the create window).
5. Unit-test the auth bypass branch; integration-test enqueue→execute→broadcast with a
   mocked queue.

## Files

- Modify: `src/middleware/auth.js`, `src/modules/chief_of_staff/cos.plan-executor.js`
  (`confirmPlan` only), `src/jobs/worker.js`, `src/realtime/cos-realtime.js`, a small
  token helper in `src/shared/hr_payroll/auth.service.js`.
- Add: `src/jobs/processors/cos-plan-exec-processor.js`, tests.
- Migration: none (token is ephemeral; job state lives in Redis).
