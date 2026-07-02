# StylistProgramme module

**Spec:** Stylist Partner Programme (V2.2 §6.26)
**Permission key:** `stylist_programme`
**Build contract:** `docs/STYLIST_PROGRAMME_IMPLEMENTATION_GUIDE.md` (4 PRs; this module is PR1)

Three audiences on one module:

- **Admin** (staff JWT + `stylist_programme` permission) — `/api/v1/stylists`:
  applications & rubric vetting, explicit decisions (never auto-approved),
  contracts, certifications + badge, routing suggest, assignments + disputes,
  verified-review moderation, referral ledger, payout batches (workflow-gated
  approval), programme config (tiers D-2, questionnaire, routing weights,
  quality-hold, commission).
- **Portal** (stylist JWT — external partners, NOT staff) —
  `/api/v1/stylist-portal`: login + invite/forgot-password rail, profile +
  payout details, offers (accept/decline/start/complete), earnings
  (hold/payable/paid), payout statements, referral links + attributions,
  notifications feed, badge + downloadable badge card, contract signing state.
- **Public** (no auth, rate-limited) — `/api/public/stylist-programme`:
  questionnaire + application intake (multipart ID/business docs),
  certified-partner directory, tokenised customer review (doubles as the
  quality-hold satisfaction confirmation), referral redirect `/r/:code`.
  Badge verification stays at `/api/public/stylist-verify/:badge_id`.

## Backing tables (shared — a stylist can serve any brand)

`stylist_partners`, `stylist_credentials`, `stylist_specialities`,
`stylist_certifications`, `stylist_assignments`, `stylist_assignment_offers`,
`stylist_payouts`, `stylist_payout_lines` (000008) + v2 (000251):
`stylist_tiers`, `stylist_programme_config`,
`stylist_questionnaire_questions`, `stylist_application_responses`,
`stylist_vetting_reviews`, `stylist_referral_links`,
`stylist_referral_attributions`, `stylist_notifications`. Brand template
000075 adds `sales_orders.stylist_referral_code`.

## Files

| File                       | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `stylist.routes.js`        | Admin router                                                    |
| `stylist.portal.routes.js` | Partner portal router (stylist JWT)                             |
| `stylist.public.routes.js` | Public apply/directory/review/referral router                   |
| `verify.routes.js`         | Public badge verification                                       |
| `stylist.controller.js`    | HTTP handlers (req/res only)                                    |
| `stylist.service.js`       | Partners, badges, assignments, quality-hold reviews, payouts    |
| `application.service.js`   | Apply → vetting → decision → invite + password rail             |
| `contract.service.js`      | Contract PDF → e-sign → badge auto-issue on signature           |
| `routing.service.js`       | Smart routing: weighted candidate scoring (config-driven)       |
| `referral.service.js`      | Referral links, order attribution, commission accrual           |
| `badge-card.service.js`    | Badge payload + printable badge card PDF (QR → verify URL)      |
| `stylist.notify.js`        | Partner notifications: in-portal rows + branded email           |
| `stylist.repo.js`          | SQL for the 000008 tables                                       |
| `programme.repo.js`        | SQL for the 000251 tables + cross-cutting queries               |
| `stylist.auth.js`          | Stylist JWT middleware (rejects staff tokens)                   |
| `stylist.validator.js`     | Zod input schemas                                               |
| `stylist.events.js`        | Domain events (`stylist_programme.*`)                           |
| `stylist.subscribers.js`   | service_jobs routing · order.paid referral accrual · contract-signed badge |

## Cross-module wiring

- **Documents/e-sign (§6.13):** contract PDFs stored via `documents.store`;
  signing rides `signature_requests` (`request_type
  'stylist_partner_agreement'`); `signature.fully_signed` → badge.
- **Workflows:** payout submit opens a `stylist_programme:payout` instance
  (default route: Finance/CEO).
- **Sales/Storefront:** checkout + public order form validate `referral_code`
  and stamp `stylist_referral_code`; the durable `order.paid` outbox consumer
  accrues commission with the quality-hold window.
- **Jobs:** `stylist-programme-sweep` — offer expiry + referral hold release
  (15 min), certification T-30/T-7 reminders + auto-lapse (nightly).

## Tests

`tests/unit/stylist_programme/` — routing scoring, referral accrual math +
idempotency, validators. Full journey verified live (see PR1 description).
