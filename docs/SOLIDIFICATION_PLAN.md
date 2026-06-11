# Pixie Girl Hub — Solidification Plan

**Purpose.** Harden pixie-girl to the robustness level of the reference `hub-system`
implementation **without copying its architecture**. Pixie keeps its own PD/schema/UI
requirements, its event-driven design, schema-per-brand registry, and `decimal.js`
money discipline. This plan only adopts the _engineering lessons_ — atomicity,
idempotency, durable delivery, clean resource lifecycle, signature verification.

**Method.** File-by-file comparison of `hub-system` against pixie's equivalents.
Findings are grouped by the four priority dimensions (in the agreed order) and tagged
with severity, evidence, the hub reference, and a **pixie-respecting** fix.

**Status:** awaiting approval. No code changed yet.

**Standing rules honoured during execution:** static validation only (no `node`/syntax
runs — the linter handles that); strict equality `===`/`!==`; validate against schema +
PD + admin_ui; everything connects end-to-end. The WSL bash mount is stale for
freshly-written files — verify with Read/Grep, not bash.

---

## Severity legend

| Sev         | Meaning                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| 🔴 Critical | Can cause silent financial inconsistency, data loss, or accept unverified external input. Fix first. |
| 🟠 High     | Real correctness/robustness hole under failure or concurrency.                                       |
| 🟡 Medium   | Latent risk / missing choke point; fix opportunistically.                                            |
| ⚪ Forward  | Not yet built; capture the lesson so it's built right the first time.                                |

---

## Dimension A — Transaction integrity

The core divergence from hub-system: hub does cross-module work with the **same client
inside one transaction** (atomic). Pixie uses a per-module in-process `EventEmitter`.
That decoupling is fine — but today it is **not durable and not atomic**, and events
fire **before commit**. These three findings are the heart of the hardening effort.

### A-1 🔴 Domain events are emitted _inside_ the DB transaction (pre-commit)

- **Evidence:** `src/modules/sales/sales.service.js` — `events.emit("order.paid", …)`
  fires at the end of `markPaid` (≈L497) while still inside the `transaction()` opened by
  `addPayment` (≈L322); same pattern for `order.created` (L271), `order.deposit_met`
  (L409), `order.payment` (L427), `order.cancelled` (L553), and across other modules.
- **Why it's wrong:** if any statement _after_ the emit throws, the transaction rolls
  back — but subscribers have already started acting on an event for a row that never
  committed → **phantom invoice / journal / commission** for a non-existent sale.
- **Hub reference:** no event bus; the consumer code runs on the same client and commits
  atomically, so a rollback un-does everything.
- **Fix (pixie-respecting):** never emit mid-transaction. Buffer events during the tx and
  flush them **after COMMIT**. Implemented cleanly via the outbox in A-2 (the buffer _is_
  the outbox rows, written with the same client and dispatched post-commit).

### A-2 🔴 Subscribers run on a separate connection — non-atomic, racy, best-effort, no retry

- **Evidence:** `src/modules/accounting/accounting.subscribers.js` L45-119. The
  `order.paid` handler calls `salesRepo.findById({ brand, id: order_id })` **with no
  client**; `sales.repo.js` L17 `const ex = (c) => (c ? c.query.bind(c) : query)` means a
  clientless call uses the pool — a _different_ connection from the still-open sales
  transaction. Under READ COMMITTED it **cannot see the uncommitted order** → `if (!order)
return;` (L49) → the GL journal **silently never posts**. The handler's own comment
  admits it is best-effort and "can be re-posted" — but there is **no re-post path**, only
  a `logger.error`.
- **Blast radius:** the same shape exists for every cross-module consumer (invoicing raise
  on `order.paid`, hr_payroll commission accrual, logistics dispatch→delivery,
  retention/loyalty). An order can be marked **paid with no journal and no invoice**, and
  nothing surfaces it.
- **Hub reference:** direct in-transaction calls = guaranteed; plus `webhook_log`-style
  durability for external triggers.
- **Fix (pixie-respecting): transactional outbox + post-commit dispatch.**
  1. New table `shared.event_outbox` (one new migration — see "Schema impact").
  2. Replace `events.emit(...)` inside services with `outbox.enqueue(client, {type,
payload})` — written with the **same client**, so the event commits atomically with
     the business row (solves A-1 and A-2 together).
  3. A BullMQ worker (`event-dispatch`, alongside the existing queues in
     `src/jobs/worker.js`) polls committed outbox rows and invokes the existing
     module handlers with **at-least-once** delivery, marking rows done/failed with retry
     - backoff. Handlers receive the **committed payload** so they never read uncommitted
       state.
  4. Keep the in-process `EventEmitter` only for _soft_ realtime fan-out (socket
     pushes) where loss is acceptable; route every **stateful/financial** consumer through
     the outbox.
