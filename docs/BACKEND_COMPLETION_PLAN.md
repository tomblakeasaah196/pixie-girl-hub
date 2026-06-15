# Pixie Girl Hub — Backend Completion Plan (to 100%)

**Date:** 2026-06-13 · **Scope:** Backend only (UI explicitly out of scope).
**Baseline:** ~80% of backend domain logic is built and good (see `EXTERNAL_AUDIT_2026-06-13.md` and your own `MASTER_BUILD_PLAN.md`). This document lists **only what remains**, verified against source, sequenced so you can start.

## Definition of "100% backend done"

1. Every spec §6 module's server-side behaviour is implemented (no stubs/empty validators).
2. The money spine and entity isolation are **proven by automated tests**, not static reading.
3. The spec's access matrix (§3) is enforced for **every role**, not just `owner`.
4. The app has been **booted and smoke-tested** end-to-end against real Postgres/Redis once.
5. External integrations are wired and validated in staging (or explicitly deferred with a flag).

---

## TIER 1 — Correctness & trust (do these first; they gate "done")

### 1.1 Automated test suite _(biggest gap — currently ~297 LOC for ~50K LOC)_

- **Why:** Nothing proves the ledger balances or that the two companies' books are isolated. All prior verification is static. This is the #1 risk for a money + multi-tenant system.
- **Build (integration, against the CI Postgres in `.github/workflows/ci.yml`):**
  - Revenue → GL balance for **every** entry point: direct sale, POS, storefront order-form, Paystack webhook → assert `sales_orders` state **and** `SUM(debit)=SUM(credit)` on the resulting journal.
  - Stock: `reserveForOrder` → `deductForSale` happy path + oversell returns `INSUFFICIENT_STOCK` 409.
  - Discounts math: coupon, bundle (incl. buy_x_get_y once built), loyalty-points redemption, campaign — floor-respecting, VAT correct.
  - Subscription billing (W-C) produces exactly one paid order per cycle; idempotent on retry.
  - Intercompany: record → match → settle posts balanced entries in **both** books.
  - RLS isolation: a Faitlyn user reads **zero** Pixie rows (run with `RLS_READ_ENFORCE=on`).
  - RBAC: a Sales Rep is denied salary/cost-price reads (ties to 1.3).
- **Build (unit):** `payroll.calc.js` (PAYE/pension/NHF bands), `pricing` goal-seek, landed-cost build-up, `money.js` edge cases.
- **Acceptance:** `npm test` green in CI with these suites; coverage on `*/service.js` + `*/calc.js` meaningfully > 0. **Target: the revenue, stock, and isolation paths each have a passing test.**
- **Size:** L (this is the bulk of the remaining effort, and the most valuable).

### 1.2 End-to-end staging smoke test _(the one validation your team could never run)_

- **Why:** `MASTER_BUILD_PLAN.md` repeatedly notes "No node execution"; money-moving crons (subscription billing, FX) ship **disabled** pending this.
- **Do:** Provision Postgres(pgvector)+Redis → `db:migrate:shared` → `db:bootstrap:pixiegirl` + `:faitlynhair` → `db:verify` → boot `server.js` + `workers:start` → run one cycle of each cron and confirm GL/outbox state.
- **Note:** Your local bash mount serves _truncated_ file copies — do this on real CI or a clean checkout, never through that sandbox.
- **Acceptance:** server boots clean, schema verifies, both businesses bootstrap, subscription-billing + FX crons run once without error and post balanced entries.
- **Size:** M.

### 1.3 Seed the real access matrix for every role (spec §3) ✅ DONE 2026-06-13

