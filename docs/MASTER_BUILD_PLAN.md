# Pixie Girl Hub — Master Build Plan (single source of truth)

**Why this exists.** Findings about what pixie still needs were spread across six docs with
three different ID schemes. This plan **merges all of them** into one crosswalk and one
severity-ordered roadmap, so we plan and build everything from a single list. `hub-system` is a
reference/lookup model only — every fix here is pixie-native.

**Sources merged (each remains the evidence base for its area):**

- `HUB_VS_PIXIE_DEEP_VERIFICATION.md` — code-verified robustness findings (R-1…R-4).
- `PIXIE_GAP_INVENTORY_AND_PLAN.md` — PD/schema/admin-UI feature gaps (Dimensions 1–4).
- `SOLIDIFICATION_PLAN.md` — original hardening findings (A/B/C/D).
- `CROSS_MODULE_WIRING_AUDIT.md` — event/flow wiring (G-1…G-7).
- `CONFORMANCE_GAPS.md` — schema buckets (A/B/C) + app-wiring queue (W-1…W-13).
- `SYSTEM_FLOW_AUDIT.md`, `ADMIN_UI_COVERAGE.md` — module/flow/admin coverage.

**Last updated:** 2026-06-11.

---

## 1. ID crosswalk — every legacy ID maps to one master ID

So nothing is tracked under two names. Master IDs: **H-** hardening, **J-** jobs, **F-** features,
**U-** admin-UI, **X-** deferred/external.

