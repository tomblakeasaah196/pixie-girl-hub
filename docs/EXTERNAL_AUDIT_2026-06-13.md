# Pixie Girl Hub — Deep External Audit (Brutal)

**Date:** 2026-06-13
**Auditor scope:** The entire repository on disk vs. `docs/Final_PixieGirl_Hub_Product_Description_v2.2 (3).html` (the V2.2 Product Description, "the spec"), treating the spec as the source of truth.
**Method:** Native file reads (authoritative) + deep sampling of the money/identity/AI paths + cross-checking the team's own audit docs against the code. Where bash was used, results were re-verified natively (see the methodology caveat — it matters).

---

## 0. Verdict

This is a **genuinely substantial, well-architected backend** — far more real than most "ERP" codebases that come with a 300-page spec. ~50,000 lines across 30 cleanly-layered modules, all mounted, with a real double-entry ledger, a real inventory SSOT, real inter-company books, a real RBAC engine, and a real (if single-agent) AI orchestrator. The team's own internal audit docs are unusually honest.

But measured **brutally against the product description**, it is **not a finished product, and not independently verified to be correct**. Three things keep it from being trustworthy in production today:

1. **There is no frontend at all.** The spec describes a complete user-facing product (storefront, admin UI, dashboards, theme editor, landing pages). This repo is backend-only. The entire UI layer — the thing the customer actually sees — does not exist here.
2. **There is effectively no automated test coverage.** ~297 lines of tests guard ~50,000 lines of money-moving, multi-tenant code. Every "verification" in the docs is _static reading_, never execution. For a system that posts to a general ledger and isolates two companies' books, this is the single biggest real risk.
3. **The spec's centrepiece access-control matrix is machinery-only.** The RBAC _engine_ is good; the actual Role×Module _grants_ for CEO / Ops Mgr / Sales Rep / Stylist / etc. are not seeded. Only `owner` is seeded, and `owner` bypasses checks anyway.

**Grade against the product description: ~55–60% complete.** The backend domain logic is roughly 75–80% there and good quality; the product as specified (UI + verification + role config + a few flagship AI behaviours) is much less.

---

## 1. Methodology caveat you must know about

**The Linux/bash sandbox mount serves _truncated copies_ of recently-edited files.** Running `node --check`, `eslint`, `jest`, or `git` _inside bash_ reported **9 "syntactically broken" files** and a failing lint — all of it **false**. Reading the same files through the native filesystem shows them **complete and valid** (e.g. `pos.service.js` ends cleanly at `voidTransaction` line 721; bash saw it cut off at `listTransaction` line 719).

This is not a defect in your repo — your committed code and your working tree are fine. But it has two consequences:

- Any audit (including the prior ones) that runs tooling through this mount will see phantom corruption. `REVENUE_FLOW_VALIDATION.md` already noticed this ("the bash mount serves truncated copies of fresh files so it is not used for validation") and wisely switched to static review.
- It is almost certainly **why your own verification has stayed static** and your test suite never grew — the team couldn't trust execution in this environment. Real CI on GitHub does _not_ have this problem (it checks out clean files), so that's where execution-level confidence has to come from.

Every finding below was confirmed by **native reads**, not bash tooling.

---

## 2. What is genuinely solid (credit where due)

