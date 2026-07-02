# Pixie Girl Hub — Deep Architecture Review & Refactoring Report

**Date:** 2026-07-01
**Reviewer role:** incoming senior engineer, independent read of the full codebase
**Scope:** backend (`src/`, ~648 files / ~127k LOC), admin frontend (`apps/admin`, ~402 files / ~125k LOC), storefront (`apps/storefront`), migrations, jobs, AI layer, docs
**Companion change:** commit `refactor: deduplicate repo helpers, module events, and prune dead dependencies` on this branch — the behaviour-preserving portion of the recommendations below, already applied and verified (eslint at baseline, 457/457 unit tests, full require-graph load).

> Relationship to prior audits: this repo already contains an unusually honest
> principal-engineer audit (`docs/PRODUCTION_READINESS_AND_ARCHITECTURE_AUDIT.md`,
> 2026-06-13) whose remediation IDs (H-x, R-x, W-x, F-x) are stamped throughout
> the code. This review **verifies what changed since**, credits what was fixed,
> and focuses on what is *still* weak. Where a finding below overlaps the June
> audit, it is marked **[still open]**.

---

## 1. Executive summary

The "scattered and confusing" first impression is mostly surface area, not
disorder. Underneath ~37 modules and 425+ tables there is **one strictly
enforced module pattern** (`routes → validator → controller → service → repo →
events`), one transaction/RLS choke point, a real transactional outbox, a
data-driven workflow engine, and a disciplined money model. The engine room is
credible.

The real problems cluster in five places:

1. **Per-request overhead** — every authenticated request pays 3+ uncached DB
   round-trips (user, brand config, permission grants) before any handler runs,
   while Redis sits idle for caching. This is the single biggest cheap win.
2. **God files** — `sales.service.js` (2,232 lines), `CampaignBuilderPage.tsx`
   (3,245 lines) and ~20 peers concentrate risk and block parallel work.
3. **Copy-paste infrastructure** — 53 copies of the executor helper, 32 copies
   of the brand-guard helper, 38 identical event-emitter files, 11 dead
   dependencies. *(Fixed in the companion commit — net −1,008 source lines.)*
4. **Split-process seams** — realtime events emitted from the worker process
   are silently dropped; rate limiting is per-process in-memory; node-cron has
   no distributed lock. All three bite the moment a second API/worker instance
   exists.
5. **Absent admin UIs** — seven navigation entries (accounting, dashboard,
   ecommerce, intercompany, praxis, retail-partners, stylists) route to a
   placeholder while their backend APIs are complete.

Also fixed under separate cover in the companion commit: nothing functional.
Two genuine functional defects were found and **deliberately not fixed** (per
the "do not change functionality" instruction) — see §8: the doubled global
rate limiter and two `AppError` calls that silently drop their user message.

---

## 2. Reverse-engineered architecture (the map)

### 2.1 Process topology

```
                        ┌──────────────────────────────────────────────┐
                        │  Node process #1 — API (src/server.js)       │
 Browser / PWA ──HTTP──▶│  Express + Socket.io (+ workers if enabled)  │
 Storefront SSR ──────▶ │  serves apps/admin/dist as SPA + /media      │
                        └───────┬──────────────────────────┬───────────┘
                                │ pg (schemas: shared,     │ ioredis
                                │ pixiegirl, faitlynhair)  │  ├── BullMQ queues
                        ┌───────▼───────┐          ┌───────▼────────┐
                        │ PostgreSQL 16 │          │     Redis      │
                        │ 425+ tables   │          │ socket adapter │
                        └───────▲───────┘          └───────▲────────┘
                                │                          │
                        ┌───────┴──────────────────────────┴───────────┐
                        │  Node process #2 — worker (src/jobs/worker)  │
                        │  8 BullMQ queues · ~30 cron jobs ·           │
                        │  outbox dispatcher (5 s poll)                │
                        └──────────────────────────────────────────────┘
```

### 2.2 Request lifecycle (traced, not from docs)