| Master   | What                                                                                  | Legacy IDs                               | Status                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H-1**  | RLS effective (brand-context GUC wiring)                                              | R-1, SOLIDIFICATION A-4, Conformance C-1 | 🟡 write-path DONE 2026-06-11; read-side pending                                                                                                                                                        |
| **H-2**  | Transactional outbox (atomic, post-commit, durable events)                            | R-2, A-1, A-2, B-3                       | ✅ DONE 2026-06-11 for the full `order.paid` chain (all 6 consumers, per-handler progress tracking). Other pre-commit emits (order.deposit_met, variant.created, …) migrate later with the same pattern |
| **H-3**  | Consumer idempotency (UNIQUE source keys + ON CONFLICT)                               | A-3                                      | ✅ DONE 2026-06-11 (sale-journal partial UNIQUE + idempotent consumer)                                                                                                                                  |
| **H-4**  | Inbound webhook receiver pipeline + signature verify                                  | R-3, B-1, D-1                            | 🔴 pending                                                                                                                                                                                              |
| **H-5**  | Graceful shutdown / lifecycle                                                         | R-4, C-1                                 | ✅ DONE 2026-06-11                                                                                                                                                                                      |
| **H-6**  | Cron sweep claim-locking                                                              | R-4, B-2                                 | 🟠 pending (real race = `layaway-reminders`; outbox dispatch already uses SKIP LOCKED)                                                                                                                  |
| **H-7**  | Stock oversell clean error                                                            | B-4                                      | 🟡 pending (DB CHECK already prevents negative — UX only)                                                                                                                                               |
| **H-8**  | Smartcomm outbound via durable queue + unique thread key                              | B-5                                      | 🟠 pending (depends on J-2)                                                                                                                                                                             |
| **H-9**  | Public order-form idempotency key + contact unique                                    | B-6                                      | 🟠 pending                                                                                                                                                                                              |
| **H-10** | Per-route rate limits on public writes                                                | D-5                                      | 🟡 pending                                                                                                                                                                                              |
| **H-11** | Money-discipline confirmation sweep                                                   | D-3                                      | 🟡 pending (mostly verify)                                                                                                                                                                              |
| **H-12** | Error handler (no SQL/stack leak)                                                     | D-2                                      | ✅ already solid (no work)                                                                                                                                                                              |
| **J-1**  | `low-stock` alert cron                                                                | Dimension 2                              | 🔴 stub                                                                                                                                                                                                 |
| **J-2**  | `email-` + `whatsapp-send` queue processors                                           | Dimension 2                              | 🔴 stub (inline send works; queue path dead)                                                                                                                                                            |
| **J-3**  | `fx-rates` refresh cron                                                               | Dimension 2                              | 🔴 stub                                                                                                                                                                                                 |
| **J-4**  | `weekly-reports` (sales + customer) cron                                              | Dimension 2                              | 🔴 stub                                                                                                                                                                                                 |
| **J-5**  | `ai-briefing` daily cron                                                              | Dimension 2                              | 🔴 stub                                                                                                                                                                                                 |
| **J-6**  | `webhooks-replay` processor                                                           | Dimension 2                              | 🔴 stub (lands with H-4)                                                                                                                                                                                |
| **J-7**  | `report-generate` processor                                                           | Dimension 2                              | 🟠 stub                                                                                                                                                                                                 |
| **J-8**  | `ai-embed` processor (RAG corpus)                                                     | Dimension 2, X-2                         | 🟠 stub (needs vendor key)                                                                                                                                                                              |
| **F-1**  | Wig subscriptions + maintenance add-on (§6.23.5)                                      | Dimension 3                              | 🔴 schema-only                                                                                                                                                                                          |
| **F-2**  | Bundle offers / package deals (§6.23.4)                                               | Dimension 3                              | 🟠 schema-only                                                                                                                                                                                          |
| **F-3**  | Coupon-code engine (§6.23.2)                                                          | Dimension 3                              | 🟠 schema-only                                                                                                                                                                                          |
| **F-4**  | Automated retention workflows (§6.23)                                                 | Dimension 3                              | 🟠 schema-only                                                                                                                                                                                          |
| **F-5**  | Customer order timeline + stage notifications (§6.23.6)                               | Dimension 3                              | 🟠 schema-only                                                                                                                                                                                          |
| **F-6**  | Persistent cart + wishlist (§6.4)                                                     | Dimension 3                              | 🟡 schema-only                                                                                                                                                                                          |
| **F-7**  | Production landed-cost + chemical recipes/recon + rework (§6.24)                      | Dimension 3, G-5 remainder               | 🟠 schema-only                                                                                                                                                                                          |
| **F-8**  | Performance-appraisal scoring (§6.11)                                                 | Dimension 3                              | 🟠 schema-only (KPI defs/cycles exist)                                                                                                                                                                  |
| **F-9**  | FX period-end revaluation (§6.6)                                                      | Dimension 3                              | 🟡 schema-only                                                                                                                                                                                          |
| **F-10** | Invoice reminders (§6.5/6.6)                                                          | Dimension 3                              | 🟡 schema-only                                                                                                                                                                                          |
| **F-11** | Expense approval workflow (§6.7)                                                      | Dimension 3                              | 🟡 schema-only                                                                                                                                                                                          |
| **F-12** | Saved dashboards / reports persistence (§6.20/6.30)                                   | Dimension 3                              | 🟡 schema-only                                                                                                                                                                                          |
| **F-13** | Soft-FK reconciliation sweep (C-3 infra)                                              | Dimension 3                              | 🟡 schema-only                                                                                                                                                                                          |
| **F-14** | Notification preferences (per-user routing/opt-out)                                   | Dimension 3                              | 🟡 schema-only                                                                                                                                                                                          |
| **F-15** | Staff invite / onboarding flow                                                        | SOLIDIFICATION F-1                       | 🟠 missing entirely                                                                                                                                                                                     |
| **F-16** | Walk-in customer self-registration (+ QR)                                             | SOLIDIFICATION F-2                       | 🟡 missing                                                                                                                                                                                              |
| **U-1**  | Admin CRUD for F-1…F-4 config (subscription plans, bundles, coupons, retention rules) | Dimension 4 §E                           | ties to F-1…F-4                                                                                                                                                                                         |
| **U-2**  | Admin CRUD for chemical recipes / landed-cost components                              | Dimension 4 §O                           | ties to F-7                                                                                                                                                                                             |
| **U-3**  | Report-template / saved-report screens                                                | Dimension 4 §S                           | ties to F-12                                                                                                                                                                                            |
| **U-4**  | Appraisal review screens                                                              | Dimension 4 §P                           | ties to F-8                                                                                                                                                                                             |
| **X-1**  | Delivery-letter PDF render at packing                                                 | G-7, C-2                                 | ⚪ deferred (needs headless-browser owner)                                                                                                                                                              |
| **X-2**  | Praxis live orchestrator + RAG embeddings                                             | SYSTEM_FLOW §7                           | ⚪ deferred (needs AI vendor creds)                                                                                                                                                                     |

---

## 2. Already shipped — do NOT rebuild (verified)

So the plan is honest about the ~80% that's real. Verified present and connected:

- **Core ERP spine:** sale → stock + GL journal + dual-currency invoice + loyalty/Streak Stars +
  commission + dispatch delivery; deposit → service job → stylist routing; pricing write-back to
  variant prices; intercompany mirrored books; consignment; POS; purchasing 3-way match; cash
  request; storefront order-form; storefront studio (W-1…W-13, G-1…G-6 all closed).
