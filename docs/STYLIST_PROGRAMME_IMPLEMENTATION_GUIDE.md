# Stylist Partner Programme — Implementation Guide (4 PRs)

> V2.2 §6.26 built out end-to-end: the front-facing stylist portal
> (style.pixiegirlglobal.com — host-agnostic, subdomain seeded in config) and
> the admin **Stylists** module. This guide is the contract: the schema (§3)
> and API (§4) are frozen so PR2–PR4 build against them without waiting on
> each other. Distinct from `STYLIST_STUDIO_IMPLEMENTATION_GUIDE.md` (in-house
> Faitlyn styling ops) — the two modules stay separate; only the existing
> `service_jobs.created → routing assignment` subscriber bridges them.

---

## 1. Decisions locked (20-question session, 2026-07-01/02)

| #   | Decision |
| --- | -------- |
| Q1  | **Host-agnostic** portal app; public subdomain seeded in `business_config` (style.pixiegirlglobal.com by default); DNS decides at deploy. |
| Q2  | Four heavy sections: **(A)** public landing + application funnel, **(B)** public badge verify + partner directory, **(C)** authenticated stylist dashboard, **(D)** admin Stylists module. |
| Q3  | Portal app = **new `apps/stylist`**, TanStack Start (React 19 SSR, Tailwind v4), cloned from the `apps/storefront` scaffold pattern (Hub API client, SSR theme tokens). |
| Q4  | **PXG-only surface** (spec: `brand_id=PXG`); schema stays brand-aware so FLH can be enabled later without migration. |
| Q5  | Applications keep the existing lifecycle (apply → `stylist_partners` row, status `applicant`) + new child tables for questionnaire responses and rubric vetting reviews. |
| Q6  | Brand-alignment questionnaire is **config-driven** (seeded question set, Marketing edits in admin; the public form renders from the API). |
| Q7  | Probation = `probation_ends_at` on `stylist_partners`; status stays `vetted` during probation; badge/verify page shows the probation state. |
| Q8  | ID/business verification docs uploaded **at application** (public multipart, image/PDF, size-capped, rate-limited → `shared.documents`). |
| Q9  | **`shared.stylist_tiers` lookup** seeded Certified/Pro/Elite with label, rank, **payout multiplier**, validity months, badge colour. Assignments snapshot the multiplier at acceptance (column exists). |
| Q10 | **Full contract flow**: vetting pass → contract PDF from template (Puppeteer) → e-sign via existing signature tables/routes (000101, `documents.esign`) → **badge auto-issues on signature**. |
| Q11 | Downloadable **badge card** (PNG/PDF via Puppeteer) with tier, name, partner ID and QR encoding the verify URL + copyable embed link. |
| Q12 | Certification expiry: scheduled reminders at **T-30/T-7** (stylist + admin) and **auto-lapse** at expiry (verify page reflects instantly) until re-award. |
| Q13 | Routing = **ranked auto-suggest**: backend scores eligible stylists (city/distance, tier, rating, capacity, specialty); admin one-click offers to top N; weights editable (RoutingConfigPanel). |
| Q14 | **Quality-hold payout, confirm-or-window**: assignment payable when the customer confirms satisfaction OR `quality_hold_days` (default **7**, configurable) pass after completion. Disputes freeze payables. |
| Q15 | **Tokenised customer review link** (WhatsApp/email on completion) → rating + review; doubles as the Q14 satisfaction confirmation; only platform-routed customers can review. |
| Q16 | Payout approval wired to the **workflow engine** (CEO/Finance route, thresholds); payment execution stays **manual** (record transfer reference) per the cross-border licensing flag. Paystack automation later. |
| Q17 | **Full referral build** (two-way earnings): per-stylist referral links, storefront-wide attribution (public checkout + order form capture the code), commission accrual joins the payout rail, dashboards on both admin and portal sides. |
| Q18 | Notifications v1 = **email + in-portal feed** (new `stylist_notifications`); WhatsApp templates later. |
| Q19 | **Layered PR split** — PR1 schema+backend (contract frozen here), PR2 admin UI, PR3 portal public surfaces, PR4 portal authed dashboard. |
| Q20 | **Stacked branches**: PR1 on `claude/stylist-module-refactor-v3zzch`; PR2/3/4 on `…-pr2/-pr3/-pr4`, each stacked on the previous; four PRs opened as stages complete. |

---

## 2. The four sections → four PRs

```
PR1  Schema & backend        branch: claude/stylist-module-refactor-v3zzch   (merges first)
PR2  Admin Stylists module   branch: claude/stylist-module-refactor-v3zzch-pr2   (section D)
PR3  Portal public surfaces  branch: claude/stylist-module-refactor-v3zzch-pr3   (sections A + B)
PR4  Portal dashboard        branch: claude/stylist-module-refactor-v3zzch-pr4   (section C)
```