| Area                               | Evidence                                                                                                                                                                                                                                                                             | Verdict                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| **Architecture**                   | 30 modules, uniform `routes → validator → controller → service → repo → events → subscribers`; all mounted in `src/routes/index.js`; `server.js` has proper drain-ordered graceful shutdown + crash-exit non-zero                                                                    | Strong                                  |
| **Double-entry accounting**        | `accounting.service.js` resolves account codes, **asserts debits = credits**, throws `JOURNAL_UNBALANCED` (~L76); per-account/date GL queries in `accounting.repo.js`                                                                                                                | Real ledger, not a stub                 |
| **Stock as SSOT**                  | `sales.service.js` calls `reserveForOrder` (L584) and `deductForSale` (L843); `stock.service.js` is a full movement ledger (sale/receive/reserve/release/adjustment/transfer_in/out); new variants auto-seed a stock level via `catalogue.variant.created` subscriber                | Conformant with §6.9                    |
| **Inter-company / separate books** | `intercompany.service.js`: `recordTransaction → matchTransaction → settleTransaction → openReconciliation` + per-brand journals (`postBrandJournal`)                                                                                                                                 | Real two-book model (§5.1)              |
| **Revenue funnels to Sales**       | POS, public order-form, Paystack webhook, coupons, campaigns all resolve into `sales_orders` → `order.paid` → outbox → GL (cross-checked against `REVENUE_FLOW_VALIDATION.md` and the stock/sales wiring)                                                                            | "Nothing flows in a silo" largely holds |
| **RBAC engine**                    | `access.catalog.js` enumerates **36 enforced module keys** + `settings`; action scopes; `is_ceo` bypass; approval thresholds match spec (expenses > ₦200k, price → CEO, cash > ₦20k — `RBAC.md` L78–80); escalation guards on system roles                                           | Engine is good                          |
| **Praxis orchestrator**            | `praxis.orchestrator.js`: real RAG retrieve → LLM tool-calling over the `ai_enabled` action catalogue → **writes become human-in-the-loop `ai_pending_actions`** → run-step tracing → token/cost ledger; vendor creds from encrypted governance store; graceful no-op when no vendor | Real, if single-agent                   |
| **Data-integrity plumbing**        | Transactional outbox, order/journal/webhook idempotency migrations, RLS _policies_, pgvector embeddings table                                                                                                                                                                        | Present and considered                  |
| **Migrations**                     | 40+ shared + per-business templates covering cash request, e-signature, streak stars, hair quiz, UGC, field-privacy, payment gateways                                                                                                                                                | Schema is broad and matches V2.2        |

The earlier worry (from `VERIFICATION_REPORT.md`, dated 2026-06-08) that many modules were "~350-line skeletons" **no longer holds** — the smallest module now is `intercompany` at 558 LOC and most carry 1,000–4,000 LOC of real logic.

---

## 3. Brutal findings (severity-ranked)

### 🔴 H-1 — No frontend exists; the entire UI layer of the product is absent

The spec is a _product_ description: storefront, no-login order form UI, rich product pages, admin dashboards, theme/Storefront Studio editor, sales-campaign landing pages, retention dashboards. This repo (`pixiegirl-hub-backend`) contains **zero** client/UI code — no `client/`, `frontend/`, `web/`, `public/` app. `FRONTEND_SCREEN_REQUIREMENTS.md` (53 KB) and `ADMIN_UI_REQUIREMENTS.md` (30 KB) are _requirements_, not implementations. If UI is a separate workstream, fine — but against the product description, the single largest surface area has **no code here**.

### 🔴 H-2 — Effectively no automated tests; correctness is unproven

Four test files, **~297 LOC total** (`tests/unit/utils/money.test.js`, `.../access/access.test.js`, `.../sales_campaigns/campaigns.test.js`, `tests/integration/health.test.js`) for ~50K LOC. **No** test exercises the revenue→GL posting, the reserve/deduct stock path, inter-company settlement, RLS isolation, or the installment/coupon math. CI (`/.github/workflows/ci.yml`) spins up Postgres+Redis, migrates, and then runs `npm test` — i.e. a green build certifies four trivial unit tests. **The ledger has never been proven to balance under test.** For money + multi-tenant isolation, this is the finding I'd fix first.

### 🟠 H-3 — The spec's authoritative Access Matrix is unseeded (only `owner`)

§3 calls the Role×Module matrix "the authoritative permission map the developer builds against." In code, `migrations/000015_shared_seed_data.sql` seeds full permissions for **`owner` only**; the named spec roles (CEO+Finance, HR/Admin, Ops Mgr, Sales Rep, Technical/Stylist, Marketing+Partnerships, Security, China Production Mgr) get role rows but **not their per-module grants**. `RBAC.md` admits this ("non-owner roles should be granted…", "owner seed still uses some abbreviated keys"). Because `owner`/CEO bypasses checks, the gap is invisible in demos but means **the actual access policy described in the spec is not enforced for any non-owner role** until seeded.

### 🟠 H-4 — Entity isolation via RLS is not actually on for reads

