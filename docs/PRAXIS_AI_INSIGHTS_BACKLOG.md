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
- ✅ **Wave 3 — Module fan-out**: detectors + slots for all 27 modules (see §B).
  - ✅ Batch 1: hr_attendance, purchasing, logistics, expenses.
  - ✅ Batch 2: sales, crm, production, accounting, retention.
  - ✅ Batch 3: pricing, retail_partners, tasks.
  - ✅ Batch 4: stylist_programme, sales_campaigns, marketing, smartcomm.
  - ✅ Batch 5: social_media, storefront, catalogue, iam_security, payroll,
    customer_onboarding.
- ✅ **Wave 4 — Polish**: realtime + notification bell, auto-resolve (sweep +
  stock scheduler), Tier-2 AI narration with `ai_briefing_insight_refs`, Praxis
  chat query, legacy-table cleanup (000257), App-Grid badges + alert-bar
  breakdown, a11y pass, docs refresh, and the full Help Center guide (000258).
  Depth: stock ×2 signals, purchasing ×2, pricing across all channels.
  The single remaining item is live-DB integration tests (see §D).

---

## B. Detector coverage — all 27 modules

Detectors run only for modules switched **on** in AI Control → Insights
(`insights_enabled`). Every module below is seeded in `ai_insight_modules`.

| # | Module | Detector(s) | Detector | Page slot |
|---|--------|-------------|:--------:|:---------:|
| 1 | stock | reorder_point + negative_stock (scheduler, ×2) | ✅ | ✅ `/stock` |
| 2 | invoicing | overdue / overdue_long | ✅ | ✅ |
| 3 | intercompany | pending_too_long | ✅ | n/a (hidden module) |
| 4 | approvals | queue_growing | ✅ | ✅ `/org-workflow` |
| 5 | service_jobs | no_sale_linked, no_intercompany_match | ✅ | ✅ `/service-jobs` |
| 6 | hr_attendance | off_site | ✅ | ✅ `/hr` |
| 7 | purchasing | delivery_overdue + approval_stalled (×2) | ✅ | ✅ |
| 8 | logistics | delivery_failed / delivery_overdue | ✅ | ✅ |
| 9 | expenses | advance_overdue / advance_ageing | ✅ | ✅ |
| 10 | sales | fulfillment_delayed | ✅ | ✅ |
| 11 | crm | deal_stalled | ✅ | ✅ |
| 12 | production | run_delayed | ✅ | ✅ |
| 13 | accounting | journal_draft_aging | ✅ | ✅ `/accounting` |
| 14 | retention | churn_risk | ✅ | ✅ |
| 15 | pricing | price_below_cost (all channels) / price_below_floor (storefront) | ✅ | ✅ `/pricing` |
| 16 | retail_partners | settlement_unpaid / settlement_disputed | ✅ | ✅ `/retail-partners` |
| 17 | stylist_programme | payout_unpaid / payout_failed | ✅ | ✅ `/stylists` |
| 18 | sales_campaigns | ended_not_closed / scheduled_not_launched | ✅ | ✅ `/sales-campaigns` |
| 19 | marketing | ad_no_conversions | ✅ | ✅ `/marketing` |
| 20 | social_media | post_failed / post_overdue / token_expiring | ✅ | ✅ `/social` |
| 21 | smartcomm | unanswered | ✅ | n/a (fixed-height inbox) |
| 22 | storefront | payment_failed | ✅ | n/a (drills to `/sales/orders`) |
| 23 | catalogue | visible_unbuyable | ✅ | ✅ `/catalogue` |
| 24 | iam_security | access_review_overdue | ✅ | ✅ `/iam-security` |
| 25 | tasks | overdue | ✅ | ✅ `/workspace` |
| 26 | payroll | contract_expiring | ✅ | ✅ `/payroll` |
| 27 | customer_onboarding | onboarding_stalled | ✅ | n/a (no admin page) |

