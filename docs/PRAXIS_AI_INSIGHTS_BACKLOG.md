# Praxis AI Insights — Delivery Backlog (the complete queue)

**Purpose:** the single, complete checklist of everything the insights
programme still needs, so nothing is left out. Companion to
`PRAXIS_AI_INSIGHTS_REVIEW.md` (the original assessment).

**Legend:** ✅ done · 🟡 in progress / partial · ⬜ not started · 🔺 needs a
decision.

---

## A. Waves (top-level status)

- ✅ **Wave 1 — Foundation**: unified `shared.ai_insights` store + `ai_insight_modules`
  matrix + registry + code cutover. (commits: schema + cutover)
- ✅ **Wave 2 — Control + UI shell**: `insights-api.ts`, `<ModuleInsights>` slot,
  Insights Center (`/insights`), AI Control matrix (`/ai-control/insights`),
  nav + Command Center dead-end fix.
- 🟡 **Wave 3 — Module fan-out**: detectors + slots per module (see §B).
  - ✅ Batch 1: hr_attendance, purchasing, logistics, expenses.
  - ✅ Batch 2: sales, crm, production, accounting, retention.
  - ⬜ Batch 3: the remaining 13 modules (see §B).
- 🟡 **Wave 4 — Polish**: ✅ realtime + notification bell; ⬜ Tier-2 AI narration,
  Praxis chat query, legacy cleanup (see §C).

---

## B. Detector coverage — all 27 modules

Detectors run only for modules switched **on** in AI Control → Insights
(`insights_enabled`). Every module below is seeded in `ai_insight_modules`.

| # | Module | Detector(s) | Detector | Page slot |
|---|--------|-------------|:--------:|:---------:|
| 1 | stock | reorder_point (low-stock scheduler) | ✅ | ✅ `/stock` |
| 2 | invoicing | overdue / overdue_long | ✅ | ✅ |
| 3 | intercompany | pending_too_long | ✅ | n/a (hidden module) |
| 4 | approvals | queue_growing | ✅ | ✅ `/org-workflow` |
| 5 | service_jobs | no_sale_linked, no_intercompany_match | ✅ | ✅ `/service-jobs` |
| 6 | hr_attendance | off_site | ✅ | ✅ `/hr` |
| 7 | purchasing | delivery_overdue | ✅ | ✅ |
| 8 | logistics | delivery_failed / delivery_overdue | ✅ | ✅ |
| 9 | expenses | advance_overdue / advance_ageing | ✅ | ✅ |
| 10 | sales | fulfillment_delayed | ✅ | ✅ |
| 11 | crm | deal_stalled | ✅ | ✅ |
| 12 | production | run_delayed | ✅ | ✅ |
| 13 | accounting | journal_draft_aging | ✅ | ✅ `/accounting` |
| 14 | retention | churn_risk | ✅ | ✅ |
| 15 | **pricing** | margin_below_floor / price_below_cost | 🔺 deferred | ⬜ |
| 16 | retail_partners | consignment_unsold, settlement_overdue | ⬜ | ⬜ |
| 17 | stylist_programme | stylist_inactive, cert_expiring, payout_pending | ⬜ | ⬜ |
| 18 | sales_campaigns | underperforming, stock_low_midcampaign | ⬜ | ⬜ |
| 19 | marketing | spend_no_conversions, budget_exhausted | ⬜ | ⬜ |
| 20 | social_media | scheduled_post_failed, token_expiring | ⬜ | ⬜ |
| 21 | smartcomm | unanswered_past_sla | ⬜ | ⬜ |
| 22 | storefront | checkout_failures, oos_high_traffic | ⬜ | ⬜ |
| 23 | catalogue | missing_image_or_price, unpublished_active | ⬜ | ⬜ |
| 24 | iam_security | anomalous_login, dormant_privileged | ⬜ | ⬜ |
| 25 | tasks | overdue_task, unassigned_high_priority | ⬜ | ⬜ |
| 26 | payroll | run_due, contract_expiring | ⬜ | ⬜ |
| 27 | customer_onboarding | onboarding_stalled, kyc_incomplete | ⬜ | ⬜ |

