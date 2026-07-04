# AiInsights module

**Spec:** AI Insights & Briefings (V2.2 §6.30 / §6.31)
**Permission key:** `ai_insights`

## Design — unified store + registry (migration 000256)

Findings from **every module** live in one table, `shared.ai_insights`
(`module` + `detector` + `severity` + `status` + typed `context` JSONB + drill
target + open→resolved lifecycle, idempotent on the partial-unique
open-suppression index). The CEO drives **which modules are on** from AI Control
via `shared.ai_insight_modules` (per-module `insights_enabled` /
`narration_enabled` / `frequency`).

Tier-1 detectors are declared in **`insights.registry.js`** — each returns
normalised findings from a brand-scoped repo read. Adding a module's insights =
a registry entry + toggling it on in AI Control (no new tables/repos/routes).
The detector sweep (`runDetectorSweep`, cron every 30 min) runs **only** the
modules toggled on.

> The legacy per-category tables from migration 000012 are retained but no
> longer written; open findings re-materialise into `ai_insights` on the next
> sweep. They can be dropped in a later cleanup once verified in production.

## Files

| File                     | Purpose                                          |
| ------------------------ | ------------------------------------------------ |
| `insights.routes.js`     | Express router — URL → controller                |
| `insights.controller.js` | HTTP handlers (req/res only)                     |
| `insights.service.js`    | Lifecycle, gating, registry-driven sweep, audit  |
| `insights.registry.js`   | Declarative tier-1 detector catalogue (27 modules) |
| `insights.repo.js`       | Parameterised SQL — unified store + source reads |
| `insights.validator.js`  | Zod input schemas                                |
| `insights.events.js`     | Domain events for realtime + AI                  |

## API

- `GET  /insights/summary` — per-module open/urgent counts
- `GET  /insights?module=&status=&severity=&page=` — list
- `GET  /insights/:id` — one finding
- `POST /insights/:id/{acknowledge,resolve,dismiss}` — lifecycle
- `GET  /insights/modules` — the AI Control matrix
- `PATCH /insights/modules/:module` — toggle insights/narration/frequency
- `POST /insights/sweep` — manual detector run

## Producers

- **Registry detectors** (sweep): `invoicing` (overdue), `intercompany`
  (stale), `approvals` (backlog), `service_jobs` (×2 — no-sale + no-IC-match),
  `hr_attendance` (off-site clock-in), `purchasing` (PO delivery overdue),
  `logistics` (failed/overdue deliveries), `expenses` (unsettled advances),
  `sales` (paid-but-undispatched), `crm` (stalled deals), `production` (run
  arrival overdue), `accounting` (unposted draft journals), `retention` (high
  churn risk), `pricing` (price below cost/floor), `retail_partners`
  (unpaid/disputed settlements), `tasks` (overdue), `stylist_programme`
  (unpaid/failed payouts), `sales_campaigns` (live-past-end / not-launched),
  `marketing` (ad spend with no conversions), `smartcomm` (unanswered thread),
  `social_media` (failed post / expiring token), `storefront` (failed payment),
  `catalogue` (visible-but-unbuyable), `iam_security` (overdue access review),
  `payroll` (contract expiring), `customer_onboarding` (stalled submission).
- **`low-stock.js` scheduler** → `stock` (via the legacy `raise` adapter).

**All 27 modules now have a detector.** New detectors run only for modules
switched on in AI Control, so they ship dormant until the CEO enables them. See
`docs/PRAXIS_AI_INSIGHTS_BACKLOG.md` for the remaining Wave-4 polish.

## Tier-2

The daily briefing (`jobs/schedulers/ai-briefing.js`) narrates the per-module
summary. AI (paid) narration runs only where the CEO flips `narration_enabled`
on for a module; otherwise the deterministic text is the always-on baseline.
