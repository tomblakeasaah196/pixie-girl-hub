# Pixie Girl Hub — Principal-Engineer Production-Readiness & Architecture Audit

**Auditor role:** Incoming Principal/Staff Engineer, independent review
**Date:** 2026-06-13
**Subject:** `pixie-girl-hub` backend monorepo (commit `970a3a9`, branch `claude/kind-edison-2h5zbb`)
**Targets of comparison (intent):** Product Description **v2.2** (pre-final) + **CEO Meeting Minutes** (final decisions). Code is treated as the source of truth for *reality*; the two documents as the source of truth for *intent*.
**Target hardware (reality of deployment):** `hub.pixiegirlglobal.com` — **8 vCPU / 18 GB RAM / 240 GB SSD / 300 Mbps**, single VPS.

> This document is the deep, severity-rated, CTO-grade report. A one-page plain-English summary for the CEO is delivered separately in chat. Nothing here is padded; every finding cites code at `file:line` and states the fix.

---

## 0. Bottom line

The **engine room is real and, in places, genuinely well-engineered** — a clean, uniformly layered Node/Express monorepo (~**72,000 LOC**, ~**460 JS files**, ~**37 modules**, ~**430–470 tables**) with a *real* double-entry ledger, a *real* inventory ledger with correct concurrency on the main checkout path, signed-webhook payments, AES-256-GCM secret encryption, a transactional outbox, and graceful shutdown. The team's own internal audits are unusually honest.

But measured **ruthlessly against (a) the product description, (b) the CEO's meeting decisions, and (c) what it takes to run a multi-entity, multi-million-dollar business under real traffic on the provisioned box**, it is **not production-ready and not safe to launch as-is**. The failures cluster in exactly the places that matter most for this business:

1. **The customer-facing product does not exist in this repo.** There is no storefront, no admin UI, no dashboards — and specifically **neither of the two Next.js storefronts** the meeting agreed to build (`pixiegirlglobal.com` + `faitlynhair.com`). This repo is backend-only. The flagship promise — "a storefront built to handle flash-sale traffic spikes" — cannot be assessed because it isn't here.
2. **The two privacy guarantees the spec calls its "governing principle" — *cost prices and salaries are private* — are not enforced at any layer.** The DB-view/role machinery that was supposed to enforce them is never used by the application; cost, margin, wholesale, and landed-cost columns are selected straight off base tables and returned.
3. **The money paths that protect the investor's books have real correctness holes** — a Stripe double-credit, inter-company entries that can post on one side only, an unenforced minimum-margin floor, and payroll that never actually pays anyone.
4. **The CEO's headline catalogue model was not built.** The agreed 3-tier *Raw-base → Styled → Category* architecture (stock at the base UUID, styling as an add-on, pre-order on stock-out) is absent — the schema is a flat `products → variants`.
5. **The "speed-of-light loads / cache a lot / minimize memory" mandate is contradicted by the code.** Redis caches *nothing* of the hot read path, the API runs on a single core of an 8-core box, large media is buffered into heap (OOM risk), there is no media-serving layer at all, and Postgres is untuned.