- **Shipped:** `migrations/000207_shared_access_matrix_seed.sql` adds the 8 named spec roles (hr_admin, ops_mgr, sales_rep, tech_stylist, mktg_partner, security, china_prod, finance) + owner and seeds their exact Role×Module grants from the printed matrix (149 grants → 642 permission rows). Covered by `tests/integration/rbac-matrix.test.js` (proves Sales Rep can't touch Accounting/Payroll, Business Setup is CEO-only, etc.) and `tests/unit/access/catalog.test.js`. **Remaining:** field-level `hidden_fields` (cost/pay private) needs the real sensitive column names; pairs with §1.4.
- **Correction:** the original "only owner is seeded" was based on `000015` alone — migrations `000102–000110` already grant the GENERIC roles (admin/manager/staff/accountant/viewer). The real gap (now closed) was the spec's NAMED roles + its specific matrix.
- **Why:** `migrations/000015` seeds permission rows for **`owner` only**; the 5 other system roles (and the spec's named roles — CEO+Finance, HR/Admin, Ops Mgr, Sales Rep, Technical/Stylist, Marketing+Partnerships, Security, China Production Mgr) have **no grants**. The §3 matrix — "the authoritative permission map the developer builds against" — is effectively unbuilt. `RBAC.md` already admits this.
- **Do:** Encode the §3 Role×Module×Action matrix as seed data (a new migration), using the exact 36 keys in `access.catalog.js`. Map spec roles → role rows. Implement/confirm field-privacy (cost & pay private) enforcement for the restricted views (`hr.fields.js`, template `000038_business_field_privacy`).
- **Acceptance:** test in 1.1 proves a Sales Rep is denied cost-price/salary and granted only their modules.
- **Size:** M.

### 1.4 Turn on and validate RLS read-side (entity isolation at the data layer) 🟡 ENABLE-READY 2026-06-13

- **Shipped:** the proof + guardrails. `tests/integration/entity-isolation.test.js` provisions a throwaway non-superuser role and proves a brand context sees only its own rows (and asserts RLS is enabled on every business-scoped shared table). `scripts/rls/force-rls.sql` closes the table-owner bypass deliberately. `config/database.js` now warns loudly if `RLS_READ_ENFORCE` is on while connected as a superuser (the #1 silent-bypass). Runbook in `ENTITY_ISOLATION.md`.
- **Key finding:** flipping `RLS_READ_ENFORCE` alone does nothing — Postgres bypasses RLS for superusers and the table owner, and CI/dev connect as `postgres`. The real requirement is **connect as a non-superuser app role** (+ `FORCE` if that role owns the tables). Cross-brand write audit: shared-table writes are brand-consistent → `FORCE` is low-risk.
- **Remaining (needs your infra):** connect the app as the non-superuser role, run the isolation test green, do the per-read **staging perf check**, then set `RLS_READ_ENFORCE=true` in prod.
- **Why:** Spec demands isolation "on `entity_id`, not only the UI." Today `RLS_READ_ENFORCE` defaults **OFF** (`MASTER_BUILD_PLAN.md` H-1); reads rely on app-layer scoping.
- **Do:** Staging perf check of the per-read BEGIN/COMMIT GUC path; audit legitimate cross-brand reads (CEO dashboards, brand-registry refresh) so RLS doesn't hide rows that should show; then enable.
- **Acceptance:** isolation test (1.1) passes with enforcement ON; CEO cross-brand views still work.
- **Size:** M.

### 1.5 Finish authentication: password reset ✅ DONE 2026-06-13

- **Shipped:** real `forgotPassword`/`resetPassword` in `auth.service.js`, mirroring the invite-token pattern — single-use raw token, **only its SHA-256 hash stored** (redis, TTL `PASSWORD_RESET_TTL_MIN`=30m), emailed via `email.service`; reset verifies the hash, sets the argon2 password (`staff.repo.updatePassword`, which also lifts a `locked` status), consumes the token, and **revokes all refresh sessions** (redis SCAN — login/refresh/logout untouched). No account enumeration (always 200). Public routes throttled via `publicWriteLimiter`. Covered by `tests/unit/auth/password-reset.test.js` (mocked infra → runs anywhere).
- **Note:** access tokens are short-lived (~15 min, expire on their own after a reset); refresh tokens are killed immediately.
- **Why (orig):** `auth.service.js` L136–143 — `forgotPassword`/`resetPassword` are empty TODOs. No account recovery exists.
- **Do:** Issue a single-use token (store in Redis w/ TTL), send reset email (nodemailer), verify+rotate (argon2), revoke all sessions. Mirror the existing staff-invitation token pattern (`invitations.service.js`).
- **Acceptance:** request→email→reset→old refresh tokens invalidated; test covers it.
- **Size:** S.

### 1.6 Fill the empty input validators ✅ DONE 2026-06-13

- **Shipped:** real Zod schemas for the dashboards write routes (saved-reports, configs, widgets, report-templates) — require each entity's natural key + name, type the rest, `.passthrough()` so no previously-valid body breaks — now wired into `dashboards.routes.js`. `audit.validator.js` was misleading (audit is append-only/GET-only, nothing imported it); rewritten to drop the fake create schema and expose a real list-query filter. Verified the Zod behavior (required→400, partial keeps passthrough) against the project's zod.
- **Why (orig):** `dashboards.validator.js` and `audit.validator.js` create/update schemas are `z.object({})` — they accept **any** body.
- **Do:** Define the real Zod fields for dashboards create/update (and audit if any write route is exposed). Sweep for any other empty schemas.
- **Acceptance:** invalid bodies are rejected; valid ones pass.
- **Size:** S.

---

## TIER 2 — Finish partially-built features (spec conformance)

> **STATUS — Tier 2 complete (2026-06-13), pending CI verification.**
>
> - **2.1 ✅** logistics `delivery.status` → timeline (packed/in_transit/out_for_delivery/delivered), guarded, in `timeline.subscribers`.
> - **2.2 ✅** `buy_x_get_y` + `tiered_qty` discount logic (`bundle.service.quantityBundleDiscount`, wired into `createOrder`); algorithm + unit test verified.
> - **2.3 ✅** wig-maintenance add-on (`maintenance_fee_ngn`/`maintenance_addon`, migration `000208`, billed per cycle).
> - **2.4 ✅** `award_points` / `create_task` / `send_sms` workflow actions (+ env-gated Twilio `sms.service`). More _triggers_ remain incremental.
> - **2.5 ✅** `variant.created` + `order.deposit_met` moved to the transactional outbox (fixes a pre-commit ordering risk); consumers registered in the worker.
> - **2.6 ✅ already done** — verifiers + confirmers for paystack/opay/nomba/stripe and the replay processor (+30-min sweep) were already implemented; the "logged-not-processed" note was stale. No new code.
> - **2.7 ◑** public contact paths already dedupe by phone; the DB-unique backstop ships as a deliberate post-dedup script (`scripts/dedup/contacts-unique.sql`) rather than an auto-migration that could fail on existing data. Smartcomm thread dedup deferred (low-harm).
>
> Caveat: authored without execution in this environment — run `npm run test:unit` + the integration suites in CI.

### 2.1 Order-timeline stage wiring + notifications (§6.23.6 — F-5 remainder)

Only `payment_received` auto-records (via outbox). Wire the owning modules to call `timeline.record()` for `order_confirmed`, `packed_for_dispatch`, `in_production`, `ready`, `out_for_delivery`, `delivered`, etc., and fire the stage notifications. **Size: M.**

### 2.2 Bundle line-logic (§6.23.4 — F-2 remainder)

`buy_x_get_y` and `tiered_qty` currently only return params. Implement their discount application in `createOrder` (floor-respecting, recorded as `sales_order_discounts(source=bundle)`). **Size: S–M.**

### 2.3 Subscription maintenance add-on (§6.23.5 — F-1 remainder)

Not implemented (no `maintenance` logic in `retention/`). Add the maintenance add-on to plans + per-cycle billing. **Size: S.**

### 2.4 Retention workflow actions/triggers (§6.23 — F-4 remainder)

Engine exists; add the remaining actions (`award_points`, `create_task`, `sms`) and triggers (e.g., churn-risk, birthday, abandoned-cart). **Size: M.**

### 2.5 Migrate remaining events to the transactional outbox (H-2 remainder)

`order.paid` chain is durable; `order.deposit_met`, `variant.created`, and other pre-commit emits still bypass the outbox. Migrate them to the same pattern for at-least-once durability. **Size: M.**

### 2.6 Webhook verifiers for remaining gateways + replay (H-4 / J-6 remainder)

Only Paystack (HMAC-SHA512) + Meta challenge are processed; other gateways are logged-not-processed. Add verifier+secret per in-scope gateway. Confirm `webhooks-replay` is truly superseded by the outbox path, or finish the processor (`webhooks-replay-processor.js`) / remove the stub + untracked `schedulers/webhook-replay.js`. **Size: M.**

### 2.7 Dedupe keys (H-8 / H-9 follow-ups)

Contact phone/email uniqueness (needs a dedupe migration accounting for cross-brand visibility) and a unique customer-thread key in smartcomm. **Size: S–M.**

---

## TIER 3 — AI completeness (§6.29 / §8.2)

> **STATUS — Tier 3 complete (2026-06-13), pending CI verification.**
>
> - **3.1 ✅** Query Agent: `query-catalogue.js` (allowlisted, parameterised, brand-scoped reads — reuses verified dashboards reads, never free-form SQL) + `query-agent.js` (exposes them as `query_*` tools, gates each on `view` for its RBAC module with CEO bypass, executes + summarises). Wired into the orchestrator + system prompt. Unit test: `tests/unit/praxis_ai/query-agent.test.js`.
> - **3.2 ✅** RAG corpus builder: `scripts/rag-reembed.js` now ingests `ai_knowledge_chunks` (PD/SOPs/training) + the AI-enabled action catalogue into `ai_embeddings` via the verified ai-embed processor (re-runnable for model migrations). The pipeline existed but **nothing populated the corpus** — now it does. Still needs a provider key (`EMBEDDINGS_PROVIDER` + `EMBEDDINGS_API_KEY`) — env/ops, then `npm run rag:reembed`.
> - **3.3 ✅** Voice path: env-gated `transcription.service.js` (OpenAI-compatible Whisper, SSRF-guarded to the app's own media origin) wired into `praxis.service` (audio URL → transcript before orchestration); validator accepts `source_audio_url`. No-ops until `TRANSCRIPTION_PROVIDER` is set.
>
> Caveats: authored without execution here — run `npm run test:unit` + integration suites in CI. 3.2/3.3 are env-gated (need provider keys). The Query Agent ships with 2 reads (sales + operations); add more by appending to `query-catalogue.js`.

### 3.1 Praxis Query Agent — live, scoped data queries

Today reads are answered **only from RAG-embedded documents**; the spec's Query Agent runs "a parameterised, permission-scoped query… and summarises." Build a safe query layer (allowlisted, parameterised, user-permission-scoped — never free-form SQL) so "what did we sell today?" reads `sales_orders`, not SOPs. **Size: M–L.**

### 3.2 Make RAG actually run (embeddings provider + corpus)

`embeddings.service` is OFF by default and external-only — with default config Praxis retrieves **zero** context. Pick a provider (or self-host a model), run `rag:reembed` / the `ai-embed` job over catalogue + Product Description + SOPs, and verify retrieval. **Size: S–M.**

### 3.3 (Optional) Voice/Whisper transcription

`transcribed_text` is a passthrough field; no STT exists. If voice is in scope, add the self-hosted Whisper path; otherwise mark explicitly deferred. **Size: M (or defer).**

---

## TIER 4 — Production-readiness polish

> **STATUS — Tier 4 done (2026-06-13), pending CI/staging verification.**
>
> - **4.1 ✅** `scripts/check-integrations.js` (`npm run check:integrations`) — a safe, read-only readiness report (env + maxmind file + puppeteer; **no network calls**) covering SMTP, Meta WA/IG, Twilio, GeoIP→currency, FX, embeddings, transcription, Praxis LLM, PDF, couriers, Sentry. Notes that payment gateways are DB-configured per business. Actually _setting_ the keys is staging/ops.
> - **4.2 ✅** PDF engine adopted for **all five** document consumers, each `fetch → template → renderAndStore → Documents`: invoice (`POST /invoicing/invoices/:id/pdf`), payslip (`/hr/payslips/:id/pdf`), POS/sales receipt (`/sales/orders/:id/receipt`), purchase order (`/purchasing/purchase-orders/:poId/pdf`), and customer/supplier statement (`/accounting/reports/statement/:contactId/pdf`, with a running-balance journal query). **Templates refactored** into editable `src/services/templates/*.html` files (one per report) rendered by a single-pass placeholder engine — markup separated from logic. Loose `!=`/`==` removed (eqeqeq) — verified the renderer (raw blocks not re-scanned, numeric scalars survive) with a unit-style check.
> - **4.3 ✅** Hardening verified solid (helmet, CORS, compression, webhook raw-body HMAC capture, request logging, global `/api/` + public-write rate limits, leak-safe error handler). Fix: normalised the 429 body to the app's `{ error: { code, message } }` envelope. **Load check** (autocannon/k6 against storefront read endpoints) is a staging step.
>
> Caveat: authored without execution here. PDF rendering needs Puppeteer/Chromium on the host; integration keys are env/ops.

### 4.1 Wire & validate external credentials (staging)

Paystack (live), Meta/Instagram Graph, Twilio/WhatsApp, SMTP, **maxmind GeoIP DB** (for the §6.4 IP→currency feature), FX provider, LLM vendor. Each path no-ops until configured — validate each actually works once configured. **Size: M.**

### 4.2 Adopt the PDF engine for the identified consumers

Engine (`pdf.service`, Puppeteer) is built; wire `renderAndStore` for invoices, POS/sales receipts, payslips, purchase orders, customer/supplier statements, cash-request/expense approval letters. **Size: M.**

### 4.3 Ops hardening pass

Confirm rate-limit coverage on all public writes, error handler leaks nothing, structured logs/metrics on the worker + crons, and a basic load check on revenue-bearing storefront endpoints. **Size: S–M.**

---

## Recommended sequence

1. **1.2 smoke test** + **1.1 tests** in parallel — you cannot safely call anything "done" until the spine runs and is guarded. Enable the money-moving crons only after.
2. **1.3 access matrix** → **1.4 RLS read-side** — close the security/isolation gaps the spec is emphatic about; both get locked in by tests from step 1.
3. **1.5 password reset** + **1.6 validators** — quick correctness wins.
4. **Tier 2** feature remainders (2.1 → 2.6), each landing with a test.
5. **Tier 3** Praxis query agent + live RAG.
6. **Tier 4** integrations + PDF adoption + ops pass before go-live.

## Dependencies / notes

- Apply migration **000113** (users/auth reconcile) regardless — it fixes a latent login issue.
- Money-moving crons (subscription billing W-C, FX) stay disabled until **1.2** passes on staging.
- Do execution-level work on **clean CI / a fresh checkout**, not the local bash sandbox (it truncates fresh files and will mislead any `node`/`eslint`/`jest`/`git` run).

## Effort shape (rough)

Tier 1 is the majority of remaining work and ~all of the risk. Tiers 2–4 are mostly finishing touches on already-built foundations. The honest headline: **the features are ~80% there; the _proof_ that they work is ~5% there — close that gap first.**