```
HTTP → cf-connecting-ip override → helmet → cors → compression → cookie-parser
→ express.json (rawBody capture for webhook HMAC) → request-id → geo-currency
→ pino-http → rate-limit ×2 (see DEFECT-1) →
→ authMiddleware        (JWT verify + shared.users lookup)         [DB hit 1]
→ brandContextMiddleware (X-Brand-Context → business_config lookup) [DB hit 2]
   └─ binds {brand,userId} into AsyncLocalStorage (request-context.js)
→ requirePermission(mod, action) (grants lookup → req.permission_scope) [DB hit 3]
→ Zod validator → controller (thin) → service
   └─ transaction(fn):  BEGIN → set_config('app.current_business', …, local)
                        → business SQL → outbox.enqueue(client, evt) → COMMIT
→ JSON  { data | error{code,message,fields}, request_id }
```

Post-commit, the **worker's** outbox dispatcher claims rows with
`FOR UPDATE SKIP LOCKED`, re-establishes the brand context, and runs each
registered named handler idempotently with per-handler completion tracking
(`shared/outbox/outbox.js`). Soft (loss-tolerant) fan-out uses per-module
in-process `EventEmitter`s relayed to Socket.io rooms by `src/realtime/*`.

### 2.3 Data isolation model

Schema-per-tenant: `shared` (identity, contacts, workflows, audit, AI,
outbox) + one schema per brand, structurally identical, stamped from
`migrations/template/*.template` with `__SCHEMA__` substitution. Repos build
`"<brand>.<table>"` by interpolation, guarded by a live brand registry
(`config/brands.js`) whose contents are regex-validated keys loaded from
`shared.business_config` — interpolation is injection-safe *because the Set
only admits regex-clean keys*. RLS policies exist on shared tables; write
paths set the GUC via `transaction()`; **read-side enforcement is behind
`RLS_READ_ENFORCE` and defaults to false** (`config/env.js:289`).

### 2.4 Layer inventory

| Layer | Location | Assessment |
|---|---|---|
| HTTP routing | `src/routes/index.js` (353 lines, 80+ routers) | works; manual mount list is a maintenance hotspot (§6.3) |
| Module pattern | `src/modules/*`, `src/shared/*` | genuinely uniform; the pattern is followed everywhere sampled |
| Transactions/RLS | `config/database.js` + `config/request-context.js` | well designed choke point; `brandTransaction` for brandless contexts |
| Events (soft) | `<mod>.events.js` ×40 → `shared/events/module-events.js` | was 40 copies; now one factory (companion commit) |
| Events (durable) | `shared/outbox/outbox.js` | correct at-least-once design; sequential dispatch (§5.3) |
| Workflow engine | `src/workflows/engine.js` | data-driven, threshold-aware, timeout/deputy support — good |
| Jobs | 8 BullMQ queues + ~30 node-cron entries | no distributed cron lock (§5.2) |
| AI | `src/ai/*` (facade) → `modules/praxis_ai/*`, `ai_governance`, `ai_insights`, `services/llm|embeddings|gemini|transcription` | see §7 |
| Frontend | `apps/admin` (Vite/React/TS, TanStack Query v5 + Zustand) | strong plumbing; god-components and 7 placeholder modules (§6.4, §4.6) |

---

## 3. What is genuinely good (protect these)

- **The transaction choke point.** `transaction()` + AsyncLocalStorage +
  `set_config(..., is_local := true)` is the correct way to make RLS and audit
  GUCs reliable without threading context through every signature.
- **The transactional outbox** with named-handler completion tracking
  (retries skip already-succeeded handlers) is better than most production
  systems ever get.
- **Money discipline.** `decimal.js` everywhere, 2dp strings in payloads,
  transaction-time FX captured immutably, margin-floor clamps at order build.
- **Error taxonomy.** `AppError{code,http_status,user_message,fields}` +
  a PG-error translation table that turns `40001`/`55P03`/`53300` into
  friendly retryable messages with brand support contact — buyer-grade.
- **Brand registry.** Runtime-provisionable tenants with an injection-safe
  live Set; a new business goes live with no deploy.
- **Frontend session model.** Access token in memory only, refresh in
  httpOnly cookie, silent single-retry refresh — implemented exactly as the
  canon specifies (`apps/admin/src/lib/api.ts`).
- **Idempotent checkout.** `client_idempotency_key` fast-path + partial
  unique index race backstop (`sales.service.js:80-103`).