The spec is explicit: isolate "at the data layer (row-level security on `entity_id`), **not only the UI**." Per `MASTER_BUILD_PLAN.md` (H-1) and `CONFORMANCE_GAPS.md` (C-1): RLS policies exist; the **write path** sets the brand GUC; the **read side is behind `RLS_READ_ENFORCE`, default OFF**. So today cross-entity read isolation rests on application-layer scoping, not the database guarantee the spec demands. Your own docs flag this — it's not hidden — but it's still a "spec says data-layer, prod runs app-layer" gap.

### 🟠 H-5 — Praxis is a single orchestrator, and can't actually query your live data

- §8.2 specifies a **multi-agent** engine (Orchestrator, Action, Query, Insights, Drafting). The implementation is **one** `orchestrate()` loop. Writes (Action) and free-text reads are handled; that's a reasonable collapse.
- The real functional gap is the **Query Agent**. The spec says it "translates a question into a parameterised, permission-scoped query, runs it, and summarises." The code answers read questions **only from RAG-retrieved knowledge chunks** (embedded docs/SOPs) — it never runs a scoped query against business tables. So "What did we sell today?" is answered from embedded _documents_, not from `sales_orders`. The headline "ask the Hub anything about your data" behaviour is **not implemented**.

### 🟠 H-6 — RAG is inert out of the box; "local/effectively free" only half-holds

§8.4 frames RAG as local and cheap. The **vector store is local** (pgvector in Postgres ✓). But **embedding generation is external and OFF by default** — `embeddings.service.js` requires `EMBEDDINGS_PROVIDER` ∈ {openai, deepseek, voyage} + an API key, and returns `null` otherwise. There is **no self-hosted embedding model**, so with default config Praxis retrieves **zero** context. The self-hosted **Whisper** voice path (spec §6.29/§8.2) is referenced (`transcribed_text`, `input_mode`) but I found **no transcription implementation**.

### 🟡 M-1 — Password reset is a stub

`auth.service.js` L136–143: `forgotPassword` and `resetPassword` are empty `// TODO` bodies. A core account-recovery flow is missing (login/refresh/logout are real).

### 🟡 M-2 — A few validators are empty placeholders

`dashboards.validator.js` and `audit.validator.js` contain `// TODO: define required fields for create`. Inputs to those create paths are unvalidated.

### 🟡 M-3 — Known plumbing left half-wired (per your own docs)

Soft-FK reconciliation is **schema-only, no sweep job** (`CONFORMANCE_GAPS.md` C-3); several non-`order.paid` events still emit pre-commit rather than through the outbox (`MASTER_BUILD_PLAN.md` H-2). Real, acknowledged, and not yet closed.

---

## 4. Module-by-module conformance snapshot

Legend: ✅ implemented & matches spec · 🟡 partial / config or wiring gap · 🔴 missing/stub · (UI) needs a frontend not in this repo

