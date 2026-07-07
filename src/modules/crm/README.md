# Crm module

**Spec:** Customer Management (V2.2 §6.1)
**Permission key:** `crm`

## Backing tables

- `crm_pipelines`
- `crm_pipeline_stages`
- `crm_deals`
- `crm_deal_stage_history` — append-only trail written on create + every stage move
- `crm_deal_products` — anticipated line items (pipeline-by-product forecasting)
- `crm_activities` — deal-level AND contact-level (calls/WhatsApp/emails on the 360)
- `crm_notes`
- `customer_preferences`
- `customer_measurements`
- `churn_risk_scores` — computed nightly by `jobs/schedulers/churn-risk-scoring.js`
- `shared.contact_segments` — presets seeded nightly by `jobs/schedulers/segment-presets.js`

## Files

| File                | Purpose                              |
| ------------------- | ------------------------------------ |
| `crm.routes.js`     | Express router — URL → controller    |
| `crm.controller.js` | HTTP handlers (req/res only)         |
| `crm.service.js`    | Business logic, transactions, events |
| `crm.repo.js`       | Parameterised SQL only               |
| `crm.validator.js`  | Zod input schemas                    |
| `crm.events.js`     | Domain events for realtime + AI      |
| `crm.presets.js`    | Segmentation thresholds (VIP, win-back…) shared with the nightly presets job |

## Client-360 surface

- `GET /clients` — contacts + commercial roll-up (spend, orders, loyalty,
  churn band) with chips `vip · big_spender · new · win_back · birthdays_soon`
  and sorts `recent · top_spend · newest · name`.
- `GET /today` — outreach buckets: to_celebrate, to_welcome, to_win_back,
  top_this_month, follow_ups (stale open deals).
- `GET/POST /customers/:contactId/activities` — contact-level activity log;
  rows land on the contact-360 timeline automatically.
- `POST /customers/:contactId/win-back` — one-click enrolment into every
  active retention strategy on the `win_back` trigger (Module 6.23). Returns
  `{ enrolled }`; `0` means no strategy is live.

## Reports

`GET /reports/ltv · /reports/cohorts · /reports/win-loss · /reports/velocity ·
/reports/forecast` — LTV ranking, monthly cohort retention, win/loss + lost
reasons, stage velocity (from `crm_deal_stage_history`), weighted pipeline
forecast vs actual wins.

## Background jobs

- `churn-risk-scoring` (02:45 Lagos) — recency-rule churn scores; supersedes
  old rows, stamps `recovered_at` on comebacks. Unit tests:
  `tests/unit/jobs/churn-risk-scoring.test.js`.
- `segment-presets` (04:00 Lagos) — seeds/refreshes the preset segments and
  recomputes `cached_count` on every segment.

## TODOs

- [ ] Wire events to Socket.io rooms (see `src/realtime/rooms.js`)
- [ ] Add integration tests in `tests/integration/crm/`
