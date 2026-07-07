# Human Capital — Full Coverage Audit & Revamp Plan (2026-07-04)

Scope: every HR-concerned surface in the Hub, audited against the **meeting
transcript** (`docs/PixieGirl_Hub_Meeting_Notes_Transcript.docx` §3 — most
recent, SSOT), the **Product Description v2.2 §6.11/§6.11.1**, the
**HR build log** (`docs/HR_SYSTEM_BUILD.md`) and the engineering guides.
Covers: employee creation/provisioning, My HR, HR & Staff, attendance +
geolocated clock-in, queries, leave, targets, performance reviews, payroll +
payslips + disbursement, rewards, messaging (SmartComm) integration, and the
cross-module deep linking of the employee record.

---

## 1. Executive summary — where we stand

The HR core described in the meeting is **built and live end-to-end**:
onboarding wizard → staff profile → login provisioning (invite or
instant-create) → geofenced clock-in with IP + coords → nightly reconcile →
lateness tiers → auto-queries → waive/uphold → daily earnings snapshot →
monthly targets with live countdowns → target-achieved bonuses → payroll run
state machine → CEO approval → payout-PIN → Nomba disbursement (manual-queue
fallback) → GL posting. 285 backend tests pass; the module follows the house
architecture cleanly.

What stands between this and the "HR masterpiece" is mostly **connection
tissue and money-accuracy**, in four clusters:

1. **Payroll ≠ attendance (critical).** The payslip is built from *full base
   salary* + commission + bonus. The lateness/absence deductions the employee
   watches all month in My HR **never reach the payslip**, upheld queries do
   not "deduct from net" (§3.4/answer #3), there is no pro-rating for
   mid-month joiners/leavers (§3.5), and cash-advance recovery (§6.11) is a
   payslip field that is never fed.
2. **PAYE is always on (blocker for Faith's current practice).** Nigerian
   PAYE bands + pension + NHF + NSITF are *seeded active* per brand, so every
   run withholds full statutory deductions. There is no "simple pay" switch.
3. **The employee record is not yet a hub.** No employee-360 page (click an
   employee → everything + insights), the `/hr?contact=…` deep link from the
   contact profile is dead, My HR fetches attendance but never renders it, no
   map links on clock-ins, no earliest/latest analytics, no rewards engine,
   and Messaging has no "find a colleague and DM them" entry point even
   though the backend supports internal DMs.
4. **Reverse geocoding is client-side Google.** Exactly the failure mode you
   hit before; to be replaced with server-side Geoapify at clock-in (stored
   label + backfill), per the implementation guide you supplied.

Nothing found requires re-architecture. The revamp plan in §6 sequences the
work as 6 PRs.

---

## 2. Transcript §3 (SSOT) coverage matrix

| § | Requirement | Status | Evidence / gap |
|---|-------------|--------|----------------|
| 3.1 | Personal dashboard for every employee; admins get both views | ✅ | `/my-hr` (all staff) + `/hr` (managers), `apps/admin/src/pages/hr/` |
| 3.1 | Real-time earnings tracker (monthly salary pro-rated daily, accumulates) | ✅ | `lateness.calc.js` + `staff_earnings_daily` + My HR hero tiles |
| 3.1 | Lateness deductions in real time (1h=10% / 2h=20% / 3h=30%, configurable) | ✅ | Configurable tiers in HR Settings; immediate late feedback on punch (`selfClock`) |
| 3.1 | Bonus & commission tracking as they accrue | ⚠️ Partial | Backend `commission_earned`/`bonuses_awarded` exist; My HR does **not** show accrued commission/bonus lines — only target countdowns |
| 3.1 | Performance target countdown ("20 styles away") | ✅ | `performance_targets` + TargetCountdown card |
| 3.1 | Leave requests + absence history | ⚠️ Partial | Request/approve/history ✅; **absence/attendance history is fetched but not rendered** on My HR (`getMyHr` returns `attendance`; `MyHrPage.tsx` never displays it) |
| 3.1 | Assigned tasks + status | ✅ | `tasksForUser` → My HR "My tasks" |
| 3.1 | Contracts, SOPs, onboarding docs on dashboard | ⚠️ Partial | Contracts ✅ (generation + e-sign + listed). SOP/onboarding-pack surface for first login not present |
| 3.2 | Clock-in captures IP, geolocation, timestamp | ✅ | `selfClock` records coords + accuracy + IP + UA; geofence flags off-site |
| 3.3 | Monthly targets set by Faith/HR; auto-counted; quality ratings by Ops Manager | ⚠️ Partial | Targets + auto progress from Sales (`order.paid`) and Service Jobs (`completed`) ✅. **Quality ratings** are stored on service jobs but feed neither appraisals nor targets (seam documented, unwired) |
| 3.4 | Payroll: auto calc of attendance+deductions+bonuses+commissions → HR review → CEO approve → PIN → auto pay | 🔴 **Gap in the middle** | Flow/stepper/PIN/disbursement ✅. But `calculateRun` (`payroll.service.js`) ignores `staff_earnings_daily` — **attendance deductions & upheld queries never hit net pay** |
| 3.5 | Paid/unpaid leave, justified/unjustified absence, pro-rating for mid-month joiners/leavers | 🔴 Partial | Leave types + justification loop ✅. **No pro-rating** in payslip calc; paid-vs-unpaid leave does not affect pay |
| 3.6 | Task/styling-job assignment; completion confirmed by Ops Manager | ✅ | Service Jobs board + completion flow; feeds target progress |
| 3.7 | Contracts/SOPs/onboarding visible; new employees see onboarding on first login | ⚠️ Partial | Contract PDFs ✅; no first-login onboarding experience |
| 3.9 | "As intuitive as WhatsApp", floating help button on every page | ✅ | `FloatingLauncher` (Praxis · Messages · Help) + Help Center content (migration 000235) |

## 3. Product Description §6.11 extras

| Requirement | Status | Note |
|---|---|---|
| Staff records: probation, leave balance, non-solicitation, dismissal-trigger notes | ✅ schema / ⚠️ UI | Columns exist (`000003_shared_people.sql`); probation & terms not surfaced anywhere in HR UI |
| Early departures recorded | 🔴 | Clock-out events stored, but reconcile only looks at first clock-in; no early-leave detection, no last-out on `attendance_days` |
| Commission per sale w/ channel | ✅ | `commission_rules` + subscribers |
| Weighted appraisal, auto-populated scores from Sales/CRM/Jobs/Attendance | ⚠️ | Cycles + weighted KPIs + manual "Score staff" ✅; **auto-population unwired** |
| Bonus triggers (4.8+ rating, quarterly, recognition) | 🔴 | `bonus_rules` table has `trigger_criteria`/`is_auto_triggered` but **nothing evaluates it** — pure CRUD config |
| Payroll deducts outstanding cash advances | 🔴 | `advance_recovery_ngn` exists on payslips; never fed from Cash Request/Expenses |
| Leave on Calendar | 🔴 | Not wired into `shared/calendar` |
| Accounting postings on approval | ✅ | Policy Q3 accrual booked atomically at approve |

## 4. New requirements from this session

| Ask | Current state | Verdict |
|---|---|---|
| **Geoapify reverse geocoding** (server-side at clock-in, stored label, map link) | Client-side Google Maps Geocoder (`apps/admin/src/lib/geo-capture.ts`); address passed up from the browser; fails silently when Maps isn't configured. Coords + address columns already exist on `staff_clock_events` and `attendance_days` | **Build** — direct port of your guide; plus backfill script |
| **"View on map" link** in HR + My HR attendance rows | Lat/lng returned by API (`SELECT ad.*`) but the frontend type omits them; no link rendered anywhere; My HR renders no attendance at all | **Build** (small) |
| **Earliest/latest at work, per-employee patterns, query-liable days** | Not computed anywhere (no MIN/MAX clock-in analytics) | **Build** |
| **Rewards engine** (first-in / last-to-leave / prompt data entry / period bonuses / salary-calc increases) | Only monthly target→bonus exists. `bonus_rules` is dormant config. No attendance-derived awards, no streaks, no multi-month programmes | **Build** |
| **Payslip without PAYE ("simple pay")** | PAYE + pension + NHF + NSITF **seeded active** (`000035_business_seed_data.sql.template`) → every run withholds statutory deductions | **Build toggle** — per-brand `statutory_deductions_enabled` (+ per-employee override), payslip template hides zero lines |
| **Employee 360 ("click an employee → everything + insights")** | Contact profile has generic tabs; its Employment tab deep-links to `/hr?contact=…` **which HrStaffPage ignores** (dead link). HR has no directory of its own, no per-employee drill-down | **Build** — flagship page of the revamp |
| **Search employee from Messaging and DM them** | SmartComm backend fully supports internal direct/group channels (`createChannel`, members, @mentions); `smartcomm-api.ts` exposes `createChannel`; but `SmartCommPage` never passes `onNewChannel` to `ChannelList` — **no UI entry point** | **Build** (small–medium) |
| **Provision new employee into messaging** | Onboarding creates login (invite/instant) but never touches SmartComm; no auto welcome channel/team channel membership | **Build** (small) |

## 5. Findings register

### 5.1 Critical (money correctness)

| # | Finding | Where |
|---|---------|-------|
| C1 | Payslip ignores attendance: net pay never reflects lateness/absence deductions or upheld queries; the My HR tracker and the payslip disagree at month-end | `payroll.service.js calculateRun` — builds from `base_salary + commission + bonus` only |
| C2 | No pro-rating for mid-month joiners/leavers, and unpaid leave doesn't reduce pay | same |
| C3 | Statutory deductions always on; Faith currently pays simple salaries | seeded `payroll_deductions` + no toggle in `hr_settings` |
| C4 | Cash advances/loans never recovered through payroll despite payslip fields | `extraDeductions` never populated |

### 5.2 High (SSOT features missing/unwired)

- H1 Quality ratings (Ops Manager) don't feed targets or appraisal scores (§3.3).
- H2 `bonus_rules` auto-triggers never evaluated (product description bonus triggers; your rewards ask lands here).
- H3 No early-departure/last-clock-out reconciliation (blocks "last to leave" reward + §6.11 early departures).
- H4 Employee-360 absent; `/hr?contact=` deep link dead; HR directory delegates to Contacts with no HR context.
- H5 My HR renders no attendance history (fetched, dropped) — no place/time of clock-in, no lateness history, no query-liable days view.
- H6 Messaging: no new-conversation UI (internal DM/group), no message-this-employee action on profiles, no auto-provisioning into channels.
- H7 Reverse geocoding client-side on Google; replace with server-side Geoapify + backfill (your guide).

### 5.3 Medium (UX/UI + polish)

- M1 HR Attendance tab is **today-only** — no date range, no employee filter, no map link, hard LIMIT 500 with no pagination.
- M2 Payslip rows show number + gross/net but **no employee name**, and the existing `POST /payslips/:id/pdf` endpoint has **no download button** in the UI.
- M3 My HR shows no payslip history (employee can't see/download their own payslip — §3.4's end artifact).
- M4 Analytics tab is current-month only (no month picker, no trends, no per-department rollup — flagged as PR-6 leftovers in the build doc).
- M5 Commission/bonus accruals invisible to the employee (only targets show).
- M6 Onboarding wizard doesn't offer "set first monthly target" or "add to team channel" as final steps — provisioning ends at login credentials.
- M7 Probation status/terms not shown anywhere (schema exists).
- M8 Leave approvals don't reflect on the shared Calendar.
- M9 `ClockWidget` hides entirely on error — a staff member with a transient 500 gets no clock-in affordance (silent failure).

### 5.4 Performance notes (fine today, worth fixing while in there)

- P1 `date_part('year'|'month', work_date)` predicates are non-sargable — swap to `work_date >= $from AND work_date < $to` so the `(profile_id, work_date)` index is used (`analytics`, `earningsMonthToDate`).
- P2 `reconcileDay` runs ~6 queries per staff member inside one transaction — O(n) round-trips; batch the upserts (single `INSERT … SELECT unnest(...)`) if headcount grows.
- P3 `getMyHr` fires 7 parallel queries — good; keep. `getOverview` filters `pending_justifications` in JS after pulling all late days — push `justified = false` into SQL.
- P4 Frontend invalidations use broad `{ queryKey: ["hr"] }` — acceptable; consider narrowing on the busiest mutations (clock punch).

---

## 5.5 Delivery status

- **PR1 (merged)** — payroll truth (C1–C4), reconcile guard, Geoapify
  server-side geocoding + backfill, clock-out/early-leave, Lagos TZ, HR
  Attendance overhaul + map links, payslip names + PDF, HR Settings payroll
  card. (P1/P2 sargability/batching deferred; the date filters already use
  `work_date >=/<=` in the new period queries.)
- **PR2 (this branch)** — the connected employee: **Employee 360**
  (`/hr/employees/:id` + `GET /hr/employees/:id/dossier`) with the insights
  header (earliest/latest arrival & departure, punctuality, tenure, target
  attainment, quality), **HR Directory** tab, fixed `/hr?contact=` deep link
  (H4); **My HR completion** — attendance history with map links,
  earliest/latest chips, days-at-risk, own payslips + PDF, commission/bonus
  accruals (H5, M3, M5); **Analytics month picker** (M4); **leave → Calendar**
  (M8); **ClockWidget resilience** (M9); probation/terms surfaced (M7); Praxis
  `hr_employee_360` query. Onboarding first-login pack and P2/P3 perf batching
  roll into a later pass.
- **PR3 (this branch)** — **rewards engine** (H2): `reward_rules` +
  `reward_grants` (migration 000258), metric queries (first-in / last-out /
  punctual days / prompt data entry / jobs / sales / quality), a nightly
  idempotent evaluator that grants rewards on threshold — monetary rewards
  flow through the bonus → payroll pipeline, salary increases are applied
  explicitly (base salary + amendment). HR **Rewards tab** (rule builder,
  live leaderboard, grants) + My HR "my rewards" card. **Quality wiring**
  (H1): real service-job QC average feeds the Employee-360 quality insight and
  is a reward metric (appraisal auto-scoring left as a documented seam).
  **Messaging × HR** (H6, M6): find-or-create 1:1 DM
  (`POST /smartcomm/channels/direct`), a new-conversation employee search, and
  `?dm_user=` deep links behind the "Message" buttons on the 360.
- **PR-A (onboarding pack, deferred item A)** — a My HR "Getting started"
  card (always available): the brand `onboarding_checklist` ticked per
  employee (`staff_onboarding_progress`), a welcome note, SOP articles (Help
  Center tag `onboarding`), the employee's own documents, handy links
  (`hr_settings.onboarding_links`), and contracts with signature status +
  View. HR Settings gains an onboarding editor; Employee 360 shows a
  completion tile. Migration 000259. **Note:** the in-app *signer* page is
  still a separate follow-up — HR sends contracts for e-signature from the
  Documents module (backend + admin send-flow already exist); employees sign
  via the emailed token link.
- **Deferred (still open, non-blocking):** in-app e-signature *signer* page;
  new-hire auto-provision into a brand channel; appraisal auto-population from
  Sales/CRM/Jobs (PR-B tackles the scoring seam); P2/P3 query batching.

## 6. Revamp plan — "full connection & deep linking"

Sequenced so money-correctness lands first, then the connective tissue, then
the delight layer. Each PR is independently shippable.

### PR-A — Payroll truth (fixes C1–C4)
1. `calculateRun`: pull the run period's `staff_earnings_daily` per profile →
   `attendance_deduction_ngn` (new payslip column + line), pro-rate base by
   `earned/projected` for joiners/leavers, subtract unpaid-leave days.
2. `hr_settings.statutory_deductions_enabled` (default **off** for both
   brands, per Faith's current practice) + per-employee
   `statutory_exempt` override; when off, `deductionConfigs = {}` so PAYE /
   pension / NHF / NSITF are zero and the payslip PDF hides zero lines. UI
   toggle in HR Settings → "Payroll" card, with copy explaining full
   statutory mode can be enabled later.
3. Advance recovery: on calculate, look up open cash-advance balances
   (cash_request module) for the employee → fill `advance_recovery_ngn`
   capped at a configurable % of net; settle back on pay.
4. Reconciliation guard: block `review` transition if any working day in the
   period is unreconciled (surface "Reconcile period" button).

### PR-B — Geoapify + attendance depth (H3, H7, M1, map links)
1. `src/integrations/geocoding/geoapify.js` — `reverseGeocode(lat, lng)` per
   your guide: 3s timeout, `format=json`, handles both `results[0].formatted`
   and `features[0].properties.formatted`, never throws. Key from
   `GEOAPIFY_API_KEY` env (server-side only — do not commit the key; set it
   in the deploy env).
2. `selfClock`: geocode **before** the transaction when the client didn't
   supply an address (and stop relying on the Google client geocode —
   `geo-capture.ts` returns coords only).
3. Backfill script `scripts/backfill-clockin-addresses.js` (coords without
   label → Geoapify, rate-limited).
4. Reconcile clock-outs: store `last_clock_out_at` + `early_leave_minutes`
   on `attendance_days`; both feed rewards + §6.11 early departures.
5. Attendance UI (shared cell used by **both** HR table and My HR):
   `https://www.google.com/maps?q=<lat>,<lng>` link with pin icon, stored
   address label, fallback "View on map", "—" when no coords. Add date-range
   + employee filters and proper pagination to the HR Attendance tab.

### PR-C — My HR completion (H5, M3, M5)
1. Attendance section: month calendar/list — clock-in time & place (map
   link), late minutes, deductions, off-site flags; **earliest day / latest
   day this month** stat chips; "days at risk of query" strip (late or
   off-site, unresolved).
2. Pay section: payslip history + PDF download (surfaces the existing
   endpoint); commission & bonus accruals with status.
3. First-login onboarding card: contracts to sign, SOP links (Help Center
   articles tagged `onboarding`), profile checklist.

### PR-D — Employee 360 + HR directory (H4, M7)
1. `/hr/employees` directory tab (photo, role, dept, brand, status,
   punctuality %, quick actions) and `/hr/employees/:profileId` — the
   everything-page: profile & employment terms (probation, schedule, bank
   masked), attendance timeline + map, earnings & payslips, targets & bonuses,
   queries & leave, contracts & documents, appraisal history, rewards, and an
   **Insights** header (earliest/latest arrival, punctuality trend, target
   attainment, quality average) powered by a new `GET /hr/employees/:id/insights`.
2. Fix the dead deep link: `ContactDetailPanel` Employment tab →
   `/hr/employees/:profileId`; back-link from 360 to the contact profile.
   Route `/hr?contact=…` → redirect to the 360.
3. Praxis: register `hr_employee_360` read query so "tell me about <employee>"
   answers from the same endpoint, permission-gated.

### PR-E — Rewards engine (H2, your bonus programme)
1. Activate `bonus_rules`: `trigger_criteria` schema
   `{ metric, comparator, threshold, period: month|quarter|custom, streak? }`
   with metrics: `first_clock_in_count`, `last_clock_out_count`,
   `punctual_days_streak`, `data_entries_count` (from audit-log activity),
   `styles_completed`, `sales_count`, `quality_avg`.
2. Nightly evaluator (extends the 23:30 sweep): computes per-employee metric
   standings; on period close, awards `bonuses_awarded` rows
   (pending-approval, exactly-once via period key) → flows through the
   existing approval + payroll pipeline. Salary-increase rewards create a
   **pending contract amendment** (never silently mutate base salary).
3. HR UI: "Rewards" tab — rule builder (e.g. "First at work ≥ 15 days in a
   month → ₦20,000"), live leaderboard, awarded history. My HR: "My rewards"
   card with streaks and standings (motivation, mirrors the target countdown).
4. Wire quality ratings: service-job QC → `bumpTargetProgress(quality_avg)` +
   appraisal auto-score seam (closes H1 too).

### PR-F — Messaging × HR (H6, M6)
1. New-conversation flow: `+` button on ChannelList (already has the
   `onNewChannel` prop) → modal with staff search (reuses `listStaff`) →
   creates/reuses an internal direct channel → routes to `?channel=…`.
2. "Message" quick action on the employee 360, HR directory rows, and the
   contact profile (staff type) — deep-links into SmartComm with the DM open.
3. Onboarding provisioning: final wizard step — add to brand-wide "General"
   channel (auto-created per brand) + optional department channel; welcome
   message posted by the system.
4. HR events → notifications already exist; add DM deep links (query
   reminders "Open in My HR").

### Cross-cutting
- Timezone: reconcile/lateness math uses UTC (`todayStr()`/`ym()`); pin all
  attendance-day boundaries to `Africa/Lagos` (sweep already runs 23:30
  Lagos) — one utility, used everywhere.
- Fix P1–P3 while touching the repo files.
- Keep the meeting's UX bar: every new screen ships loading/empty/error/denied
  states, mobile-first, tokens only (no inline hex), glass overlays.

### Suggested order & sizing

| PR | Size | Depends on |
|----|------|-----------|
| A — Payroll truth | M | — |
| B — Geoapify + attendance depth | M | — (parallel with A) |
| C — My HR completion | M | B (map cell), A (payslips) |
| D — Employee 360 | L | B |
| E — Rewards engine | L | B (clock-out data), A (payroll hook) |
| F — Messaging × HR | S–M | D (entry points) |

---

## 7. Operator notes

- `GEOAPIFY_API_KEY` must be set in the **server** environment (free tier
  3,000 req/day is ample). Keep it out of the repo; restrict by IP in the
  Geoapify dashboard.
- Historical clock-ins have coords but no address until the backfill script
  runs (they'll show "View on map" meanwhile — by design).
- Existing operator follow-ups from the build log still stand: confirm the
  Nomba payout endpoint mapping, set the CEO payout PIN, and draw each
  office geofence in HR Settings.