| Spec §    | Module                                                            | Backend status | Notes                                                                             |
| --------- | ----------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| 6.1       | CRM / pipeline / 360                                              | ✅             | Instagram chat capture is API-dependent (UI)                                      |
| 6.2       | Sales & quotations, **installments**                              | ✅             | `payment_model` shipped; math untested                                            |
| 6.3       | POS                                                               | ✅             | Real session/checkout/cash-drop; routes to Sales                                  |
| 6.4       | Storefront / multi-currency / UGC                                 | 🟡 (UI)        | Backend + public routes exist; **no storefront UI**; IP→currency needs maxmind DB |
| 6.5–6.8   | Invoicing / Accounting / Expenses / Purchasing                    | ✅             | Double-entry GL is real                                                           |
| 6.9       | Stock SSOT                                                        | ✅             | Movement ledger + reserve/deduct                                                  |
| 6.10      | Logistics / tracking / delivery letter                            | ✅             | Public tracking + install-hub routes present                                      |
| 6.11      | HR / payroll / appraisal / **geo clock-in**                       | ✅             | `attendance/geo.calc.js`; payroll PAYE bands admin-maintained                     |
| 6.12–6.13 | Contacts / Documents + e-signature                                | ✅             | Full e-sign incl. public sign routes                                              |
| 6.14–6.17 | Social / Marketing / Email / Smartcomm                            | 🟡             | Logic present; external channel sends are integration- & key-dependent            |
| 6.18–6.20 | Calendar / Tasks / Dashboards                                     | 🟡             | Dashboards compute server-side; consumption is (UI); `dashboards.validator` empty |
| 6.21      | Business Setup / webhooks                                         | ✅             | Brand registry, payment gateways, webhook receivers                               |
| 6.22      | Sales Campaigns / landing pages                                   | 🟡 (UI)        | Backend + public campaign routes; **landing-page builder UI absent**              |
| 6.23      | Retention (referral/coupon/points/tiers/streak/subscription/quiz) | ✅             | Largest module (30 files); thresholds & tiers seeded                              |
| 6.24      | Production & landed cost                                          | ✅             | Per-wig cost build-up modeled                                                     |
| 6.25      | Pricing engine / goal-seek                                        | ✅             | Goal-seek + sensitivity logic present (untested)                                  |
| 6.26      | Stylist Partner Programme + portal                                | ✅             | Separate JWT portal + public verify route                                         |
| 6.27      | Org & Workflow builder / deputies / thresholds                    | ✅             | `shared/org_workflow` + approvals                                                 |
| 6.28      | Storefront Studio (theme editor)                                  | 🟡 (UI)        | Backend token/block model; **editor UI absent**                                   |
| 6.29      | Praxis AI agent                                                   | 🟡             | Single-agent; no live-data Query agent; RAG off by default (H-5/H-6)              |
| 6.30      | AI Insights & briefings                                           | ✅             | Tier-1 rules + tier-2 narration module exists                                     |
| 6.31      | AI Control & governance                                           | ✅             | Encrypted vendor creds, usage/cost ledger, budgets                                |
| 6.32      | Cash Request & disbursement                                       | ✅             | Full workflow + thresholds + numbering                                            |
| 3         | **Access Matrix (roles)**                                         | 🔴             | Engine ✅, but only `owner` seeded (H-3)                                          |
| 8.x       | **Frontend / Admin UI**                                           | 🔴             | Not in this repo (H-1)                                                            |
| —         | **Automated tests**                                               | 🔴             | ~297 LOC (H-2)                                                                    |

---

## 5. Can you trust the existing audit docs?

Mostly **yes** — and that's worth saying. `VERIFICATION_REPORT.md`, `CONFORMANCE_GAPS.md`, `REVENUE_FLOW_VALIDATION.md`, and `MASTER_BUILD_PLAN.md` are detailed, self-critical, and disclose their own gaps (RLS read-side OFF, soft-FK no sweep, abbreviated permission keys, "no DB/test execution"). They do not whitewash. Two caveats: (1) they consistently validate by **reading**, never by **running**, so they can't catch logic/runtime bugs — only structural ones; and (2) a couple are dated pre-2026-06-08 and understate how much has since been built. Treat them as an accurate map of _structure_, not a proof of _behaviour_.

---

## 6. What I'd do, in order

1. **Prove the money path with tests.** Integration tests (against the CI Postgres) that create an order → pay → assert `sales_orders` state **and** that the GL journal balances; plus POS, coupon, campaign, and Paystack-webhook variants. This retires H-2 and locks in your best work.
2. **Seed the real Access Matrix** for every spec role and add a test asserting a Sales Rep _cannot_ read salaries/cost prices. Closes H-3 and the §3 "cost & pay are private" principle.
3. **Decide and enforce entity isolation.** Either turn on `RLS_READ_ENFORCE` (after the staging perf check your own H-1 note calls for) or document app-layer scoping as the accepted control. Add a test that Faitlyn staff get zero Pixie rows.
4. **Make Praxis honest about scope.** Either build the parameterised, permission-scoped Query agent (H-5) or downgrade the "ask anything about your data" claim; ship a local or default embedding provider so RAG isn't inert (H-6).
5. **Finish auth.** Implement `forgotPassword`/`resetPassword` (H-2/M-1).
6. **Build (or point to) the frontend.** The backend can't be demoed as the product without it (H-1).

**Bottom line:** the engine room is real and largely well-built; what's missing is the proof that it works, the cockpit the customer drives, and the access policy that's supposed to govern it all.