**Detectors done: all 27 modules, 31 tier-1 signals (29 registry detectors +
the stock scheduler's 2) — fan-out complete.** Slots live on every module with
a suitable page; smartcomm/storefront/onboarding surface in the Insights
Center + bell (no fitting inline home). Adding another signal anywhere follows
the established pattern: verify schema → repo read → registry entry → unit
test.

### Slots on already-covered modules
- ✅ `/stock`, `/service-jobs`, `/org-workflow` — done.
- (intercompany has no standalone page — surfaces in the Insights Center only.)

---

## C. Wave 4 — cross-cutting polish (the "don't leave anything out" set)

1. ✅ **Pricing / margin detector** — shipped in Wave 3 batch 3 using
   `product_variants` cost/min/storefront price (no floor-table join needed).
2. ✅ **Tier-2 AI narration** — `ai-briefing.js` narrates the summarised counts
   with the LLM when a module opted in (`narration_enabled`), the
   `insights_briefing` feature is usable, and a vendor is configured; degrades
   to the deterministic text on any miss (no vendor / budget hard-cap / error).
   Meters `call_type = 'insight_narration'` on the governance ledger, and every
   briefing records its top open findings in `ai_briefing_insight_refs`
   (paragraph → alert links; CHECK unlocked by 000257).
3. ✅ **Realtime** — `insights-realtime.js` relays `sweep.completed` +
   `insight.updated` into `brand:{brand}:insights`; the client (`useInsightsRealtime`)
   joins the room and invalidates the insights keys, so the Center + every slot
   update live (spec §6.30 "event-triggered alerts, not just the daily run").
4. ✅ **Notification bell** — the sweep fans genuinely-new high/critical findings
   to the CEO's notifications feed via `notifications.notify` (suppressed
   duplicates never re-ping, since `raise` returns the row only on insert).
5. ✅ **Praxis chat query** — `insights_open` entry in
   `praxis_ai/query-catalogue.js`; the CEO can ask "what needs my attention?"
   and get the per-module open counts in chat (permission-scoped to ai_insights).
6. ✅ **Module badges** — the App Grid now shows per-module **urgent** counts
   (insight module → nav tile, with a total on the Insights tile), fed from
   `/insights/summary`; each module page's `<ModuleInsights>` slot already
   carries the open/urgent counts inline.
7. ✅ **Legacy cleanup** — migration 000257 drops the 7 old `ai_insight_*`
   category tables (unified path verified in production post-#324) and unlocks
   `ai_briefing_insight_refs.insight_category` for unified module keys.
8. ✅ **Default-on policy** — resolved by design (owner decision): the AI
   Control matrix IS the mechanism — the CEO activates/deactivates insights per
   module to control spend; new detectors ship off.
9. ✅ **Weekly auto-reports (§6.30)** — verified: `weekly-reports.js` runs
   Sat 20:00 Lagos, generates deterministically from logged data into
   `report_runs` in `needs_confirmation` (the review-then-confirm step),
   idempotent per template+week.
10. ✅ **Command Center** — the alert bar now shows the top-3 modules by
    urgent count under the headline, and the urgent badge routes to /insights.

---

## D. Quality / hygiene

- ✅ **Auto-resolve pass** — the sweep closes open insights whose finding no
  longer appears (condition cleared), scoped to modules whose detectors all ran
  cleanly (a detector error never mass-resolves). Stock — owned by its own
  scheduler — auto-resolves per brand with the same live-key pattern, skipping
  any brand whose query failed.
- ⬜ **Integration tests** — `/insights` routes + `runDetectorSweep` end-to-end
  against a live DB (`RUN_DB_TESTS=1`). Unit coverage is strong (57 tests:
  registry, service, sweep gating, auto-resolve, stock scheduler, briefing
  narration + refs), but detector SQL has only been verified against migration
  schemas, not executed. The one remaining honest gap — needs a DB environment.
- ✅ **Docs** — `docs/AI_PRAXIS.md` rewritten for the unified store +
  per-module matrix + auto-resolve + narration + refs; module README current;
  `CONFORMANCE_GAPS.md` checked (it carried no insights entries to update).
  Full user-facing documentation seeded into the Help Center (000258).
- ✅ **Frontend states** — Insights Center ships skeleton / empty / error /
  permission-denied; the slot is self-effacing (renders nothing when off,
  clear, loading or errored); AI Control matrix has denied/loading/error/empty
  paths. Token-driven throughout (both themes).
- ✅ **a11y** — matrix toggles carry per-module `aria-label`s (role=switch was
  already present), the frequency Select and severity filter have accessible
  names + `aria-haspopup`/`aria-expanded`, filter chips expose `aria-pressed`,
  and the resolution-note input is labelled. Action buttons have visible text.

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