**Detectors done:** 14 modules (16 detectors). **Remaining:** 13 modules
(15 + pricing). Each remaining detector = verify schema → repo read → registry
entry → unit test (the established pattern).

### Slots on already-covered modules
- ✅ `/stock`, `/service-jobs`, `/org-workflow` — done.
- (intercompany has no standalone page — surfaces in the Insights Center only.)

---

## C. Wave 4 — cross-cutting polish (the "don't leave anything out" set)

1. ⬜ **Pricing / margin detector** — spans `pricing_floors` + variant cost +
   channel prices; needs careful schema work (a wrong-but-silent query is the
   risk). Do as a focused item, not lumped into a batch.
2. ⬜ **Tier-2 AI narration** — per narration-enabled module, feed the summarised
   counts to the LLM (budget-gated; deterministic text stays the fallback).
   Populate the unused `ai_briefing_insight_refs` so a paragraph links to its
   alerts. Meters under the `insights_briefing` feature flag.
3. ✅ **Realtime** — `insights-realtime.js` relays `sweep.completed` +
   `insight.updated` into `brand:{brand}:insights`; the client (`useInsightsRealtime`)
   joins the room and invalidates the insights keys, so the Center + every slot
   update live (spec §6.30 "event-triggered alerts, not just the daily run").
4. ✅ **Notification bell** — the sweep fans genuinely-new high/critical findings
   to the CEO's notifications feed via `notifications.notify` (suppressed
   duplicates never re-ping, since `raise` returns the row only on insert).
5. ⬜ **Praxis chat query** — add an `insights_open` entry to
   `praxis_ai/query-catalogue.js` so the CEO can ask "what needs my attention?"
   and get the tier-1 findings in chat.
6. ⬜ **Module-header badges** — small open-count badge on Stock / Invoicing /
   Service Jobs / Approvals headers from `/insights/summary`.
7. ⬜ **Legacy cleanup** — once the unified path is verified in production, a
   migration to drop the 7 old `ai_insight_*` category tables (000012). Keep
   until then (they're harmless and un-referenced).
8. 🔺 **Default-on policy** — currently only the original 5 modules ship
   `insights_enabled = true`; the other 22 are off pending a CEO toggle. Decide
   whether any of the new detectors should default on.
9. ⬜ **Weekly auto-reports (§6.30)** — verify `jobs/schedulers/weekly-reports.js`
   content matches the spec template (leads by channel, quotes, orders
   confirmed/fulfilled, deals lost w/ reasons, complaints, open follow-ups) and
   that "staff review & confirm" is a real state.
10. ⬜ **Command Center** — optionally surface a per-module urgent breakdown in
    the alert bar (today it sums).

---

## D. Quality / hygiene

- ⬜ **Integration tests** — `/insights` routes + `runDetectorSweep` end-to-end
  against a live DB (`RUN_DB_TESTS=1`). Unit coverage exists (registry/service).
- ⬜ **Docs** — refresh `docs/AI_PRAXIS.md` and `docs/CONFORMANCE_GAPS.md` to
  describe the unified store + per-module matrix (they still describe the
  category-table era).
- ⬜ **Frontend states audit** — confirm the four states on the Insights Center
  and the slot under both light/dark themes on mobile (canon §6 DoD).
- ⬜ **a11y** — keyboard + ARIA on the AI Control matrix toggles and the
  InsightRow actions.

---

## E. Suggested order (highest value first)

1. Slots on the 3 already-covered pages (stock, service_jobs, approvals) — trivial.
2. **Realtime + notification bell** (C3, C4) — makes every existing detector feel live.
3. **Pricing / margin** (C1) — completes the money picture.
4. Fan-out batch 3, money-adjacent first: retail_partners, stylist_programme,
   sales_campaigns, marketing → then storefront, catalogue, smartcomm, social →
   then iam_security, tasks, payroll, customer_onboarding.
5. **Tier-2 narration** (C2) once a couple of modules have real data to narrate.
6. Legacy cleanup (C7) + docs (D) as a closing pass.