**Production-readiness grade: ~40%.** (Backend domain logic in isolation is ~70–75% and good; but production-readiness folds in correctness proof, the missing UI, the privacy/isolation gaps, the money bugs, and the infra/scale story — and those drag it down hard.) Conformance-to-spec is ~55% (consistent with the team's own external audit). **This is a strong skeleton that is one disciplined hardening sprint away from being demoable and two to three sprints away from being trustworthy with real money and real customer data.**

---

## 1. Method, scope & a critical environment caveat

- **Authoritative reads were done natively** (file reads, schema/migration reads, targeted code tracing) plus parallel deep-dive sub-audits of the money path, the inventory/overselling path, the AI/RAG path, the media/memory path, and the caching path.
- **Heed this:** the repo's own `EXTERNAL_AUDIT_2026-06-13.md §1` reports that the **bash sandbox mount serves *truncated copies* of recently-edited files**, so `node --check`/`eslint`/`jest` run in-sandbox report *phantom* corruption. **I verified this claim and found it false in this session** — `wc -l` (working tree) matches `git show HEAD` byte-for-byte for the files I spot-checked (`pos.service.js` = 721/721, `sales.service.js` = 1412/1412, `accounting.service.js` = 834/834). Regardless, I relied on native reads, not in-sandbox execution, for every finding. Real CI on GitHub is the correct place to gain execution confidence.
- **Severity scale:** 🔴 **P0 / CRITICAL** (data leak, money corruption, or launch blocker) · 🟠 **P1 / HIGH** (serious; fix before scale/real traffic) · 🟡 **P2 / MEDIUM** · 🟢 **P3 / LOW**.

---

## 2. What is genuinely good (credit where due)

These are real strengths and should be protected during remediation:

| Area | Evidence | Verdict |
|---|---|---|
| **Layered architecture** | Uniform `routes → validator → controller → service → repo → events → subscribers` per module; all mounted in `src/routes/index.js`; blanket `authMiddleware` + `brandContextMiddleware` on the whole `/api/v1` surface (`routes/index.js:149-151`) | Clean, consistent, maintainable |
| **Double-entry ledger** | `accounting.service.js:74-80` asserts debits=credits with `decimal.js`; DB trigger `fn_journal_entry_balance_check` re-checks on post; posted entries immutable; XOR debit/credit CHECK (`000022:207-210`, `000034:66-136`) | A real ledger, per-brand schema-isolated |
| **Overselling (main path)** | `stock.repo.js:166-175` `SELECT … FOR UPDATE` + `CHECK (on_hand >= 0)` (`000017:74`) — 500 concurrent checkouts on one SKU produce clean 409s, **no oversell** | Correct concurrency design |
| **Payments — signatures & dedup** | Raw-body HMAC verification for Paystack/Stripe/Nomba/OPay over `req.rawBody` (`middleware/index.js:50-56`), `timingSafeEqual`, plus webhook **delivery** dedup `UNIQUE(source, external_id)` (`000205`) | Inbound integrity is solid |
| **Money type** | `decimal.js` everywhere for persisted amounts; `NUMERIC(14,2)`; transaction-time FX captured immutably (`sales_orders.fx_rate_used`) | Books aren't retroactively corrupted by FX drift |
| **Secrets at rest** | AES-256-GCM, random IV, auth-tag validated, ciphertext never returned by list endpoints (`encryption.service.js`, `governance.repo.js:129-138`) | Correct |
| **Auth** | argon2 hashing, JWT access(15m)/refresh(14d) with **rotation + Redis revocation**; password-reset now implemented (single-use SHA-256-hashed token, no enumeration, all-session revoke) — closes the old `EXTERNAL_AUDIT` M-1 | Good |
| **Injection resistance** | Brand interpolated into schema names is guarded by `assertBrand`/`VALID.has` + strict identifier regex (`config/brands.js:54,71-81`); dynamic UPDATE builders iterate **hardcoded column allowlists** (`pos.repo.js:20-30`, `accounting.repo.js:28-36`) — **no SQL injection found via brand or column names** | Genuinely safe |
| **Access matrix** | The spec's Role×Module grants are now **seeded** for all 8 named roles (`000207_shared_access_matrix_seed.sql`) — supersedes the team's older "only owner seeded" finding | Engine + data both present |
| **Reliability plumbing** | Transactional outbox with `SKIP LOCKED` polling, idempotent `order.paid` consumers, drain-ordered graceful shutdown with force-exit failsafe (`server.js:91-138`) | Thoughtful |

The earlier internal worry that modules were "350-line skeletons" no longer holds — most modules carry 600–1,400 LOC of real logic.

---

## 3. The structural reality (so the findings make sense)

**Multitenancy = schema-per-tenant, not row-level.** Per-brand data lives in physically separate Postgres schemas `pixiegirl.*` and `faitlynhair.*`; shared/global data lives in `shared.*`. Repos build `"<brand>.<table>"` by string interpolation, guarded by `assertBrand`. This is a deliberate, defensible choice for **two** entities and gives strong isolation **as long as every repo scopes correctly** — but it has three consequences the audit returns to:
- The spec's literal mandate — *"row-level security on `entity_id`"* — does **not** describe this system. Per-brand tables have no `entity_id` and no RLS; isolation is the schema name, chosen in application code.
- There is **no working data-layer backstop**. One repo using the wrong brand variable, or a missing scope filter, is a silent cross-company leak with nothing to catch it (see SEC-2).
- **Operational cost scales by tenant:** adding a third entity = **+~173 tables** and re-running every `migrations/template/*.template` against a new schema; every future schema change is an ×N migration. Fine for 2; plan for it before 3.

**Process & deploy model (as shipped).** `docker-compose.yml` runs Postgres, Redis, one `api` container (`ENABLE_WORKERS=false`), and one `worker` container — all on the single VPS. There is **no nginx, no TLS terminator, no CDN, no media server, no clustering, and no Postgres tuning** anywhere in the repo. `helmet`'s CSP is disabled with the comment *"storefront has its own CSP via Next.js"* (`middleware/index.js:26`) — confirming the intended frontends live in a **separate, not-yet-existing** Next.js codebase.

---

## 4. Findings — 🔴 P0 / CRITICAL (launch blockers)

### 🔴 P0-1 — Cost prices and salaries leak to staff: the spec's "governing principle" is unenforced at every layer
**Spec (§3):** *"the governing principle — cost & pay are private … cost prices and salaries are hidden from almost everyone — even Operations."* **Hidden fields: factory cost, product origin, salary are invisible even inside a module the user can open.**

**Reality:** the privacy machinery exists but **nothing uses it**:
- `migrations/template/000038_business_field_privacy.sql.template` creates restricted views (`view_product_variants_public` hides `cost_price_ngn`/`min_price_ngn`/`price_wholesale_ngn`; `view_payslips_summary` hides all pay figures; `view_production_runs_public` hides landed cost) and DB roles `hub_basic`/`hub_payroll`/`hub_full`. **Grep across `src/` for any of these views or `SET ROLE` or the roles → zero hits.** The app never queries the views and never assumes those roles.
- The app connects as a **single** role for all requests, and repos `SELECT` the **base** tables. `catalogue.repo.js:72-76` lists `cost_price_ngn`, `min_price_ngn`, `price_wholesale_ngn` among returned columns.
- The intended app-layer alternative (`shared.permissions.hidden_fields`) is **also** not done — `000207`'s own comment says verbatim: *"FOLLOW-UP (not done here): field-level privacy — 'cost & pay are private' … seeding it needs the real sensitive column names per table."* And `middleware/rbac.js` never reads `hidden_fields`.

**Impact:** Any non-CEO role with `catalogue.view` (Operations, Marketing, even a Sales Rep depending on grants) can read **factory/cost price, minimum price, wholesale price, and per-unit landed cost** straight from the API. Payslip money fields are exposed to anyone granted payslip read. This is the single most explicit promise in the access-control section of the spec, and it is wide open. For a business whose investor protection and supplier relationships depend on cost confidentiality, this is a launch blocker.

**Fix (pick one; B is the robust one):**
- **(A) App-layer projection.** Add a response serializer keyed on `req.user` permissions that strips a per-table sensitive-column set before send; populate `shared.permissions.hidden_fields` and enforce it centrally in the controller/响应 layer. Fast to ship; must be applied on *every* read path incl. list/export/AI.
- **(B) Use the DB views/roles as designed.** Connect the app as a non-superuser `pixie_app`, make `hub_basic/full/payroll` real, and `SET LOCAL ROLE` per transaction based on the user's privilege (the same transaction choke point that already sets the RLS GUC in `database.js:166-178`). Then point repos at `view_*_public` when the user lacks the sensitive grant. This makes leakage structurally impossible.
- **Regression test (mandatory):** a Sales Rep token hitting `GET /catalogue/...` must receive a payload with **no** `cost_price_ngn`. Add to `tests/integration`.

---

### 🔴 P0-2 — Stripe double-credit: one payment booked twice into the investor's books
**Where:** `webhooks.service.js:386-419`, `migrations/template/000019_business_sales.sql.template:419-425`.

Stripe emits **two** success events for a single card payment — `checkout.session.completed` (object id `cs_…`) and `payment_intent.succeeded` (object id `pi_…`). The code sets the payment `reference = obj.id`, so:
- the two events have **different `external_id`** → webhook **delivery** dedup (`000205`) does **not** collapse them, and
- `client_idempotency_key = "stripe:" + reference` **differs** (`stripe:cs_…` vs `stripe:pi_…`), and the only order-level idempotency is `UNIQUE(order_id, client_idempotency_key)`. The `(provider, provider_reference)` index is **explicitly non-unique** (`000019:419-420`).
- The pre-check `paymentExistsByProviderRef` is a non-transactional `SELECT`, not `FOR UPDATE`.

**Result:** the same Stripe payment passes the gate twice → **double cash booked + a spurious second realised-FX journal** in PXG's ledger. This is the highest-severity money bug because PXG carries an external investor.

**Fix:** add a UNIQUE constraint on `(provider, provider_reference)` (or normalize Stripe to settle on the `payment_intent` id only and ignore `checkout.session.completed` for crediting); make the existence check `SELECT … FOR UPDATE` inside `addPayment`'s transaction; and back the credit with an idempotency key derived from the **payment intent**, not the event object.

---

### 🔴 P0-3 — Inter-company books can go asymmetric (one side posts, the other doesn't)
**Where:** `intercompany.service.js:97-151`.

`recordTransaction` writes the IC row in one transaction, then posts the **seller** journal and the **buyer** journal in **two separate `postEntry` calls, each in its own transaction, each in an independent try/catch**. On failure it logs and writes a reconciliation flag. So a trade can exist with **zero, one, or two** journals — e.g. **PXG books IC revenue + receivable with no matching FLH purchase/payable**.

**Impact:** directly violates the meeting's and spec's core promise that every cross-entity value transfer is a *real, balanced invoice/purchase pair in both books*. For investor-facing accounts this is the difference between "defensible" and "qualified by the auditor."

**Fix:** post both legs (and the IC row) inside **one** DB transaction via the shared `transaction()`; if either leg fails, the whole trade rolls back. Reconciliation flags are for *settlement timing*, not for papering over a failed half-post.

---

### 🔴 P0-4 — Inter-company minimum-margin floor is never enforced; inventory never moves
**Where:** `intercompany.service.js:84` (floor stored verbatim, never compared), `intercompany.validator.js:23` (only 0–100 range check); **no stock movement code anywhere in the module.**

The meeting was explicit: when **Faitlyn buys a Pixie wig**, the price has a **minimum-margin floor** "so Pixie never sells to its sister company below a fair price (protecting the investor)," and **the unit moves from PXG inventory into FLH inventory**. In code:
- `min_margin_floor_pct` is accepted from the client and stored; `effective_margin_pct` is **never computed** and **never compared** → a wholesale transfer can be booked **below cost**.
- There is **no `deductForSale`/`transferStock`** in `intercompany.*` → the wig **never leaves PXG stock and never enters FLH stock**. PXG inventory is overstated, FLH understated, after every wholesale transfer.
- Flow 1 (styling) and Flow 2 (wholesale) post the **identical** journal pair; styling cost **never flows into PXG's per-wig landed cost** (`landed_cost_components` is touched only by Production), so the spec's "Faitlyn invoice ref carried into Pixie's landed cost" is absent.

**Fix:** compute `effective_margin_pct` from the wig's cost and **reject** below-floor wholesale; in the same transaction as the journals, issue the PXG→FLH stock movement; branch the journal templates by `flow_type` and, for styling, append a `landed_cost_components` row on the PXG wig carrying the FLH invoice reference.

---

### 🔴 P0-5 — Payroll never pays anyone, has no PIN, and never hits the ledger
**Where:** `payroll.service.js:276-331` (`markRunPaid`), `payroll.routes.js:27`.

The meeting specified the payroll flow in detail: auto-calc → HR review → **CEO approves → CEO enters a PIN → system debits the company account and pays each staffer's bank account automatically** (Nomba/Flutterwave). In code:
- `markRunPaid` **only flips payslip/commission rows to `'paid'`**. There is **no bank-transfer call anywhere** — grep finds no Flutterwave service and no Nomba payout primitive. Staff are never actually paid; the company account is never debited.
- There is **no server-side PIN check** (the only `pin` in payroll is `pension_pin`, an unrelated identifier). The pay action is gated by RBAC only.
- **No GL posting** for payroll — salaries, PAYE, pension, NHF liabilities never reach either entity's books, despite a `'payroll'` `source_type` existing in the enum.

**Impact:** the most-discussed module in the meeting is a status-flip stub. As-is it will silently mark people "paid" who have not been paid, and leave payroll entirely off the financial statements.

**Fix:** implement the disbursement provider (confirm Nomba payout API per the meeting's action item, else Flutterwave) behind an **idempotent** transfer with a stored transfer reference; require a server-verified PIN (hashed, rate-limited) on the approve→pay transition; post the payroll journal (salary expense / statutory liabilities / bank) in the same transaction that records disbursement.

---

### 🔴 P0-6 — The CEO's 3-tier catalogue model was not built
**Where:** `migrations/template/000016_business_catalogue.sql.template`, `000017_business_stock.sql.template`.

The meeting reached a precise agreement (Section 4.2): **Tab 1** raw base products from China, each a system UUID, *no marketing names* — **the only place stock lives**; **Tab 2** styled products, each linked to **exactly one** base UUID, *multiple styled names per base*; **Tab 3** dynamic categories. Selling any styled variant deducts the **base** UUID; **base hits zero → all styled variants go out of stock**. Styling is an **add-on** (base price + style add-on = final price).

Reality: a **flat `products → product_variants`** schema. There is **no base-product table, no styled-product table, no FK linking styled→base, and stock is tracked per variant** (`stock_levels.variant_id`), not per base. Consequently the core invariant the CEO described **cannot occur** — there is no shared base-stock row for multiple styled names to draw down, no OOS cascade, and **no styling-as-add-on price composition** (variants carry flat absolute prices).

**Impact:** This is the data model the entire China→styling→sale traceability rests on, and it's the model the CEO walked through line-by-line. Building storefront/catalogue UX on the current flat model will reproduce exactly the overselling-by-style and traceability problems the meeting set out to eliminate.

**Fix:** introduce `base_products` (UUID, China-origin, stock-bearing) and make `products`/`variants` the *styled* layer with a mandatory `base_product_id` FK; move `stock_levels` to `base_product_id`; compute availability for a styled product from its base; model style as an add-on price component. This is a schema migration + repo refactor — significant, but it is the spec's spine.

---

### 🔴 P0-7 — No pre-order / extended-delivery; stock-out just loses the sale
**Where:** none — grep for `pre.?order|backorder|extended.?deliver|restock` across `src/` and migrations returns nothing.

The meeting (4.4) and spec require: on base stock-out, **don't block the sale** — show a longer delivery window + known restock date, **auto-revert when stock is received**. Reality: out-of-stock yields a `409 INSUFFICIENT_STOCK` at checkout (`stock.service.js:131-141`); there is no pre-order order type, no restock-date field, and no auto-revert on goods receipt. Every stock-out is a lost sale — the opposite of the intent.

**Fix:** add a pre-order/backorder state on the (base) product with an expected-restock date; allow checkout to proceed as pre-order with the extended SLA surfaced; on `receiveStock`, clear the flag automatically.

---

### 🔴 P0-8 — Praxis AI: prompt-injection → unauthorized/financial action, with no execution-time authorization
**Where:** `praxis.orchestrator.js:211-242`, `praxis.service.js:196-229`, `praxis.repo.js:170-183`.

When enabled, the agent exposes every `ai_enabled` catalogue action as an LLM tool (`tool_choice:"auto"`), embeds RAG chunks **and** raw conversation/customer text into the prompt, and on a tool-call **writes a `pending_action` verbatim** — with **no JSON-schema validation** of LLM-supplied args, **no check of the action's `required_permission`** against the user (the column exists, `000012:280`, but is read nowhere), and confidence hard-coded to `0.8`. At confirm time it checks only ownership/expiry — **not** the user's permission for the action. The live orchestrator also bypasses the `entity_scope` filter (`orchestrator.js:137` lists *all* brands' actions), so an FLH conversation can propose a PXG action.

**Impact:** injected text (a customer DM, a product description, a RAG'd document) can drive the model to propose a financial mutation (e.g. "create an intercompany invoice for ₦5,000,000"); any Praxis user can then confirm it regardless of whether they hold the underlying permission. Today the executor is *missing* (confirmed actions execute nothing — itself a broken feature), so the live blast radius is limited — but the guardrails a safe executor needs **do not exist**, making this a P0 to fix **before** anyone wires execution.

**Fix:** validate args against `payload_schema`; enforce `required_permission` against the confirming user at execute time; enforce `entity_scope` against the conversation brand (use the existing `src/ai/action-catalogue.js` facade, which already does this correctly, instead of the raw `governance.listActions`); separate trusted instructions from untrusted retrieved/user content; never let an LLM-generated summary be the only human gate on a financial write.

---

### 🔴 P0-9 — RAG retrieval is not permission-scoped → cross-permission / cross-entity data into prompts
**Where:** `praxis.repo.js:170-183`.

The schema *promises* permission-scoped retrieval (`000012:313-317` + a `required_permissions TEXT[]` column with a GIN index). The actual query filters only `is_active`, `sensitivity IN ('public','normal')`, and `business`. It **never passes or filters by the user's permissions**, and `'normal'` is the column default — so any `normal`-tagged chunk (which could carry `required_permissions = {payroll.view}`) is retrieved for any user and injected into the answer.

**Impact:** salary/cost/other-entity content embedded as knowledge can surface verbatim to users who must not see it — the same privacy breach as P0-1, via the AI surface. **Fix:** pass the user's permission set into `retrieveContext` and filter `required_permissions <@ user_perms`; treat `business` as a hard filter, not an `OR business IS NULL` escape hatch, for entity-scoped content.

---

### 🔴 P0-10 — Upload memory bomb: 200 MB buffered in heap × concurrency → OOM on the 18 GB box
**Where:** `catalogue.routes.js:18-21`, `documents.routes.js:20-23`, `expenses.routes.js:20-23` (all `multer.memoryStorage()` with `limits.fileSize = 200 MB`).

Every upload route buffers the **entire file in V8 heap** before the handler runs (often ~2× transiently with the copy into `storage.put` + a `sha256` over the whole buffer). The video-library upload (`POST /catalogue/media`) is explicitly the 200 MB UGC path. The global rate limit (300/min) **does not cap concurrency**, and at 300 Mbps a 200 MB upload takes ~43 s, so connections **accumulate faster than they drain**. ~9 concurrent 200 MB transfers ≈ ~1.8 GB (×2 transiently ≈ 3.6 GB) of payload heap on a box that is also running Postgres, Redis, the API, and (if mis-deployed) Chromium. **First failure under load is `JavaScript heap out of memory`**, which kills the process and drops every in-flight request.

**Fix:** switch all upload routes to `multer.diskStorage()` streaming to `./uploads/tmp`; process from disk (the worker's ffmpeg path already does this correctly); hash by streaming; cap concurrent large uploads explicitly.

---

### 🔴 P0-11 — No frontend / no storefronts in this repo (the product the customer sees)
This repo is `pixiegirl-hub-backend`; there is **no** `client/`, `web/`, or Next.js app. The meeting's central commitment — **two storefronts** (`pixiegirlglobal.com` GEO-IP multi-currency, and a `faitlynhair.com` reskin) — plus the admin UI, dashboards, Storefront Studio editor, and sales-campaign landing pages **are not here**. The Temu-style **checkout upsell popups**, **quantity-tier cart discounts**, and **bundle composition UX** are storefront concerns with no implementation to audit.

**Impact:** the system cannot be demoed or launched as "the product." More subtly, several backend features assume a frontend that doesn't exist yet (cart pricing, currency switch, video gallery rendering). **Fix:** this is a scope/plan item — either point to the separate frontend workstream and its repo, or budget it explicitly. The flash-sale performance claim lives or dies in that frontend + the edge/CDN in front of it (see §7).

---

## 5. Findings — 🟠 P1 / HIGH

### 🟠 P1-1 — Data-layer entity isolation (RLS) is decorative, and bypassed by the superuser connection
`000200_shared_rls.sql` enables RLS only on ~62 **shared** tables (per-brand schemas have none). `RLS_READ_ENFORCE` **defaults `false`** (`env.js:173`) so one-shot reads are unfiltered. And the app connects as `DB_USER=pixie_app`, which `docker-compose.yml` provisions as the Postgres image's **superuser** — and **superusers bypass RLS entirely**. The boot code itself warns about exactly this (`database.js:66-71`), and the migration's own NOLOGIN `pixie_app` role is never used. Net: the spec's mandated data-layer isolation is **not in effect**; isolation rests entirely on application-layer schema interpolation (which is at least consistently guarded — see §2). **Fix:** connect as a non-superuser without `BYPASSRLS`; decide and document the model (schema-isolation primary + RLS backstop on shared tables, RLS read-enforce on after a staging perf check). Add an integration test asserting FLH staff get zero PXG rows. *(Note: turning `RLS_READ_ENFORCE` on as built wraps every one-shot read in a `BEGIN/SET/SELECT/COMMIT` — a 4× round-trip amplification per read; see P1-8 — so fix the read-path design, don't just flip the flag.)*

### 🟠 P1-2 — `addPayment` isn't idempotent; webhooks ignore per-brand keys and use one shared endpoint
`addPayment` (`sales.service.js:662-808`) trusts its caller and has no idempotency pre-check beyond the order-level unique; any re-invocation with a fresh key **double-books the gateway fee and FX journals** (which have no journal-level dedup — see P1-3). Separately, inbound verification/re-verification uses **env secrets only** (`webhooks.service.js:49,68,210,...`) and there is **one** shared endpoint per gateway (`webhooks.routes.js:37-40`), with brand recovered from payload `metadata.brand`. This contradicts the meeting's explicit requirement of **separate webhooks per brand** and the per-brand encrypted credentials the system already stores. FLH-with-its-own-keys cannot be verified. **Fix:** per-brand webhook endpoints (`/api/webhooks/:brand/:gateway`) selecting the brand's stored secret; make `addPayment` idempotent on a payment-intent key.

### 🟠 P1-3 — Journal idempotency covers only `source_type='sales'`
The partial unique index `journal_entries_sales_src_uidx` (`000204`) protects the sales journal only. **Inter-company, payment-fee, FX-revaluation, and manual** journals have **no DB idempotency guard and no service pre-check**, so a retry/double-submit duplicates them. Combined with P0-2/P1-2 this is a direct route to double-counted revenue/fees in PXG's books. **Fix:** generalize to a `UNIQUE(source_type, source_id)` (or a posting idempotency key) across all posting paths.

### 🟠 P1-4 — Partial payments overstate the bank; amounts trusted from metadata
The sale journal debits cash for the order's **full `total_ngn`** (`accounting.subscribers.js:74-77`) regardless of the **actual amount paid**, and `recordGatewayPayment` takes `amount_ngn` from gateway **metadata** without reconciling against the order's outstanding balance. Deposits/installments (a shipped feature) will therefore mis-state cash and AR. **Fix:** book cash for the actual paid amount; reconcile paid amount to the order server-side before crediting.

### 🟠 P1-5 — Inventory "never oversell" has real holes off the main path
Beyond the safe main checkout: (a) **cart reserves nothing and checks no stock** (`cart.service.js`) — 500 shoppers can load the last unit; (b) **layaway "reservations" don't hold stock** — they're best-effort/try-swallowed and `deductForSale` checks `on_hand`, not `available` (`stock.service.js:130`, `sales.service.js:578-600`); (c) **consignment/admin/production deduct via raw `recordMovement`** with no lock (`partners.service.js:222-240`); (d) the dedicated `stock_reservations` table (with `expires_at`) is **dead code** — no cart/checkout hold exists. **Fix:** implement Redis- or DB-backed reservations with TTL at cart/checkout; deduct against `available`; route every stock mutation through the locked path.

### 🟠 P1-6 — `cart.service.js` queries columns that don't exist → cart broken (schema drift)
`cart.service.js:73-77,238-241` selects `pv.price_ngn`, `p.product_name`, `pv.variant_label`, `pv.thumbnail_url`, and filters `pv.is_active`/`p.is_active` — none of which exist in `000016` (correct names are `price_storefront_ngn`, `name`, `variant_name`; products have `is_deleted`/`is_visible_storefront`, no `is_active`). Sibling repos use the right names, so the cart module is an outlier that will throw `42703 undefined_column` at runtime. **Fix:** reconcile cart repo column names; add a smoke test that adds an item to a cart.

### 🟠 P1-7 — No clustering: the "flash-sale" storefront API runs on **1 of 8 cores**
There is no `cluster`, PM2 ecosystem, or multi-instance config anywhere; the API is a single Node process. The Socket.io Redis adapter ("for horizontal scaling") is wired but **unused** (one instance). On an 8-vCPU box this caps request throughput at a single core while 7 sit idle for HTTP. **Fix:** run the API under PM2 cluster (or `node:cluster`) with 3–4 instances behind nginx; the Redis adapter already supports it. (See §7 for counts and the pool-math caveat.)

### 🟠 P1-8 — "Cache a lot / speed-of-light" is contradicted: Redis caches nothing on the hot path
`redis.js:5` advertises caching of "FX rates, hot product reads, action catalogue" — **none of these are cached**. Every storefront product read, every FX conversion (`business-setup.repo.js latestRate`), and every Praxis action-catalogue load hits Postgres directly; `findActionByKey` pulls the whole catalogue and `.find`s in JS per turn. The only Redis usage is sessions, queues, and Socket.io pub/sub. The CEO's explicit mandate ("cache a lot, speed-of-light loads, minimize memory") is unmet. **Fix:** add a real cache layer (product detail/list with short TTL + explicit invalidation on catalogue/stock write; FX latest-rate TTL ~1 h; action catalogue invalidated on governance write), with stampede protection. **Keep stock live** (or use atomic Redis counters) — do not cache stock into a stale-oversell.

### 🟠 P1-9 — No media-serving layer; the one byte path buffers whole files with no Range
`storage.put` returns `/media/<key>` URLs but there is **no `express.static`, no `sendFile`, no streaming, no nginx config, and `CDN_BASE_URL` ships empty** — so in the default config storefront media **404s**. The only byte-emitting route (`GET /documents/:id/download`) does `storage.get()` → `res.send(buffer)` — whole file into heap, **no `Accept-Ranges`** (so no video seeking), no size cap (a 200 MB video persisted as a document is downloadable through it). The spec's headline "native self-hosted video galleries (no YouTube/Instagram iframes)" has **no way to serve bytes**. **Fix:** serve `/media` via nginx (`sendfile`, `aio`, Range) or a CDN; stream downloads via `createReadStream(...).pipe(res)` with Range (or nginx `X-Accel-Redirect`); never let Node stream large media.

### 🟠 P1-10 — Rate limiting is in-memory (per-process), so it doesn't hold
`express-rate-limit` is configured with **no `store`** (`middleware/index.js:82,103`) → default `MemoryStore`. With the API + worker (and any future cluster instances) as separate processes, limits are per-process — the effective global limit is `N×max`, and the **public-write abuse limiter** (checkout, newsletter, hair-quiz, e-sign) is defeated by simply having >1 process. **Fix:** back both limiters with the Redis store (`rate-limit-redis`), which is already available.

### 🟠 P1-11 — PDF rendering is broken in the production image
`pdf.service.js` uses Puppeteer headless Chromium, but the `Dockerfile` (`node:20-alpine`) installs only `ffmpeg`/`postgresql-client`/`tini` — **no `chromium`** — and Puppeteer's bundled Chromium is glibc, incompatible with Alpine musl, with no `PUPPETEER_EXECUTABLE_PATH` set. Renders will throw `PDF_UNAVAILABLE` (503). Every PDF artifact — **invoices, payslips, delivery notes, contracts, e-sign documents** — fails to generate. **Fix:** `apk add chromium nss freetype harfbuzz ttf-freefont` and set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`, or render PDFs in a dedicated worker; consider a lighter HTML→PDF path for high-volume invoices (Chromium is ~150–300 MB resident per instance — keep it off the API process entirely).

### 🟠 P1-12 — Postgres is untuned; workers default to in-process; ffmpeg concurrency can peg the box
No Postgres tuning exists anywhere — the box would run **stock pg16 defaults (~128 MB `shared_buffers`)** on 18 GB of RAM, leaving the DB starved while RAM sits unused. `ENABLE_WORKERS` **defaults `true`** (`env.js:166`), so a bare `npm start` on the VPS runs the web server **plus** all crons, the outbox poller, ffmpeg transcodes, and Chromium in one process. `media-processing` worker concurrency is **4** (`worker.js:84`) — four simultaneous ffmpeg transcodes will saturate the 8 vCPUs and starve request handling. **Fix:** tune Postgres (see §7); make `ENABLE_WORKERS` default `false` and run the worker as a separate process (compose already does — but protect the bare-metal path); set media concurrency to 1–2.

### 🟠 P1-13 — Real-time HR earnings & "X away from your bonus" — the meeting centerpiece — isn't built
The meeting's emphasis was a **live** employee dashboard: monthly salary pro-rated to a **daily accrual that builds as days pass**, **lateness deductions shown the same day**, and a **live performance countdown** ("you are 20 styles away from your bonus"). The code has a solid **month-end payroll-run calculator** (`payroll.calc.js` — PAYE bands, config-driven deductions) but **no daily-accrual/real-time earnings tracker and no live target-countdown** logic. As the CEO put it, the real-time visibility *was the whole point* (the motivational lever to get staff to accept structure). **Fix:** add a daily-accrual read model (or a cheap computed endpoint) for projected earnings/deductions-to-date and target progress, fed by attendance + sales/service events.

### 🟠 P1-14 — Tests cover ~1.5% of a money-moving, multi-tenant system
Tests have grown since the internal audit (now 12 files / ~1,113 LOC, including **integration** tests for `gl-balance`, `entity-isolation`, `rbac-matrix`, `payroll.calc`) — credit for that. But for ~72 K LOC that posts to a general ledger and isolates two companies' books, this is far below bar. CI green currently certifies almost nothing about the revenue→GL path, reserve/deduct, inter-company settlement, or the privacy guarantees. **Fix:** treat the P0/P1 list as a test backlog — each fix lands with a test that would have caught the bug (Stripe double-credit, IC one-sided post, cost-leak to Sales Rep, oversell on side paths).

---

## 6. Findings — 🟡 P2 / MEDIUM and 🟢 P3 / LOW

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| P2-1 | 🟡 | **No brute-force lockout**: `recordFailedLogin` increments but never locks; only the (per-process, P1-10) global limiter throttles login | `auth.service.js:72-77` | Lock after N fails / exponential backoff; Redis-backed per-account+IP throttle |
| P2-2 | 🟡 | **Refresh doesn't re-check user status** — a disabled/locked user keeps minting access tokens for up to 14 days | `auth.service.js:116-160` | Re-load + check `status` on refresh |
| P2-3 | 🟡 | **Referral ≥8-purchase eligibility gate missing** — `getOrCreateReferral` creates codes unconditionally; the threshold that *defines* the feature (CEO: "only genuinely loyal customers become referrers") isn't enforced | `retention.service.js:198-227` | Gate code issuance on cumulative paid-wig count ≥ configurable threshold |
| P2-4 | 🟡 | **Document numbering lock held for the caller's whole transaction** → serializes *all* numbered-doc creation per brand under flash-sale load (gapless, but a throughput choke) | `numbering.service.js:36-66` | Allocate the number in a short dedicated txn, or use a gapless-but-batched allocator |
| P2-5 | 🟡 | **Float creep** at FX revaluation + gateway edges (`parseFloat`/`Number`) violates the "always Decimal" rule | `accounting.service.js:649-655` | Wrap in `decimal.js` end-to-end |
| P2-6 | 🟡 | **No metrics/APM**; `/health` is shallow (no DB/Redis probe); no readiness endpoint; `SENTRY_DSN` optional/unset | `routes/index.js:103`, `env.js:128` | Add `/readyz` (checks pool+redis), Prometheus metrics, wire Sentry in prod |
| P2-7 | 🟡 | **Per-process `roleIdCache` never invalidated** → stale role IDs / cross-process drift after role recreation | `workflows/engine.js:58-69` | TTL + invalidate on role change, or move to Redis |
| P2-8 | 🟡 | **AI budget caps are post-hoc & racy**; soft cap never enforced; concurrent turns all pass the gate before any ledger row lands → overspend past the ₦80 k hard cap | `governance.service.js:204-222`, `000012:141-163` | Pre-flight estimate + reservation; per-user rate limit |
| P2-9 | 🟡 | **Embeddings pipeline inert**: nothing ever enqueues `ai-embed`; no re-embed on source change/delete (stale/orphan vectors); `rag-reembed.js` is a `TODO` stub; `vector(1536)` hard-coded (model change throws) | `worker.js:79`, `scripts/rag-reembed.js:12`, `000012:396` | Enqueue on source writes; build the re-embed tool; make dimension configurable |
| P3-1 | 🟢 | Deep `OFFSET` pagination degrades on large lists | storefront/catalogue repos | Keyset pagination on hot lists |
| P3-2 | 🟢 | `ivfflat` index present but `probes` never set + filters around ANN → poor recall when enabled | `000012:424-426` | Set `ivfflat.probes`; consider HNSW |
| P3-3 | 🟢 | Public list uses 2 correlated subqueries/row (price + image) | `storefront.repo.js:42-57` | Denormalize `from_price`/`primary_image` columns |
| P3-4 | 🟢 | `safeName` action-name collisions can misroute an AI tool-call; OPay HMAC canonicalization brittle; global `compression()` runs on the byte path | `orchestrator.js:34-43`, `opay.service.js:127-133`, `middleware/index.js:46` | Uniqueness guard; verify OPay signing; `compression` filter excludes downloads |

---

## 7. Capacity & infrastructure plan for `hub.pixiegirlglobal.com` (8 vCPU / 18 GB / 240 GB / 300 Mbps)

The single biggest infra risk is **everything on one box with no proxy, no cache, no clustering, and untuned Postgres**. The meeting explicitly sized the box for "two storefronts + full ERP at comfortable headroom" — that requires the layout below, not the current single-process compose.

**Target process topology (single VPS):**
```
                       ┌─────────── nginx (TLS, gzip/brotli, /media sendfile+Range, X-Accel) ───────────┐
  Cloudflare (CDN/WAF) │   ├─ Next.js storefront(s)  (separate repo; SSR/ISR, edge-cached product pages) │
  edge-caches product, │   └─ /api → PM2 cluster: 3–4× Node API instances  (HTTP only, NO workers)      │
  static, media        └──────────────┬─────────────────────────────┬──────────────────────────────────┘
                                       │                             │
                              pgbouncer (transaction pooling)   Redis (cache + queues + pub/sub + rate-limit store)
                                       │                             ▲
                                  PostgreSQL 16 (tuned)         1× Worker process (BullMQ, crons, ffmpeg≤2, Chromium, outbox)
```

**Memory budget (fits 18 GB with discipline):**
| Component | Allocation | Notes |
|---|---|---|
| PostgreSQL | ~6 GB | `shared_buffers=4GB`, `effective_cache_size=12GB`, `work_mem=32–48MB`, `maintenance_work_mem=512MB`, `max_connections=100` |
| Redis | 1.5 GB | `maxmemory 1.5gb`, `maxmemory-policy allkeys-lru` (cache) — keep queue data on a separate logical DB |
| API cluster | 3–4 × ~0.6–1 GB | HTTP only; `--max-old-space-size≈768`; **no** ffmpeg/Chromium here |
| Worker | 2–3 GB | ffmpeg (concurrency 1–2) + 1 Chromium for PDFs + outbox |
| OS / nginx / headroom | ~2 GB | |

**Database connections (the cluster foot-gun):** pool `max=20` per process × 4 API + worker = up to 100 — at the default ceiling with zero headroom. **Put pgbouncer in transaction mode in front of Postgres** and set the app pool small (e.g. `max=8` per instance). This decouples app concurrency from backend connections and is essential before clustering.

**Postgres tuning (none exists today):** ship a tuned `postgresql.conf` (the numbers above) via the compose image or a config mount; run `ANALYZE` after bootstrap; add the missing hot-path indexes; enable `pg_stat_statements` to find the real slow queries under load.

**Caching layer (the CEO's "cache a lot"):** Redis cache for product detail/list (TTL 30–120 s + **explicit purge on catalogue/stock/price write**), FX latest-rate (TTL ~1 h), and the action catalogue (purge on governance write); single-flight/stampede protection on misses. **Stock stays authoritative in Postgres** (or atomic Redis counters reconciled to PG) — never cache stock into a stale oversell.

**Media (P1-9):** put media behind nginx `location /media { sendfile on; aio threads; }` with Range support, or front it with Cloudflare; set `CDN_BASE_URL`. Switch uploads to `diskStorage`. Node must never stream a 200 MB video.

**Flash-sale survival (the headline promise):** the storefront read path must be **edge-cached** (Cloudflare) with cache-purge on price/stock change so a spike hits the CDN, not Postgres; checkout writes go through the locked stock path (already correct) behind the Redis-backed rate limiter; consider a brief Redis-backed stock reservation at "add to cart"/"checkout" so the cart-stage UX matches the "never oversell" promise. Load-test to a target (e.g. 500 concurrent checkouts on one SKU) **before** a real drop — the correctness is there on the main path; the throughput and caching are not yet.

**Isolation hardening (P0-1, P1-1):** connect the app as a **non-superuser** role; use the per-transaction GUC/`SET ROLE` choke point already in `database.js` to (a) make RLS actually apply on shared tables and (b) switch to the `view_*_public` projections for users without sensitive grants. Decide explicitly: schema-isolation is the primary control, RLS/field-views are the backstop — document it and test it.

---

## 8. Conformance scorecard

**Legend:** ✅ built & matches · 🟡 partial / config / wiring gap · 🔴 missing or materially broken · (UI) needs the absent frontend.

### 8.1 Meeting decisions (the final word)
| Meeting decision | Status | Note |
|---|---|---|
| Two storefronts (PXG + FLH reskin), Next.js | 🔴 | Neither exists in this repo (P0-11) |
| GEO-IP → local currency, one PXG storefront serves NG + intl | 🟡 (UI) | Maxmind wired; live FX **off by default** (`FX_PROVIDER=none`); no frontend |
| 3-tier catalogue (Raw-base UUID → Styled → Category), stock at base | 🔴 | Flat products→variants; stock at variant (P0-6) |
| Styling as an add-on (base + add-on = price) | 🔴 | Not modeled (P0-6) |
| Pre-order / extended delivery on stock-out, auto-revert | 🔴 | Not implemented (P0-7) |
| Separate Stripe webhook per brand; separate settlement | 🟡 | One shared endpoint, env-only keys (P1-2) |
| FLH intl via PXG Stripe with internal brand code | 🔴 | No brand code in metadata to attribute FLH revenue |
| Payroll: approve → **PIN** → auto bank payout (Nomba/Flutterwave) | 🔴 | Status-flip stub; no PIN; no disbursement; no GL (P0-5) |
| Real-time earnings + lateness + "X away from bonus" | 🔴 | Month-end calc only; no real-time tracker (P1-13) |
| Ops-Manager-confirmed completion + quality rating → delivery | 🟡 | Service-jobs/quality present; auto-handoff partial |
| Geolocation clock-in (IP + geo + timestamp) | ✅ | Server-side geofence check, append-only events |
| Referral unlocks after **≥8 purchases**; commission; history | 🟡 | Referral/commission plumbing yes; **8-purchase gate missing** (P2-3) |
| Loyalty points accrue → threshold discount → POS redemption | 🟡 | Accrual + redemption present; POS real-time path partial |
| Bundles (fixed composition, per-wig ₦ discount), Temu upsell, qty tiers | 🟡 (UI) | Backend campaign/discount models exist; cart-stage UX absent; bundle-composition enforcement unverified |
| Inter-company invoice/purchase pairs in both books | 🔴 | One-sided posting possible; no stock move; floor unenforced (P0-3/P0-4) |
| Server sized for 2 storefronts + ERP with headroom | 🟡 | Box is adequate **only** with the §7 topology; current single-process/no-cache/no-tuning won't deliver it |

### 8.2 Product Description v2.2 modules (backend)
CRM ✅ · Sales+installments ✅ (math untested) · POS ✅ · **Storefront/multi-currency/UGC 🟡(UI)** · Invoicing/Accounting/Expenses/Purchasing ✅ (double-entry real) · **Stock SSOT ✅ main path / 🔴 model & side paths** · Logistics+tracking ✅ · **HR/payroll 🟡→🔴 (real-time & disbursement)** · Contacts/Documents/e-sign ✅ (PDF render broken in prod, P1-11) · Social/Marketing/Email/Smartcomm 🟡 (key-dependent) · Calendar/Tasks/Dashboards 🟡 · Business Setup ✅ · Sales Campaigns 🟡(UI) · Retention ✅ (largest, strong) · Production/landed-cost ✅ · Pricing/goal-seek ✅ (untested) · Stylist Programme ✅ · Org/Workflow ✅ · Storefront Studio 🟡(UI) · **Praxis AI 🔴 (injection/authz/leak; executor missing)** · AI Insights ✅ · AI Governance ✅ (encryption solid) · Cash Request ✅ · **Access Matrix ✅ engine+seed / 🔴 field privacy** · **Frontend 🔴** · **Tests 🔴(thin)**.

---

## 9. Prioritized remediation roadmap

**P0 — before any launch or real data (do these first):**
1. Enforce field privacy (cost & salary) at the app/serializer layer + regression test (**P0-1**).
2. Fix the Stripe double-credit + generalize journal idempotency (**P0-2, P1-3**).
3. Make inter-company atomic across both entities; enforce the margin floor; move inventory PXG→FLH (**P0-3, P0-4**).
4. Implement payroll PIN + idempotent disbursement + payroll GL posting (**P0-5**).
5. Lock down Praxis: arg validation, execute-time `required_permission`, `entity_scope`, permission-scoped RAG — *before* wiring any executor (**P0-8, P0-9**).
6. Stream uploads to disk (kill the OOM) (**P0-10**).
7. Decide the 3-tier catalogue + pre-order model now (schema migration) so the storefront isn't built on the wrong spine (**P0-6, P0-7**).

**P1 — before real traffic / scale:**
8. Non-superuser DB role + RLS/field-view backstop + isolation test (**P1-1**).
9. Per-brand webhooks; partial-payment GL correctness (**P1-2, P1-4**).
10. Fix cart (broken columns) + real cart/checkout reservations + lock all stock mutations (**P1-5, P1-6**).
11. Infra topology: PM2 cluster + nginx + pgbouncer + Postgres tuning + Redis cache layer + media via nginx/CDN + Redis rate-limit store + fix Alpine Chromium + workers out-of-process (**P1-7…P1-12**).
12. Real-time HR earnings/countdown (**P1-13**); expand tests alongside every fix (**P1-14**).

**P2/P3 — hardening:** brute-force lockout, refresh status re-check, referral 8-gate, numbering contention, decimal discipline, observability, AI budget pre-flight, embeddings pipeline, keyset pagination, ivfflat tuning. (§6.)

---

## 10. Appendix — evidence index (high-signal file:line)

- Isolation/RLS: `migrations/000200_shared_rls.sql`; `src/config/database.js:66-71,94-178`; `src/config/env.js:166,173`; `docker-compose.yml:8-9`; `src/config/brands.js:54-81`.
- Field privacy: `migrations/template/000038_business_field_privacy.sql.template`; `migrations/000207_shared_access_matrix_seed.sql:41-43`; `src/modules/catalogue/catalogue.repo.js:72-76`; `src/middleware/rbac.js`.
- Money/IC/payments: `src/modules/accounting/accounting.service.js:74-80,649-655`; `accounting.subscribers.js:74-77`; `src/modules/intercompany/intercompany.service.js:84,97-151`; `src/modules/business_setup/webhooks.service.js:49,68,386-419`; `migrations/template/000019_*:419-425`; `000204/000205`.
- Inventory/catalogue: `migrations/template/000016/000017`; `src/modules/stock/stock.repo.js:166-175`; `stock.service.js:109-174`; `src/modules/storefront/cart.service.js:73-77`; `src/modules/sales/sales.service.js:578-600,843-853`.
- Payroll/HR/attendance: `src/shared/hr_payroll/payroll.service.js:276-331`; `payroll.calc.js`; `payroll.routes.js:27`; `src/shared/attendance/*`.
- AI/RAG: `src/modules/praxis_ai/praxis.orchestrator.js:34-43,137,211-242`; `praxis.service.js:196-229`; `praxis.repo.js:170-183`; `src/services/embeddings.service.js`; `scripts/rag-reembed.js:12`; `migrations/000012_shared_ai.sql`.
- Perf/memory/infra: `src/services/storage.service.js:36-38`; `src/shared/documents/documents.controller.js:54-62`; `*/*.routes.js` multer (`catalogue:18-21`, `documents:20-23`, `expenses:20-23`); `src/middleware/index.js:46,82-94,103-112`; `src/config/redis.js:5`; `Dockerfile`; `docker-compose.yml`; `src/jobs/worker.js:84`.

---
*Prepared as an independent Principal-Engineer review. Findings are evidence-based against the committed code; where intent is cited it is from Product Description v2.2 and the CEO meeting minutes. The strengths in §2 are real — the remediation roadmap is designed to protect them while closing the launch blockers.*