- **Schema:** V2.2 buckets A/B/C shipped (51 migrations). The gap is app-wiring, not schema.
- **Quality baseline:** `decimal.js` money (0 float ops), clean error handler (H-12), clean
  resource singletons, real FFmpeg media pipeline, `ai-insights-sweep` detector, email-campaign
  send/track/AB, social→smartcomm, contacts-360.
- **This session:** H-5 shutdown, H-1 RLS write-path wiring.

---

## 3. The unified roadmap (one sequence, hardening → automation → features)

Each batch ends with the standing static-validation sweep (strict `===`, route mounts, event-graph
wiring, permission-key coverage) + docs/memory update. No `node` execution.

### ▸ Batch 0 — Robustness core _(protect the built spine)_

- **H-5** shutdown ✅ · **H-1** RLS write-path ✅ — **done this session.**
- **H-1** read-side enforcement (wrap context'd one-shot reads or request-scoped conn) — needs a
  staging perf check.
- **H-3** idempotency keys → **H-2** transactional outbox (`shared.event_outbox` + `event-dispatch`
  worker + migrate the `order.paid` chain) → **H-6** sweep claim-locking.
- **H-4** webhook receiver pipeline (verify→log→dedup→enqueue→200) lands with **J-6**.
  _Highest severity; unblocks durable everything._

### ▸ Batch 1 — Make the dead jobs real _(restore PD-promised automation)_

- **J-1** low-stock alerts · **J-3** fx-rate refresh · **J-4** weekly reports · **J-5** AI briefing
  · **J-2** email/whatsapp processors (enables **H-8**) · **J-6** webhooks-replay (with H-4) ·
  **J-7** report-generate · **J-8** ai-embed (thin first cut).
- Plus **H-8** smartcomm-via-queue, **H-9** order-form idempotency, **H-10** public rate limits,
  **H-7** stock clean-error, **H-11** money sweep — small correctness items that ride along.

### ▸ Batch 2 — Retention feature cluster (§6.23) _(biggest unbuilt customer value)_

- **F-1** subscriptions + maintenance · **F-2** bundles · **F-3** coupons · **F-4** retention
  workflows · **F-5** order timeline + stage notifications · **U-1** their admin CRUD.

### ▸ Batch 3 — Production depth + HR appraisal

- **F-7** landed-cost/chemicals/rework + **U-2** · **F-8** appraisal scoring + **U-4**.

### ▸ Batch 4 — Finance + storefront + infra completeness

- **F-9** FX revaluation · **F-10** invoice reminders · **F-11** expense approvals · **F-6** cart +
  wishlist · **F-12** saved dashboards/reports + **U-3** · **F-13** soft-FK recon sweep · **F-14**
  notification prefs.

### ▸ Batch 5 — Access/onboarding features

- **F-15** staff invite flow · **F-16** walk-in self-registration (reuses H-10 throttle).

### ▸ Batch 6 — Deferred / external-dependency

- **X-1** delivery-letter PDF (build the one headless-browser owner first) · **X-2** Praxis live
  orchestrator + RAG embeddings (AI vendor creds).

**Recommendation unchanged:** finish **Batch 0** then **Batch 1** before opening the Batch 2–5
feature surface — they protect and complete what's already built. We're mid-Batch-0 now.

---

## 4. Coverage check — every source doc's open items are represented here

| Source doc                     | Its open items                                    | Master IDs                 |
| ------------------------------ | ------------------------------------------------- | -------------------------- |
| HUB_VS_PIXIE_DEEP_VERIFICATION | R-1…R-4                                           | H-1, H-2/H-3, H-4, H-5/H-6 |
| SOLIDIFICATION_PLAN            | A-1…A-4, B-1…B-6, C-1/C-2, D-1…D-5, F-1/F-2       | H-1…H-11, X-1, F-15/F-16   |
| PIXIE_GAP_INVENTORY            | Dim 1–4                                           | H-_, J-_, F-_, U-_         |
| CROSS_MODULE_WIRING            | G-1…G-6 closed; G-7 open                          | X-1                        |
| CONFORMANCE_GAPS               | W-1…W-13 closed; C-1 mislabelled; C-3 schema-only | H-1, F-13                  |
| SYSTEM_FLOW_AUDIT              | live LLM, a few detectors, G-7                    | X-2, J-1/J-8, X-1          |

Nothing open in any source doc is unmapped. This file is now the tracking list; the others remain
the evidence bases.
