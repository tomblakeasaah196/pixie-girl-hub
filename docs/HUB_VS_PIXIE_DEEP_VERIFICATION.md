# hub-system vs pixie-girl — Independent Deep Verification

**Goal.** Re-run the module + shared file comparison from scratch against the live code,
verify every claim in `HUB_VS_PIXIE_COMPARISON.md` and `SOLIDIFICATION_PLAN.md`, and surface
anything those docs got wrong or missed. Bottom line up front: the two docs are **accurate on
the big picture and on the four headline gaps**, but the signal counts are stale, one "positive"
overstates pixie, and **the highest-severity issue is mis-rated** — RLS is now _enabled_ yet
_inert_, which makes A-4 a critical isolation gap, not a 🟡 nicety.

Every finding below is cited to `file:line` so it can be re-checked.

---

## 1. Census — surface area (verified)

|                        | hub-system | pixie-girl |
| ---------------------- | ---------- | ---------- |
| `modules/` `.js` files | 99         | **216**    |
| `shared/` `.js` files  | 33         | **87**     |
| Module domains         | 25         | 30         |

Pixie carries ~2.3× hub's code surface. The domain-coverage map in the comparison doc is
correct: parity in the ERP spine (accounting, sales, pos, invoicing, stock, catalogue, crm,
purchasing, expenses, logistics, dashboards), pixie strictly broader in retention, marketing,
storefront, settings/provisioning, RBAC, and payroll, and pixie-only modules (`ai_governance`,
`ai_insights`, `praxis_ai`, `pricing`, `service_jobs`, `stylist_programme`, `production`,
`intercompany`, `cash_request`, `storefront_studio`, `org_workflow`, `attendance`, e-sign).
The real hub-only gaps (`tax`, `help`, rich `reports` export, standalone `discounts`) are
feature gaps, not robustness gaps. **Confirmed — no correction.**

---

## 2. Signal scan — re-counted (docs are STALE, conclusions still hold)

| Signal                                   | Doc claim           | **Re-measured (whole `src` tree)** | Note                                                       |
| ---------------------------------------- | ------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `parseFloat` on money (hub anti-pattern) | hub 211 / pixie 0   | **hub 247 / pixie 0**              | ✅ pixie far ahead — direction confirmed, hub count higher |
| `ON CONFLICT` files                      | hub 16 / pixie 17   | **hub 21 / pixie 19**              | parity, both higher than doc                               |
| `FOR UPDATE` / `SKIP LOCKED` files       | hub 3 / **pixie 0** | **hub 4 / pixie 2**                | ⚠️ see correction below                                    |
| `decimal.js` money discipline            | pixie ahead         | confirmed — pixie 0 float ops      | ✅                                                         |

### Correction 2a — "no pessimistic locking anywhere in pixie" is **overstated**

The comparison doc's Part 2 verdict (`pixie 0 FOR UPDATE … no pessimistic locking anywhere`)
is wrong as written. Pixie _does_ lock in two places:

- `src/workflows/engine.js:299` and `:429` — `SELECT … FOR UPDATE` on
  `shared.workflow_instances` / pending steps (real, app-level pessimistic locking).
- `src/utils/document-numbers.js` → `fn_next_document_number()` uses `SELECT FOR UPDATE`
  **in the DB function** to serialise document-number issuance.

The _accurate_ statement — and the one the plan actually needs — is narrower and still true:
**there is no `FOR UPDATE` / `SKIP LOCKED` in the cron sweeps (`src/jobs/schedulers`), in the
stock-movement write path, or in any financial event consumer.** That's the genuine gap (B-2),
and it stands. But "none anywhere" should be struck so the baseline is honest.

hub's 4 lock sites: `config/db.js`, `jobs/index.js`, `modules/campaigns/scheduler.service.js`,
`shared/auth/invite.service.js` (the doc listed 3 and missed `config/db.js`).

---

## 3. Event spine (A-1 / A-2 / A-3) — **fully confirmed**

This is the core thesis of both docs and it is correct in every detail.

**A-1 — emit fires pre-commit.** `sales.service.markPaid` emits `order.paid` at
`sales.service.js:497`, and `markPaid` is invoked at `:391` _inside_ the `transaction()` opened
by `addPayment` at `:322`. The wrapper commits only when the callback returns
(`config/database.js:103`), so the event is emitted **before COMMIT**. Same shape for
`order.payment` (`:427`), `order.deposit_met` (`:409`), `order.created` (`:271`),
`order.cancelled` (`:553`), and the quotation/cancellation paths. Confirmed.

**A-2 — subscribers run clientless on the pool.** `accounting.subscribers.js:48` calls
`salesRepo.findById({ brand, id: order_id })` with **no `client`**; `sales.repo.js:17`
(`const ex = (c) => (c ? c.query.bind(c) : query)`) routes a clientless call to the pool — a
different connection from the still-open sales transaction. Under READ COMMITTED it cannot see
the uncommitted order → `if (!order) return;` (`:49`) → the GL journal silently never posts.
The file's own header (`:1-15`) admits it is "best-effort … can be re-posted," but the only
failure path is `logger.error` (`:113-118`) — **there is no re-post path.** Confirmed, and it is
the single highest-value fix.