Merge order PR1 → PR2 → PR3 → PR4 (stacked; each PR's diff is only its stage).
Only PR1 touches `migrations/` and `src/`. PR2 touches only `apps/admin`.
PR3/PR4 touch only `apps/stylist` (+ root docs). Zero conflict surface.

---

## 3. Schema contract (PR1 owns)

### 3.1 New shared migration `000251_shared_stylist_programme_v2.sql`

**`shared.stylist_tiers`** (Q9, D-2)
```
tier_key TEXT PK ('certified','pro','elite'), label TEXT, rank SMALLINT,
payout_multiplier NUMERIC(4,2) DEFAULT 1.00, validity_months SMALLINT,
badge_color TEXT, display_order SMALLINT, is_active BOOL, timestamps
```
Seed: certified (1.00, 12m), pro (1.10, 12m), elite (1.25, 12m).

**`shared.stylist_programme_config`** (single row per business)
```
business TEXT PK FK business_config, quality_hold_days SMALLINT DEFAULT 7,
offer_window_hours SMALLINT DEFAULT 24, offer_top_n SMALLINT DEFAULT 3,
routing_weights JSONB DEFAULT {"distance":40,"tier":20,"rating":20,"capacity":10,"specialty":10},
referral_commission_pct NUMERIC(5,2) DEFAULT 10, applications_open BOOL DEFAULT true,
contract_template_doc_id UUID NULL, portal_subdomain TEXT, timestamps
```
Seed one PXG row (portal_subdomain 'style.pixiegirlglobal.com').

**`shared.stylist_questionnaire_questions`** (Q6) — question, help_text,
field_type ('text','textarea','select','boolean'), options JSONB, weight,
is_required, display_order, is_active, timestamps. Seeded default set.

**`shared.stylist_application_responses`** — stylist_id FK, question_id FK,
answer JSONB, created_at, UNIQUE (stylist_id, question_id).

**`shared.stylist_vetting_reviews`** (Q5) — stylist_id FK, reviewer_user_id FK
users, rubric JSONB `[{criterion,score,max}]`, total_score, recommendation
('advance','reject','hold'), notes, created_at.

**`shared.stylist_referral_links`** (Q17) — stylist_id FK, business,
code TEXT UNIQUE, label, target_path TEXT, clicks INT DEFAULT 0, is_active,
timestamps.

**`shared.stylist_referral_attributions`** (Q17) — stylist_id FK, business,
referral_code, order_id UUID (soft FK, brand schema), order_number,
order_total NUMERIC(14,2), commission_pct, commission_amount NUMERIC(12,2),
currency, status ('pending','payable','paid','void') DEFAULT 'pending',
payable_at TIMESTAMPTZ, payout_id UUID NULL FK stylist_payouts, timestamps.

**`shared.stylist_notifications`** (Q18) — stylist_id FK, type, title, body,
data JSONB, read_at, created_at.

**ALTER `shared.stylist_partners`** — add: instagram_url, youtube_url,
website_url, probation_ends_at (Q7), id_document_id / business_document_id
(Q8, FK documents), contract_document_id, contract_signature_request_id,
contract_signed_at (Q10), referral_code TEXT UNIQUE (Q17),
referral_commission_pct NUMERIC(5,2) NULL (override; falls back to config),
avg_rating NUMERIC(3,2), rating_count INT DEFAULT 0 (denormalised from
verified reviews).

**ALTER `shared.stylist_assignments`** — add: review_token TEXT UNIQUE (Q15),
satisfaction_confirmed_at, payable_at (Q14), disputed_at, dispute_reason,
dispute_resolved_at, dispute_resolution, review_hidden BOOL DEFAULT false
(admin moderation).

**ALTER `shared.stylist_assignment_offers`** — add match_score NUMERIC(6,2),
match_rank SMALLINT (Q13 analytics).

**ALTER `shared.stylist_payout_lines`** — assignment_id → NULLABLE; add
attribution_id UUID NULL UNIQUE FK stylist_referral_attributions, line_kind
('assignment','referral') DEFAULT 'assignment'; CHECK exactly one of
assignment_id/attribution_id set.

**ALTER `shared.stylist_certifications`** — add reminder_30_sent_at,
reminder_7_sent_at (Q12 idempotent reminders).

**ALTER `shared.stylist_credentials`** — add reset_token TEXT,
reset_token_expires_at, invited_at (invite + forgot-password rail).

Grants: extend `hub_stylist` SELECT to the new tables; UPDATE (read markers)
on stylist_notifications.

### 3.2 New brand template migration `000075_business_stylist_referral.sql.template`

`ALTER {{BUSINESS}}.sales_orders ADD stylist_referral_code TEXT NULL` +
index. Public checkout / order form persist a validated code here; a
subscriber writes the shared attribution row when the order is paid.

---

## 4. API contract (PR1 implements; PR2–PR4 code to this)

### 4.1 Public (`/api/public/...`, no auth, rate-limited)

```
GET  /stylist-verify/:badge_id                      (exists) + tier label/colour from stylist_tiers, probation state
GET  /stylist-programme/questions                   active questionnaire (ordered)
POST /stylist-programme/apply                       multipart: profile, city/country/geo, socials, portfolio,
                                                    answers[], id_doc, business_doc → contact + partner('applicant')
GET  /stylist-programme/directory?city&country&tier&service   certified partners, public fields only
GET  /stylist-programme/review/:token               assignment summary for the review page
POST /stylist-programme/review/:token               {rating 1–5, review} → verified review + satisfaction confirm
GET  /stylist-programme/r/:code                     referral redirect → storefront URL (?ref=code), click counted
```

### 4.2 Portal (`/api/v1/stylist-portal`, stylist JWT)

```
POST  /login                                        (exists)
POST  /password/forgot          {email}             always 200; emails tokenised link
POST  /password/reset           {token, password}   serves invite set-password too
GET   /me                                           (exists — expanded: tier+label, probation, contract state, badge)
PATCH /me                                           bio, portfolio, socials, city/geo, service_radius
PATCH /me/payout-details                            bank fields (encrypted at app layer)
GET   /offers                                       (exists)
POST  /assignments/:id/accept|decline|start|complete (exists)
GET   /assignments?status=                          (exists)
GET   /earnings                                     summary: on-hold, payable, paid, referral totals, next payout
GET   /payouts                                      (exists)  GET /payouts/:id  statement w/ lines
GET   /referrals                                    links + attributed orders + commission states
POST  /referrals/links          {label, target_path}
GET   /notifications            ?unread=            POST /notifications/:id/read · POST /notifications/read-all
GET   /badge                                        verify URL, QR payload, tier, expiry
GET   /badge/card?format=png|pdf                    generated badge card (Q11)
GET   /contract                                     doc + signing state
POST  /contract/sign            {signature_image}   via signature_request signer token → badge auto-issue
```

### 4.3 Admin (`/api/v1/stylists`, permission `stylist_programme`)

Existing routes stay. Added:

```
GET  /applications?status=&q=                       vetting queue (applicant/vetting rows + scores)
GET  /applications/:id                              full: answers, docs, rubric reviews, timeline
POST /applications/:id/review        {rubric[], recommendation, notes}
POST /applications/:id/decision      {decision: start_vetting|approve|reject, probation_months?, note}
                                     approve → vetted + probation_ends_at + contract generated+sent (Q10)
POST /:id/invite                                    create credentials + invite email
POST /:id/contract                                  (re)generate + (re)send contract
GET  /config          PATCH /config                 programme config (Q14/Q13/Q17 knobs)
GET  /tiers           PATCH /tiers/:key             tier lookup CRUD (no delete of in-use tier)
GET  /questions       POST/PATCH/DELETE /questions/:id   questionnaire management
GET  /routing/suggest?city=&country=&service_key=&scheduled_at=   ranked candidates + scores
POST /assignments/:id/offers         {stylist_ids[]} add offers (one-click top N)
POST /assignments/:id/dispute        {action: open|resolve, reason/resolution}
GET  /reviews?stylist_id=&hidden=                   verified reviews; POST /reviews/:assignment_id/visibility
GET  /referrals?stylist_id=&status=                 attributions ledger
POST /payouts/:id/submit                            → workflow instance (approval route); approve/paid endpoints
                                                    remain, approve now workflow-gated
```

### 4.4 Events, jobs, notifications (PR1)

- Events: `application.received`, `application.decided`, `contract.sent`,
  `contract.signed`, `offer.created/accepted/declined/expired`,
  `assignment.completed/disputed`, `review.received`, `payout.submitted/
  approved/paid`, `certification.awarded/expiring/lapsed` → Socket.io
  (`brand:pixiegirl:stylists`) + audit + stylist notifications + email.
- Jobs (BullMQ/cron): offer-expiry sweep; quality-hold release sweep
  (`completed_at + hold → payable_at`, notify); certification T-30/T-7
  reminders + auto-lapse; probation-end reminder.
- Referral accrual subscriber: order paid + `stylist_referral_code` →
  attribution row (`pending` → `payable` after delivery/hold).

---

## 5. PR breakdown & acceptance

### PR1 — Schema & backend · `claude/stylist-module-refactor-v3zzch`
Everything in §3 + §4. Files: 1 shared migration, 1 template migration,
`src/modules/stylist_programme/*` (new: `application.service`, `routing.service`,
`referral.service`, `contract.service`, `badge-card.service`, `notifications`),
public routes, portal route additions, jobs, subscribers, unit + integration
tests. **Acceptance:** migrations clean on fresh DB (`db:verify` count
updated); apply→vet→approve→contract→sign→badge flow passes integration;
routing suggest returns deterministic ranked list; hold/confirm gates
`generatePayout`; referral order → attribution → payout line; lint + tests
green.

### PR2 — Admin Stylists module · `…-pr2` (section D)
`apps/admin/src/pages/stylists/*` + router + modules.ts wiring. Screens:
directory (tier/city/status filters), partner profile (certs, specialities,
capacity, performance, contract, badge manager), applications board (rubric
scoring drawer, explicit decisions — **never auto-approve**), assignments
board + routing-suggest drawer, payout workbench (workflow-aware,
quality-hold visibility), reviews moderation, referrals dashboard, programme
config (tiers, weights, questionnaire, hold days, commission).
**Acceptance:** all four screen states everywhere; PXG-scoped; permission-
aware (Marketing vetting, Ops quality, CEO/Finance payouts); design canon
10-question gate run before build.

### PR3 — Portal public surfaces · `…-pr3` (sections A + B)
New `apps/stylist` (TanStack Start, port 3002): programme landing (elite
network positioning — never "a school"), application wizard (profile →
socials/portfolio → questionnaire → ID docs → review+submit), badge verify
page `/verify/badge/:token`, public partner directory, customer review page
`/review/:token` (noindex). SSR + SEO for landing/verify/directory.
**Acceptance:** apply end-to-end against PR1; verify reflects
suspend/revoke/lapse instantly; review page confirms satisfaction.

### PR4 — Portal dashboard · `…-pr4` (section C)
Authed app surface: login/invite/reset, dashboard KPIs, offers
(accept/decline with expiry countdown), assignments detail + state actions,
earnings (on-hold vs payable vs paid) + payout statements, referral links +
performance, badge + card download, contract signing screen, notifications
feed, profile + payout-details editor. **Acceptance:** stylist JWT-scoped
(server-enforced), full offer→complete→review→payout journey visible;
contract sign issues badge live.

---

## 6. Spec coverage matrix (§6.26 → PR)

| Spec aspect | PR |
| ----------- | -- |
| Public landing invites stylists to apply | PR3 |
| Application: portfolio + IG/YouTube/website + questionnaire | PR1 (API) + PR3 (UI) |
| Vetting: ID/business verification, portfolio review, rubric, probation, no auto-approval | PR1 + PR2 |
| Tiers Certified→Pro→Elite from config (D-2) | PR1 (lookup) + PR2/3/4 (render) |
| Verifiable badge: unique ID + QR + live verify page, instant revoke | exists + PR1 (tier/probation) + PR3 (page) + PR4 (card) |
| Auto-generated contract, e-signed in Hub, badge on signature | PR1 + PR2 (send/track) + PR4 (sign) |
| Verified reviews only from platform-routed customers | PR1 + PR3 (capture) + PR2 (moderation) |
| Storefront/public trusted-partner list | PR1 (API) + PR3 (directory) |
| Smart routing: nearest → tier/rating/availability/specialty weighted | PR1 + PR2 (suggest UI + config) |
| Customer pays Pixie; Pixie pays stylist; payout details collected | exists + PR4 (payout-details editor) |
| Quality-hold payout release | PR1 + PR2 (workbench) + PR4 (visibility) |
| Two-way earnings: referral commission + stylist wig-sale margin | PR1 + PR2 + PR4 |
| Ongoing QC: thresholds, complaints/disputes, re-validation, suspend/revoke | PR1 (disputes, lapse) + PR2 |
| Marketing manages, Ops quality, CEO approves payouts (workflow) | PR1 (workflow submit) + PR2 |
| Partner external dashboard: leads, bookings, earnings, statements, badge | PR4 |
| Multi-currency payouts (NGN settle + FX snapshot) | exists (schema) + PR2 statement rendering |
| Cross-border/licensing sign-off flag | surfaced as config note in PR2 payout workbench |

---

## 7. Definition of done (all PRs)
- `npm run lint && npm test` green; integration tests for the PR1 journeys.
- Four screen states on every PR2/PR4 screen; design canon respected.
- Journey runnable end-to-end on a seeded DB: apply → vet → contract → badge
  → routed assignment → complete → customer review → payable → payout
  workflow → paid; referral order → attribution → payout line.
- Public pages never leak private fields (payout details, docs, scores).