- **Bonus:** this also fixes B-3 (in-process events don't cross the web↔worker process
  boundary) for free, because dispatch is queue-based.

### A-3 🟠 Event consumers are not idempotent

- **Evidence:** `accounting.postEntry` (`accounting.service.js` L48) inserts
  `journal_entries` with `source_type/source_table/source_id` but there is **no UNIQUE**
  on `(source_type, source_id)` for `journal_entries` in the shared migrations (the
  partial-unique-on-source pattern _does_ exist for `payslip_lines` and `cost_components`
  — so it's already idiomatic to pixie, just not applied here). Re-delivery → duplicate
  journal.
- **Why it matters:** at-least-once outbox delivery (A-2) _requires_ idempotent consumers,
  and today a double `addPayment`/retry already risks a double post.
- **Fix:** add a partial UNIQUE index `journal_entries (source_type, source_id) WHERE
source_id IS NOT NULL` and switch posters to `INSERT … ON CONFLICT DO NOTHING` (or
  pre-check). Apply the same natural-key guard to invoice-raise and commission-accrual
  consumers. Reuses the existing pixie pattern — not a hub import.

### A-4 🟡 `transaction()` doesn't set session GUCs — RLS/audit context is opt-in

- **Evidence:** `config/database.js` — `transaction(fn)` (L97) only does BEGIN/COMMIT;
  `setSessionContext` (L125, sets `app.current_business` + `app.current_user_id`) is a
  _separate_ call services must remember. Most services call `transaction()` directly, so
  the GUCs are usually unset.
- **Why it matters:** when RLS is enabled (PD §3 anticipates it) and for any DB-side audit
  default keyed on `current_user_id`, the context is silently null.
- **Fix:** add `brandTransaction(brand, userId, fn)` that BEGINs, sets both GUCs, then runs
  `fn(client)`; migrate write paths onto it. Pixie already qualifies tables via
  `t(brand, table)`, so this is purely RLS/audit-context correctness, not routing.

---

## Dimension B — Idempotency & retries

### B-1 🔴 Inbound webhooks are unimplemented stubs

- **Evidence:** `src/modules/business_setup/webhooks.routes.js` — every receiver
  (`/paystack`, `/opay`, `/stripe`, `/nomba`, `/meta/*`, `/chowdeck`, `/gigl`) is literally
  `(_req, res) => res.status(200).send()`. No signature check, no persistence, no
  enqueue, no processing. `paystack.service.js` has `verifyTransaction()` but **nothing
  calls it**. Inbound payment/logistics/Meta callbacks are silently dropped.
- **Good news:** the schema is ready — `shared.webhook_log` already exists (migration
  `000002`, L240) with `(source, processed, received_at)` indexes. So this is **pure
  app-layer**, no schema change (one small dedup-uniqueness add at most).
- **Hub reference:** `integrations/paystack/paystack.webhook.js` — raw-body sha512 HMAC
  verify → `webhook_log` insert with idempotency check → respond 200 immediately →
  process async → mark `processed`/`error`; `replayFailedWebhooks` cron retries.
- **Fix:** implement the receiver pipeline per source:
  1. Verify signature on the **raw** body (Paystack `x-paystack-signature` HMAC-SHA512;
     Opay/Nomba per their scheme; Meta `X-Hub-Signature-256`).
  2. Persist to `shared.webhook_log` keyed for dedup on `(source, external_id)`; if already
     processed, return 200 without re-processing.
  3. Enqueue the existing `webhooks-replay` queue and return 200 fast.
  4. `webhooks-replay-processor` dispatches by event type → e.g. `charge.success` confirms
     the matching order/invoice payment and enqueues `order.paid` **through the outbox**
     (A-2), so the financial follow-through is atomic + durable.

### B-2 🟠 Cron sweeps have no row-level locking (double-run / double-send)

- **Evidence:** `grep "FOR UPDATE|SKIP LOCKED" src/jobs/schedulers` → **0 matches** across
  all sweeps (email-campaign-send, layaway-abandonment, layaway-reminders, campaign-state-
  transition, low-stock, ai-pending-expiry, etc.). With `email-campaign-send` running every
  minute and workers at concurrency 4 (and potentially a separate worker dyno), overlapping
  runs can double-send.
- **Hub reference:** hub explicitly _removed_ a non-locking campaign sender for exactly
  this double-send risk and replaced it with a locking sweep.
- **Fix:** each sweep claims due rows with `SELECT … FOR UPDATE SKIP LOCKED` and flips
  state in the **same transaction**, so concurrent runs partition the work. (Confirm each
  scheduler individually during execution.)

### B-4 🟠 Stock oversell under concurrency (no app-level lock)

- **Evidence:** `stock.repo.js` — `stock_levels.on_hand` is maintained by the
  `fn_apply_stock_movement` **trigger** from signed `stock_movements`; the header says
  "never write `on_hand` directly." The signal scan found **0 `FOR UPDATE`** in pixie. So a
  `-sale` movement is just an INSERT; two concurrent sales of the last unit can both insert
  and the trigger applies both → `on_hand` goes negative (oversell) unless the trigger or a
  CHECK blocks it.
- **Hub reference:** hub deducts inside the order transaction and (in its sweeps) uses
  `FOR UPDATE`.
- **Fix:** confirm `fn_apply_stock_movement` rejects any movement that would drive
  `on_hand < 0` (raise) — or add a `CHECK (on_hand >= 0)` / `SELECT … FOR UPDATE` on the
  level row before inserting the movement. Mostly verification + a guard if missing.

### B-5 🟠 Smartcomm outbound bypasses the durable send queues

- **Evidence:** `smartcomm.service.sendToCustomer` calls `whatsapp.sendText`/`email.send`
  **inline** then inserts the message; `worker.js` already runs `whatsapp-send` +
  `email-send` BullMQ queues that it never uses. No retry on provider failure, no dedup on
  double-call. `findOrCreateCustomerThread` is a racy check-then-insert (duplicate threads).
- **Fix:** enqueue outbound to the existing queues (retry/backoff/rate-limit); record the
  message on enqueue and stamp `external_ref` on completion; add a unique key +
  `ON CONFLICT` to the customer-thread find-or-create.

### B-6 🟠 Public order-form has no idempotency key

- **Evidence:** `storefront/order-form.routes.js` → `submitOrderForm` is transactional
  (good) but accepts no client idempotency key, so a double-submit creates duplicate
  orders. Pixie already has `client_idempotency_key` on POS + sales payments — the public
  checkout should adopt the same pattern. Contact upsert is also racy (no unique/ON CONFLICT).
- **Fix:** accept + enforce a client idempotency key on `/public/order-form`; unique
  constraint + `ON CONFLICT` on the contact upsert.

### B-3 🟡 In-process EventEmitter doesn't cross processes

- **Evidence:** subscribers self-register via side-effect `require()` in route files
  (e.g. `accounting.subscribers` `register()` at file end). They exist only in a process
  that mounted routes; the worker dyno (`ENABLE_WORKERS` standalone) and any second web
  instance won't have them, so events emitted there are lost.
- **Fix:** subsumed by A-2 — queue-based dispatch is process-independent. No separate work.

---

## Dimension C — Resource lifecycle

### C-1 🟠 Graceful shutdown tears resources down before HTTP drains; wrong exit codes; no failsafe

- **Evidence:** `src/server.js` `shutdown()` L76-89 — `server.close(() => …)` is **not
  awaited**; the function proceeds straight to `stopWorkers/closeSocketIo/closeRedis/
closeDatabase` and `process.exit(0)` while requests may still be in flight on the pool.
  `uncaughtException`/`unhandledRejection` (L95-102) call `shutdown` then exit **0**
  (masks the crash). No re-entrancy guard (double signal re-enters) and no force-exit
  timeout (a hung keep-alive socket could wedge shutdown).
- **Hub reference:** `server.js` closes DB/Redis **inside** the `server.close` callback
  (after drain) with a `setTimeout(…, 10_000)` force-exit failsafe.
- **Fix:** promisify + await `server.close()` first, then close workers→socket→redis→db;
  `exit(1)` on crash paths; add an `isShuttingDown` guard; add a force-exit timer.
- **Note (positive):** pixie's DB pool, Redis (separate main/pub/sub), and Socket.io are
  clean single-owners — _better_ than hub-system, whose `config/sockets.js` double-instantiates
  `io` and loses all handlers. No change needed there.

### C-2 ⚪ No PDF/headless-browser engine yet (G-7 deferred)

- **Evidence:** only reference to PDF in `src` is a comment in
  `sales_campaigns/campaigns.notifications.service.js`; no puppeteer/renderer exists.
- **Lesson to bank from hub-system:** hub has _three_ competing browser lifecycles, one of
  which (`reports.service.renderPDF`) **cold-launches Chromium per call**, and its shared
  `renderToPDF` does **no HTML escaping** of interpolated tokens. When G-7 (delivery
  letter / invoice / receipt PDFs) is built, use **one** shared headless-browser owner
  (singleton with reconnect + `closeBrowser` wired into shutdown) and **escape every
  interpolated field** at the template boundary.

---

## Dimension D — Security & correctness

### D-1 🔴 No webhook signature verification

Cross-listed with **B-1**. Until the receiver verifies HMAC on the raw body, any
unauthenticated caller's payload would be trusted once processing is added. Verification
must land _with_ the receiver implementation, never after.

### D-2 ✅ Error handler — verified solid (no change)

- **Verified:** `src/middleware/error-handler.js` maps `AppError`, `ZodError`, and PG
  `23505`/`23503`/`23514` to clean client codes, always returns `{error:{code,message},
request_id}`, and the fallthrough returns a generic `INTERNAL_ERROR` while logging the
  full error server-side. Never leaks SQL/stack. **Ahead of hub-system — no work needed.**

### D-5 🟡 Public write endpoints lack per-route rate limiting

- **Evidence:** rate-limit references exist only in `middleware/index.js` (global) and
  `sales_campaigns/campaigns.public.routes.js`. Other unauthenticated **write** routes —
  storefront order-form checkout, contacts register, e-sign public submit, email/logistics
  tracking — rely on the global limiter only.
- **Hub reference:** dedicated `registrationRateLimiter` (30/hr/IP) on public walk-in POST.
- **Fix:** add a stricter per-endpoint limiter to public writes (checkout, register,
  e-sign), keyed by IP (and where possible by target id), to blunt enumeration/abuse.

### D-3 🟡 Money-discipline sweep

- **Evidence so far:** `utils/money.js` is solid (`decimal.js`, `ROUND_HALF_UP`,
  `toCurrencyString` for SQL) and `accounting.subscribers` uses it correctly — already
  ahead of hub-system, which does float math with a 0.01 tolerance.
- **Action:** a verification sweep to confirm **no** service does raw `Number` arithmetic
  on amounts (the hub anti-pattern) — especially totals/VAT/discount in sales, pos,
  invoicing, pricing, payroll. Mostly confirmation; fix any stragglers to `money()`.

---

## Schema impact summary

| Change                                                                     | Type                                              | Needed by     |
| -------------------------------------------------------------------------- | ------------------------------------------------- | ------------- |
| `shared.event_outbox` table (+ status/attempts/indexes)                    | **new migration**                                 | A-1, A-2, B-3 |
| Partial UNIQUE `journal_entries (source_type, source_id)` (+ peers)        | **new migration** (reuses existing pixie pattern) | A-3           |
| Dedup uniqueness on `shared.webhook_log (source, external_id)`             | small migration (verify column first)             | B-1           |
| `brandTransaction()` helper                                                | code only                                         | A-4           |
| Everything else (webhook receivers, dispatcher, shutdown, scheduler locks) | **code only**                                     | B-1, B-2, C-1 |

Only the outbox is a genuinely new domain-infra table; the rest reuse patterns pixie
already has. Memory records the schema as V2.2-conformant with app-layer wiring lag — this
plan stays consistent with that.

---

## Feature gaps (beyond the 4 robustness dimensions)

Surfaced by the deep dive; hub has them, pixie doesn't. Not hardening — these are new
builds, so they're listed separately and only built if you want them.

| ID  | Gap                                                                                                                                                                                                          | hub reference                               | Effort                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ----------------------------------------------- |
| F-1 | **Staff invite / onboarding flow** — hashed single-use token, 1h expiry, `FOR UPDATE` on accept, role grant, staff-profile link, audit. Pixie currently has no invite at all.                                | `shared/auth/invite.service.js`             | Medium                                          |
| F-2 | **Walk-in customer self-registration** — rate-limited public `POST /contacts/register/:brand` + staff QR; upsert-by-phone + welcome message + staff notify. Pixie only captures contacts via the order-form. | `shared/contacts/contacts.public.routes.js` | Small (reuses order-form upsert + D-5 throttle) |

## Proposed execution order (batches)

Each batch ends with the standard static-validation sweep (strict equality, reference
resolution, route mounts, event-graph wiring, permission-key coverage) and a docs/memory
update. No `node` execution.

1. **Batch 1 — Outbox foundation (A-3 → A-1 → A-2).** Idempotency guards first, then the
   `event_outbox` table + `outbox.enqueue`, then the `event-dispatch` worker; migrate the
   `order.paid` chain (accounting/invoicing/commission) onto it as the proof case. _Highest
   value; unblocks the rest._
2. **Batch 2 — Webhooks (B-1 / D-1).** Receiver pipeline (verify→log→dedup→enqueue→200) +
   `webhooks-replay-processor` dispatch, with `charge.success` → payment confirm → outbox
   `order.paid`.
3. **Batch 3 — Lifecycle & context (C-1 + A-4).** Shutdown hardening + `brandTransaction`
   choke point.
4. **Batch 4 — Concurrency & correctness (B-2 + B-4 + D-5 + D-3).** Scheduler `SKIP LOCKED`
   sweep, stock-oversell guard, public-write rate limits, money confirmation sweep.
   (D-2 already verified solid — no work.)
5. **Batch 5 — Forward (C-2).** PDF/browser-owner guidance applied when G-7 is built.

**Recommendation:** approve Batches 1–4 as the solidification scope; Batch 5 rides along
with G-7. I'll execute one batch at a time and summarize each before moving on.