- **Graceful shutdown** ordering with force-exit failsafe and non-zero crash
  exits.

---

## 4. Findings A — architecture decisions to revisit

### A-1. Identity resolution on the hot path is uncached **[new]**
`middleware/auth.js:39` (`userRepo.findById` — 2 correlated subqueries),
`middleware/brand-context.js:57` (`business_config` row), and
`middleware/rbac.js:61` (grants) each hit Postgres **on every request**.
`config/redis.js:1-10` even *documents* Redis as the cache for exactly this —
but nothing in `src/` caches any of it. At 300 req/min/IP allowed by the rate
limiter, this is 900+ pure-overhead queries/minute per active user IP.
→ Fix pattern in §9.1. Cache user+grants+brand config for 30–60 s with
event-driven invalidation on `iam.updated` / role change / brand config save
(the `iam.events.js` emitter with `emitIamUpdated` already exists for this).

### A-2. The worker cannot reach Socket.io — realtime silently dies in split-process mode **[new]**
Every realtime relay swallows the failure:
`realtime/stock-realtime.js:26-28` — `catch { logger.debug("… emit skipped") }`.
In the production topology (API with `ENABLE_WORKERS=false` + separate worker),
**every domain event emitted from an outbox consumer or cron — order paid,
stock moved by a job, workflow advanced by timeout — produces no client
update.** Dev (workers in-process) behaves differently from prod, which is the
worst kind of seam.
→ Route worker-side emissions through the existing Socket.io **Redis adapter**
(`socket.io-emitter` pattern) or a small Redis pub/sub bridge; §9.4.

### A-3. Read-side RLS defaults off **[still open — by design, but risky]**
`RLS_READ_ENFORCE=false` default means one-shot reads (`query()`) rely purely
on application-layer brand scoping. The June audit's SEC-2 ("one wrong brand
variable = silent cross-company leak, nothing catches it") therefore still
stands for reads in default config. The machinery to close it exists and is
tested (`queryWithContext`); it costs one extra round trip per read.
→ Turn it on in staging, measure, then default it on. Long-term: pgbouncer +
`SET LOCAL`-per-txn keeps the cost negligible.

### A-4. Express serves the SPA, media, and the API from one process **[still open]**
`server.js:79-128` — static assets, `/media` files, SPA fallback, JSON API and
Socket.io all share one Node event loop. Node is a poor static file server and
a single slow media download competes with checkout requests.
→ nginx (or CDN) in front for `/assets`, `/media`, and TLS; Node keeps `/api`
and websockets. No code change required — this is deployment topology.

### A-5. Validation library split-brain — resolved
Both `zod` and `joi` were declared; **only Zod is used** (0 `joi` imports).
`joi` removed in the companion commit along with 10 other dead deps
(`openai`, `groq-sdk`, `@anthropic-ai/sdk`, `bcrypt`, `redis`, `pg-pool`,
`@paystack/paystack-sdk`, `instagram-graph-api`, `twilio`, `pdf-lib`) — all
vendor calls actually go through `axios`/`ioredis`/`argon2`. 330 packages out
of `node_modules`, a smaller image and audit surface.

