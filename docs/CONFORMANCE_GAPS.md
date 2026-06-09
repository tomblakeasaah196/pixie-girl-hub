# V2.2 Conformance Gaps

**Last verified:** 2026-06-08 (see `VERIFICATION_REPORT.md`).

> **Status change.** The original Bucket A/B/C gaps in this file were all
> **shipped to migrations** (see `migrations/CHANGELOG.md`). The schema is
> now essentially fully V2.2-conformant. The live gap class is no longer
> _schema_ gaps — it is **application-layer wiring lag**: schema (and often
> routes) are in place, but the service logic that uses them is incomplete.
> This file now tracks that queue.

---

## Part 1 — Original gap buckets: SHIPPED ✅

Per `migrations/CHANGELOG.md`, all of the following landed:

| Bucket               | Items                                                                                                                                                                                                                                                           | Where                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A (cheap mismatches) | A-1 loyalty thresholds, A-2 stylist tiers, A-3 KPI sum-to-100 CHECK, A-4 POS idempotency key, A-5 wishlist, A-6 strive→opay, A-7 payment-fee accounts (9-way split), A-8 cancellation defaults verified                                                         | `template/000020/000034/000035`, `000008/000010/000015` |
| B (missing features) | B-1 Cash Request (6.32), B-2 installment `payment_model`, B-3 Streak Stars, B-4 Hair Quiz, B-5 UGC + self-hosted video, B-6 Public Order Form, B-7 storefront analytics, B-8 Curated Delivery Letter + Install Hub, B-9 per-gateway fees, B-10 full e-signature | `000100/000101`, `template/000016/000019/000036/000037` |
| C (architecture)     | C-1 RLS (Option A, full), C-2 field-level privacy (restricted views), C-3 soft-FK reconciliation, C-4 strive-connect drift removed                                                                                                                              | `000200/000202`, `template/000038`                      |

**Schema is therefore conformant.** What remains is to _use_ it.

---

## Part 2 — Live queue: application-layer wiring lag

These have schema (and sometimes routes) but incomplete service logic.
Ordered roughly by leverage / dependency.

### P1 — Finance correctness — ✅ SHIPPED 2026-06-08

All six built in one pass (app layer; schema was already in place). New
migration: `000111_shared_cash_request_threshold` (CEO threshold column).

| ID  | Item                                      | State   | What landed                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-1 | **`payment_model` behaviour** (sales 6.2) | ✅ done | Deposit-triggered flips to `in_production` at the deposit threshold + emits `order.deposit_met`; layaway reserves stock on placement and releases on pay/cancel; `layaway-abandonment` + `layaway-reminders` crons implemented (read `installment_settings`). |
| W-2 | **Invoicing dual-currency** (6.5)         | ✅ done | Auto-invoice carries `display_currency` / `display_subtotal` / `display_total` / `fx_rate_used` from the source order.                                                                                                                                        |
| W-3 | **Accounting Cash Flow statement** (6.6)  | ✅ done | `GET /accounting/reports/cash-flow` — direct method by source_type into operating/investing/financing, reconciled to opening/closing cash.                                                                                                                    |
| W-4 | **AR/AP ageing report** (6.6)             | ✅ done | `GET /accounting/reports/ar-ageing` + `/ap-ageing` — 0–30/31–60/61–90/90+ buckets off live `balance_due_ngn`, per customer/supplier.                                                                                                                          |
| W-5 | **Multi-currency gain/loss** (6.6)        | ✅ done | `accounting.postFxGainLoss` posts realised FX (4910/5910) when a non-NGN sales payment settles at a rate differing from the order's booked rate.                                                                                                              |
| W-6 | **Cash Request module** (6.32)            | ✅ done | Full draft→submit→finance→[ceo]→disburse→settle (+cancel) over `shared.cash_requests`; threshold routing; mandatory `bank_transaction_id`; GL posting on disburse; auto-creates an Expense for direct spends; state history.                                  |

### P2 — Customer-facing revenue surfaces — ✅ SHIPPED 2026-06-08

Retention, storefront, studio and the install hub are now functional app
layers over the existing schema.

| ID   | Item                               | State   | What landed                                                                                                                                                                                                                                                                            |
| ---- | ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-7  | **Retention module** (6.23)        | ✅ done | Loyalty engine (earn on `order.paid`, redeem, manual adjust, tier recompute), Streak Stars (rule-driven award + caps), referral codes + redemption with referrer reward, Hair Quiz (public fetch/submit + recommender + lead capture + star award). `order.paid` subscriber wires earns. |
| W-8  | **Storefront module** (6.4)        | ✅ done | Public catalogue read API (products/detail/categories/collections/content), no-login Public Order Form (contact upsert → `public_form` sales order → pay-link token), analytics ingestion (sessions/page-views/funnel-events). _Self-hosted UGC video pipeline still pending (W-13)._    |
| W-9  | **Storefront Studio** (6.28)       | ✅ done | Theme / navigation / pages draft→publish editor (`/api/v1/storefront-studio`), honouring the one-draft / one-published constraints; publish snapshots to `storefront_revisions` via trigger.                                                                                             |
| W-10 | **Install Hub composition** (6.10) | ✅ done | `GET /api/public/install-hub/:token` composes the order's items + matching wig-care guides + certified stylists near the delivery city + a pre-filled WhatsApp help link.                                                                                                                |

### P3 — Admin / structural

| ID   | Item                                 | State       | Work                                                                                                                                                                                               |
| ---- | ------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-11 | **"Add a new business" flow** (6.21) | CLI only    | In-app provisioning endpoint that runs the `bootstrap-business.js` pipeline (create schema → apply templates → seed) + a brand registry. Today a new brand requires a developer to run the script. |
| W-12 | **Email-signature builder** (6.13)   | not evident | Branded per-staff email signature template (one template, auto-personalised).                                                                                                                      |
| W-13 | **Catalogue UGC video wiring** (6.4) | embed model | Swap product video editor onto the self-hosted UGC tables. Depends on W-8.                                                                                                                         |

---

## Part 3 — Doc hygiene (cheap, do alongside)

- `SCHEMA.md` + `README.md` still say **35 migrations / 425 tables**.
  Actual is **51 migration files** (28 shared + 23 templates) after the gap
  buckets shipped. Re-run `npm run db:verify` and update the counts.

---

## Suggested order of attack

1. ~~**P1 finance (W-1…W-6)**~~ — ✅ SHIPPED 2026-06-08 (see table above).
2. ~~**P2 customer-facing (W-7…W-10)**~~ — ✅ SHIPPED 2026-06-08 (see table above).
3. **P3 admin (W-11…W-13)** — W-11 ("add a business") is the one the CEO
   will ask for; size it as a small provisioning service over the existing
   bootstrap script. W-13 (catalogue UGC video) finishes the storefront
   media story begun in W-8.

See `migrations/CHANGELOG.md` for what shipped and `VERIFICATION_REPORT.md`
for the per-module evidence behind this list.