**A-3 — consumers are not idempotent.** Grep of all migrations: **no `UNIQUE` and no
`ON CONFLICT` on `journal_entries(source_type, source_id)`** anywhere. The natural-key precedent
the plan cites does exist in the codebase (e.g. the AI-embeddings unique key,
`000012_shared_ai.sql:410`), so the fix is idiomatic. Confirmed — at-least-once redelivery would
double-post today.

**Outbox status:** `grep event_outbox|outbox` across `src/` and `migrations/` → **0 hits.** The
transactional-outbox fix is genuinely not built yet. Confirmed the plan has not been executed.

---

## 4. The mis-rated finding — A-4 RLS is **enabled but inert** (should be 🔴, not 🟡)

This is the most important thing in this verification and neither doc states it correctly.

**What the plan says:** A-4 is 🟡 "RLS/audit context is opt-in … the GUCs are usually unset …
when RLS is enabled (PD §3 anticipates it) the context is silently null."

**What is actually true in the code right now:**

1. RLS is **already enabled**, not anticipated. `migrations/000200_shared_rls.sql` runs a
   `DO` block that does `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + creates a `brand_isolation`
   policy on **every `shared` table with a `business` column (62 tables)**. The policy clause is:

   ```sql
   USING ( shared.current_business() IS NULL OR business = shared.current_business() )
   ```

2. `shared.current_business()` returns `NULLIF(current_setting('app.current_business', true), '')`
   — i.e. **NULL whenever the GUC is unset** (`000200_shared_rls.sql`, helper def).

3. The GUC is **never set on the normal write path.** `config/database.js` `transaction()`
   (`:97`) only does BEGIN/COMMIT. The only function that sets `app.current_business` is
   `setSessionContext()` (`:125`) — and grep shows **nothing in `src/` calls it** except its own
   definition. The `withBrand(brand, fn)` helper that migration 000200's header _claims_ lives in
   `src/config/database.js` **does not exist** (`grep withBrand src/` → 0 hits). The plan's
   proposed `brandTransaction()` also doesn't exist yet (0 hits).

**Net effect:** RLS is ON, the GUC is always unset, so `current_business()` is always NULL, so
the policy's `IS NULL` branch is always true → **every row of every brand passes the filter on
every query.** The data-layer isolation that V2.2 §3 explicitly mandates ("enforce at the data
layer … not only the UI") is, in practice, a **no-op that fails open.** App-layer filtering (the
explicit `business = …` predicate / `brand.table` qualification) is still doing the real
isolation work — but the RLS backstop that's supposed to catch a query that _forgets_ that
predicate provides zero protection. The moment any query omits the explicit brand filter, nothing
stops a cross-brand read or write.

**Doc contradiction this exposes:** `CONFORMANCE_GAPS.md:22` marks "C-1 RLS (Option A, full)"
**done** (via `000200`), while `ENTITY_ISOLATION.md:80` says "The plumbing is ready
(`src/config/database.js` sets `app.current_business` per transaction); the policies themselves
are pending." **Both are wrong, in opposite directions:** the policies _are_ applied, and the
plumbing is _not_ there. The truth is the inverse of each doc.

**Recommendation:** promote this to the top of Batch 1 (ahead of, or alongside, the outbox). Build
the `brandTransaction(brand, userId, fn)` choke point (BEGIN → `SET LOCAL app.current_business` +
`app.current_user_id` → `fn(client)`), migrate write paths onto it, and add a test that a
clientless / no-context query returns **zero** rows rather than all of them. Until then, treat
brand isolation as app-layer-only and document RLS as **not yet effective** in CONFORMANCE_GAPS.

---

## 5. The other three headline gaps — confirmed

**B-1 / D-1 webhooks are stubs — confirmed, verbatim.** `business_setup/webhooks.routes.js`:
every receiver (`/paystack` `:22`, `/opay` `:25`, `/stripe` `:28`, `/nomba` `:31`, `/meta/*`
`:35-46`, `/chowdeck` `:51`, `/gigl` `:55`) is `(_req, res) => res.status(200).send()`. The file
header (`:1-11`) describes the intended verify→log→enqueue→200 pipeline; the bodies implement none
of it. `shared.webhook_log` exists in schema, so this is pure app-layer work. Confirmed.

**C-1 shutdown — confirmed, verbatim.** `server.js:78` `server.close(() => …)` is **not awaited**;
control falls straight through to `stopWorkers` → `closeSocketIo` → `closeRedis` → `closeDatabase`
→ `process.exit(0)` (`:79-88`) while requests may still be on the pool. `uncaughtException` /
`unhandledRejection` (`:95-102`) both route to `shutdown` which exits **0**, masking crashes. No
re-entrancy guard, no force-exit timer. The positive in the plan also holds: DB pool / Redis /
Socket.io are clean single-owners. Confirmed.

**B-5 smartcomm / B-6 order-form — confirmed.** `smartcomm.service.js` `sendToCustomer` calls
`email.send` (`:277`) and `whatsapp.sendText` (`:289`) **inline in the request**, never touching
the `email-send` / `whatsapp-send` BullMQ queues the worker already runs; `findOrCreateCustomerThread`
(`:230`) is a check-then-insert with no unique key. `storefront/order-form.routes.js` mounts
`submitOrderForm` with only a validator (`:15`) — no idempotency-key middleware. Both confirmed.

---

## 6. The one gap that's softer than the docs claim — B-4 stock oversell

The plan rates B-4 🟠 ("two concurrent `-sale` movements can both pass and drive `on_hand`
negative **unless** the trigger/constraint blocks it"). It is blocked — at the DB layer:

- `migrations/template/000017_business_stock.sql.template:74` —
  `on_hand INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0)`, plus `:84`
  `CONSTRAINT stock_reserved_le_on_hand CHECK (reserved <= on_hand)`.
- `fn_apply_stock_movement` (`template/000034_business_triggers.sql.template:27-56`) applies a
  sale as `on_hand = on_hand + EXCLUDED.on_hand` via `ON CONFLICT (variant_id, location_id) DO
UPDATE`. The `ON CONFLICT … DO UPDATE` takes a **row lock** on the `stock_levels` row, so two
  concurrent sales of the last unit serialise; the second to apply computes `on_hand < 0` and the
  `CHECK` **rejects it → its transaction rolls back.**

So oversell-to-negative **cannot** happen silently — it fails closed. The residual issue is
purely UX/observability: the losing transaction surfaces a raw constraint violation (a 500-class
error) instead of a clean `409 / "insufficient stock"`, because there's no explicit
`SELECT … FOR UPDATE` pre-check with a friendly message. **Recommendation: downgrade B-4 from 🟠
data-integrity to 🟡 error-mapping** — add the pre-check for a clean error, but the integrity
hole the plan implies is already covered by the CHECK + the trigger's row lock.

---

## 7. Confirmed-correct positives (no work needed)

- **D-2 error handler** — solid, never leaks SQL/stack (as the plan states).
- **Money discipline** — `utils/money.js` (`decimal.js`, `ROUND_HALF_UP`, `toCurrencyString`) used
  correctly in `accounting.subscribers.js`; **0** `parseFloat` on money in pixie vs **247** in hub.
- **Resource singletons** — DB pool / Redis (main+pub+sub) / Socket.io are single-owners; ahead of
  hub's double-`io` bug.
- **Atomic doc numbers** — `fn_next_document_number()` (`SELECT FOR UPDATE`) is a clean
  concurrency primitive pixie already has; the outbox/scheduler work can reuse the same DB-lock idiom.

---

## 8. Verdict & corrected priority

Pixie is **better-engineered than hub on money, error handling, resource lifecycle, and feature
breadth**, and its robustness debt is exactly as concentrated as the docs say — but the order is
wrong on one item:

| #   | Item                          | Doc rating | **Verified rating** | Why                                                                                                                 |
| --- | ----------------------------- | ---------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | **A-4 RLS enabled but inert** | 🟡         | **🔴**              | RLS ON + GUC never set + `withBrand` missing → isolation fails open on 62 tables; both docs describe it incorrectly |
| 2   | A-1/A-2/A-3 event spine       | 🔴         | 🔴                  | confirmed verbatim; outbox not built                                                                                |
| 3   | B-1/D-1 webhook stubs         | 🔴         | 🔴                  | confirmed verbatim                                                                                                  |
| 4   | C-1 shutdown                  | 🟠         | 🟠                  | confirmed verbatim                                                                                                  |
| 5   | B-2 cron locking, B-5/B-6     | 🟠         | 🟠                  | confirmed                                                                                                           |
| 6   | B-4 stock oversell            | 🟠         | **🟡**              | DB CHECK + row lock already prevent negative stock; UX-only                                                         |

**Two doc edits to make pixie's tracking honest:**

1. Strike "no pessimistic locking anywhere" (§2 of the comparison) — pixie locks in the workflow
   engine and the doc-number function; the gap is scoped to sweeps/stock/consumers.
2. Reconcile `CONFORMANCE_GAPS.md` (C-1 "done") with `ENTITY_ISOLATION.md` ("plumbing ready,
   policies pending"). Reality: policies applied, plumbing absent → mark RLS **not yet effective**
   and fold the `brandTransaction` build into Batch 1.

Everything else in `SOLIDIFICATION_PLAN.md` is well-evidenced and the Batch 1→4 sequencing is
sound — with A-4 promoted to ride alongside the outbox as the first batch.