### A-6. `apps/admin` vs `client folder for hub-system` duplication of intent
The repo carries a full "engineering reference" client (own package.json, own
node_modules footprint) beside the real admin app. Fine as a temporary crutch;
as permanent structure it doubles the grep surface and confuses newcomers (it
matched several of this review's searches). → Move to a separate archive repo
or `docs/reference/` with node_modules excluded from tooling.

---

## 5. Findings B — performance & scalability

### B-1. N+1 queries in order creation **[new]**
`sales.service.js:124-139`: one `variantContext`/`serviceOfferingContext`
query **per line item, sequentially awaited**, inside the write transaction.
A 10-line order = 10 sequential round trips before pricing even starts, while
holding a pool connection. Same shape in `campaigns.discount.service`
re-resolution and coupon paths.
→ Batch: `WHERE variant_id = ANY($1)` once, map in memory (§9.2). Keeps the
same data, same clamps, ~1 round trip instead of N.

### B-2. Rate limiting is in-memory and doubled **[defect + scaling risk]**
Two independent `rateLimit` instances are both mounted on `/api/`
(`middleware/index.js:108-122` and `124-145`). Consequences:
1. Every request is counted twice against two separate 300/min buckets — the
   *first* limiter has **no localhost skip**, so the storefront SSR exemption
   the second one implements is dead code, and internal SSR traffic can be
   throttled (defect — see §8).
2. Default `MemoryStore` means limits are per-process: two API replicas =
   double the real limit; restart = reset. The `redis.js` header comment
   promises a Redis store that was never wired.
→ One limiter, `rate-limit-redis` store, keep the skip. 5 lines.

### B-3. Cron fan-out has no distributed lock **[still open]**
~30 `node-cron` entries (`jobs/worker.js:171-256`) run wherever workers run.
Only 2 schedulers take an advisory lock (`workflow-timeout`,
`chemical-reconciliation`). A second worker instance would double-send
email campaigns, layaway reminders, subscription billing.
→ Wrap `scheduleCron` with `pg_try_advisory_lock(hashtext(name))` once,
centrally — every job inherits it (§9.3).

### B-4. Outbox dispatch is strictly sequential
`outbox.js:195-207`: claims up to 50 rows, then processes rows one at a time,
handlers one at a time, on a 5 s tick. A single slow consumer (PDF render,
email send) delays every other event brand-wide. Throughput ceiling ≈
rows/tick × 1/handler-latency.
→ Modest concurrency (e.g. `Promise.allSettled` over a small worker pool of
rows — rows are independent by design), keep per-row handler order.

### B-5. Per-request identity queries (A-1) — biggest single lever
Repeated here because it is both an architecture and a throughput finding:
3 DB hits × every request × no cache. On the documented 8-vCPU single VPS,
Postgres does connection-pool work for zero information gain.

### B-6. Frontend bundle weight
`three` + `@react-three/fiber` + `@react-three/drei` (login flourish),
`xlsx`, `lottie-react`, `framer-motion` all ship in the admin app. Routes are
lazy-loaded with retry (good — `router.tsx:63`), but heavy libs should be
`import()`-ed inside the components that need them so the login/three code
never taxes the workspace shell.

---

## 6. Findings C — maintainability

### C-1. Copy-paste infrastructure — **fixed in companion commit**
Measured before the fix:

| Pattern | Copies | Now |
|---|---|---|
| `ex/exec/execFor` executor (`client ? client.query.bind(client) : query`) | **53 files** | 1 export: `config/database.js → ex` |
| `t(brand, table)` / `tbl` / local `assertBrand`/`brandSchema` guards | **32 files** | imports from `config/brands.js` (which had documented this exact migration since the brand-registry refactor — it was simply never finished) |
| `<mod>.events.js` identical emitter boilerplate | **38 of 40 files** | `createModuleEvents(ns)` factory; `iam` + `factory_account` intentionally untouched (non-standard exports) |
| Dead dependencies | 11 prod + 1 dev | removed |

Net: **−1,008 lines of source**, one definition to test per pattern, and a
future brand-guard hardening lands in one file instead of 32.

### C-2. God services and god components **[still open]**
Backend: `sales.service.js` 2,232 · `campaigns.public.service.js` 1,860 ·
`service-jobs.service.js` 1,249 · `catalogue.service.js` 1,153 ·
`invoicing.service.js` 1,145. `createOrderTx` alone spans ~450 lines mixing
pricing, campaign, coupon, points, exit-intent, floor-clamping, VAT, stock,
notices. Frontend: `CampaignBuilderPage.tsx` 3,245 · `OrgWorkflowPage.tsx`
2,478 · `StorefrontStudioPage.tsx` 1,705.
→ Decomposition strategy in §9.5 — extract *pure pricing stages* first (they
are already conceptually staged in comments: steps 1, 2, 3, 3.5…), keep the
transaction shell.

### C-3. Route mounting is a hand-maintained 353-line file
`routes/index.js` requires 80+ routers by hand. Every new module = edits in
3–4 places (routes file, module dir, permission keys, frontend modules.ts).
→ Convention-based registry: each module exports
`{ mountPath, router, public?: [...] }` and `routes/index.js` glob-mounts
them. Cuts the file to ~60 lines and makes "module exists but isn't mounted"
impossible.

### C-4. Docs drift
`docs/FRONTEND_MODULE_COVERAGE.md` claims **16 % weighted coverage / 33
modules to-do** while the router actually serves 84 route paths across ~30
built modules — the doc is badly stale in the *pessimistic* direction, which
erodes trust in the good docs (`SCHEMA.md` table counts have the same issue,
already flagged in `CONFORMANCE_GAPS.md` Part 3). Regenerate or delete.

### C-5. Naming drift
`kebab-case.js` and `snake_case.js` coexist *across* modules
(`cash-request.repo.js` vs `cost_vault.repo.js`), controller styles mix
`async function` declarations and const-arrow one-liners within one file
(`sales.controller.js`). Cosmetic, but it costs every grep. Pick one per the
CLAUDE.md rule ("consistent within module") and enforce with a lint rule.

---

## 7. Findings D — AI integration (full assessment)

**Architecture (traced):** `src/ai/*` is a thin facade over
`modules/praxis_ai/`. A turn = governance gate (per-brand enablement, budget)
→ RAG retrieve (pgvector `ai_embeddings`, `PRAXIS_RAG_TOP_K`) → LLM call with
**two tool families**: the `ai_enabled` action catalogue (writes) and the
read-only `query-agent` catalogue (live KPIs) → tool call materialises an
`ai_pending_actions` row — **nothing executes without human confirmation** →
every step traced to `ai_run_steps` with real token cost into the governance
ledger. Vendor creds are AES-encrypted DB rows managed in the AI Control UI;
`llm.service.js` speaks OpenAI-compatible chat/completions to any endpoint;
no vendor ⇒ graceful stub. Embeddings + Whisper-style transcription + Gemini
(vision) are separate cleanly-degrading services. Background AI: daily
briefing, insights sweep, pending-action expiry, RAG re-embed script.

**Strengths:** the permission-inheritance model (AI can only do what the
requesting user can), human-in-the-loop writes, cost metering per brand, and
full step tracing are *better designed than most production AI features*.
Governance UI exists (`ai-control` routes).

**Gaps:**

| # | Gap | Where | Impact |
|---|---|---|---|
| D-1 | **No chat UI route** — `/praxis` falls to `ModulePlaceholder`; a `chat-dock` store exists but no mounted surface | `apps/admin/src/lib/modules.ts:...` vs `router.tsx` | flagship feature invisible to users |
| D-2 | No streaming — `llm.service.chat` is a blocking axios POST (60 s timeout); a long answer means a frozen UI | `services/llm.service.js:48-54` | perceived quality |
| D-3 | No retry/backoff/circuit breaker on the LLM call; one 502 = user-visible failure message | `praxis.orchestrator.js:152-181` | reliability |
| D-4 | Single-turn tool loop — one tool call per turn, no multi-step plans; fine for now, worth stating as a design limit | orchestrator | capability ceiling |
| D-5 | RAG ingest coverage is thin relative to 425 tables (embeddings sweep exists; corpus curation is manual) | `rag-reembed.js`, `ai-embed` queue | answer quality |
| D-6 | `src/ai/rag-pipeline.js`, `action-catalogue.js`, `usage-meter.js` are stubs/facades that just re-export module code — either flesh out or delete to stop the "two AI layers" illusion | `src/ai/*` (28–63 lines each) | maintainability |

---

## 8. Functional defects found — **reported, deliberately not fixed here**

Per the review constraint ("do not change functionality"), these need their
own reviewed change:

| # | Defect | Evidence | Suggested fix |
|---|---|---|---|
| DEFECT-1 | **Global rate limiter mounted twice**; the first instance lacks the localhost skip, so the SSR exemption in the second is dead code and internal storefront SSR calls can be 429'd; every request double-counts | `middleware/index.js:108-122` + `124-145` | delete the first block; add `rate-limit-redis` store while there |
| DEFECT-2 | `AppError` 4th arg misuse: a bare string is passed where `{user_message}` is expected — the intended customer message is silently dropped | `sales.service.js:109-113`, `service-jobs.service.js:671-675` | wrap in `{ user_message: … }` |
| DEFECT-3 | Worker-emitted realtime events silently dropped in split-process deploys (A-2) | `realtime/*.js` catch-and-skip | Redis-adapter emitter bridge (§9.4) |
| DEFECT-4 | `redis.js` header documents rate-limit + hot-read caching that does not exist — misleading comment masquerading as architecture | `config/redis.js:1-10` | implement (§9.1) or correct the comment |

---

## 9. Refactoring strategy — product-grade patterns

Ordered by leverage; each is independently shippable. Phase 1 (dedup) is
already merged in the companion commit.

### 9.1 Identity cache middleware (kills 3 DB hits/request)

```js
// src/shared/iam/identity-cache.js
"use strict";
const { getClient } = require("../../config/redis");
const iamEvents = require("./iam.events");

const TTL_S = 45; // short enough that revocation lag is acceptable
const key = (userId) => `identity:v1:${userId}`;

async function getIdentity(userId, loader) {
  const redis = getClient();
  const hit = await redis.get(key(userId));
  if (hit) return JSON.parse(hit);
  const fresh = await loader(userId);           // existing staff.repo.findById
  if (fresh) await redis.set(key(userId), JSON.stringify(fresh), "EX", TTL_S);
  return fresh;
}

// Event-driven invalidation: role/status changes must not wait out the TTL.
iamEvents.on("updated", ({ user_id }) => {
  getClient().del(key(user_id)).catch(() => {});
});
iamEvents.on("session.revoked", ({ user_id }) => {
  getClient().del(key(user_id)).catch(() => {});
});

module.exports = { getIdentity };
```

Same pattern for `business_config` (invalidate on `business-setup.updated`)
and permission grants keyed `grants:v1:<roleIdsHash>:<module>:<action>`. The
domain events needed for invalidation **already exist** — this is wiring, not
invention. Expected effect: −3 DB round-trips on ~every request; the CEO
bypass and 401/403 semantics are untouched.

### 9.2 Batch the order-line context (N+1 → 1)

```js
// sales.repo.js — one query for all lines
async function variantContexts({ client, brand, variant_ids }) {
  const { rows } = await ex(client)(
    `SELECT v.variant_id, v.product_id, p.category_id,
            v.price_storefront_ngn, v.price_pos_ngn, v.price_wholesale_ngn,
            v.price_partner_ngn, v.min_price_ngn, v.cost_price_ngn
       FROM ${t(brand, "product_variants")} v
       JOIN ${t(brand, "products")} p USING (product_id)
      WHERE v.variant_id = ANY($1::uuid[])`,
    [variant_ids],
  );
  return new Map(rows.map((r) => [r.variant_id, r]));
}
```

```js
// sales.service.js — createOrderTx step 1 becomes
const ctxById = await repo.variantContexts({
  client, brand,
  variant_ids: input.lines.filter((l) => l.variant_id).map((l) => l.variant_id),
});
for (const li of input.lines) {
  const ctx = li.variant_id
    ? ctxById.get(li.variant_id)
    : await repo.serviceOfferingContext({ client, brand, service_id: li.service_offering_id });
  // …identical validation/pricing from here on
}
```

Same outputs, same clamps, same errors — one round trip.

### 9.3 One distributed-lock wrapper for every cron

```js
// jobs/cron-lock.js
const { query } = require("../config/database");
async function withCronLock(name, fn) {
  const { rows } = await query(
    `SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [`cron:${name}`]);
  if (!rows[0].ok) return; // another instance owns this tick
  try { await fn(); }
  finally { await query(`SELECT pg_advisory_unlock(hashtext($1))`, [`cron:${name}`]); }
}
```

Wrap once inside `scheduleCron` in `jobs/worker.js:101` and all ~30 jobs
become multi-instance-safe without touching any scheduler.

### 9.4 Worker → Socket.io bridge

The Redis adapter is already in place for API-side scaling; the worker only
needs an *emitter* handle (no server):

```js
// realtime/emitter.js — usable from BOTH processes
const { Emitter } = require("@socket.io/redis-emitter");
const { getPublisher } = require("../config/redis");
let emitter = null;
function io() { return (emitter ??= new Emitter(getPublisher())); }
module.exports = { io };
```

`realtime/*-realtime.js` swap `getIo()` for `io()` and the catch-and-skip
blocks (A-2/DEFECT-3) become unnecessary — a stock movement posted by the
outbox consumer reaches the browser regardless of which process ran it.

### 9.5 Decompose `createOrderTx` without changing behaviour

The function already narrates its stages. Make the narration structural —
each stage a **pure function** `(draft) → draft` over an order-draft object;
the service keeps the transaction and the sequence:

```
sales/pricing/
  resolve-lines.js        // step 1  (uses 9.2 batch)
  apply-campaign.js       // step 2
  clamp-margin-floor.js   // step 3
  apply-coupon.js         // step 3.5
  apply-points.js
  apply-exit-intent.js
  compute-vat-totals.js
sales/sales.service.js    // createOrderTx = transaction(pipe(stages) → persist → outbox)
```

Pure stages get direct unit tests (no DB mocks), the diff per business-rule
change shrinks from "somewhere in 2,232 lines" to one ~80-line file, and the
transaction/idempotency shell — the risky part — never moves. Apply the same
pattern to `campaigns.public.service.js` and, on the frontend, split
`CampaignBuilderPage.tsx` by its tab/step boundaries into feature folders.

### 9.6 Convention-mounted routes

```js
// modules/<name>/index.js (per module, 3 lines)
module.exports = {
  mount: "/sales",
  router: require("./sales.routes"),
};
// routes/index.js — replace 80 requires with a registry loop
for (const mod of discoverModules()) api.use(mod.mount, mod.router);
```

Public/webhook surfaces stay explicit (they have real ordering constraints);
the protected surface — 50 mounts with zero ordering sensitivity — becomes
convention.

---

## 10. UI/UX findings

1. **Absent UIs with live APIs** — nav entries that render `ModulePlaceholder`:
   `/accounting` (GL, cash-flow, AR/AP ageing reports all exist server-side),
   `/intercompany`, `/retail-partners`, `/stylists`, `/praxis` (D-1),
   `/dashboard`, `/ecommerce`. This is the largest visible product gap; the
   backend investment is stranded until these ship.
2. **What's right:** brand key in every TanStack query key
   (`lib/catalogue.ts:554`), `DataTable` bakes in the four canonical states
   (loading skeleton / empty / error / permission), lazy routes with retry,
   glassmorphism token system honoured (no stray hexes found in sampled pages).
3. **God pages** (§C-2) are a UX risk, not just a code smell — 3,000-line
   pages accrete inconsistent interaction patterns because nobody can hold
   them in their head.
4. **Heavy login flourish** (three.js) trades first-paint speed on low-end
   Nigerian mobile connections for aesthetics — measure and consider a static
   fallback under `prefers-reduced-motion`/slow-connection heuristics.
5. **Stale coverage docs** (C-4) misstate the product's own completeness.

---

## 11. Verification of the companion commit

- `npx eslint src/` → identical to pre-change baseline (12 pre-existing
  problems, 0 introduced).
- `npm run test:unit` → **61/61 suites, 457/457 tests pass** (two test mocks
  updated to expose the now-imported helpers — mock-shape only).
- Full require-graph load (`routes/index.js` + `jobs/worker.js`) → OK.
- `node --check` on all 110 changed files → OK.
- No SQL, no route, no payload, no event name, no export surface changed.

---

## 12. Suggested sequence (if this review drives a hardening sprint)

| Order | Item | Size | Risk |
|---|---|---|---|
| 1 | DEFECT-1 rate limiter + Redis store | XS | low |
| 2 | §9.1 identity cache | S | low (TTL + event invalidation) |
| 3 | §9.3 cron lock wrapper | XS | low |
| 4 | §9.4 worker realtime bridge (fixes DEFECT-3) | S | low |
| 5 | §9.2 order-line batch | S | medium (touches checkout — needs the existing integration suite) |
| 6 | DEFECT-2 AppError args | XS | low |
| 7 | §9.5 sales service decomposition | M | medium |
| 8 | Ship the 7 placeholder UIs, starting with `/accounting` + `/praxis` | L | product work |
| 9 | RLS read enforcement default-on (A-3) | S | medium (perf validation first) |
| 10 | §9.6 route registry + naming lint | S | low |
