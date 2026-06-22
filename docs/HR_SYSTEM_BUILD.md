# HR System Build — Onboarding → My HR → HR & Staff

Implements the HR design from the June 2026 meeting
(`docs/PixieGirl_Hub_Meeting_Notes_Transcript.docx` §3), cloning the
engineering/UX of the `client folder for hub-system` reference and upgrading it
onto the Maroon Noir admin kit. Built in two PRs.

## Decisions (chat answers #1–#15)

| # | Decision |
|---|----------|
| 1 | Earnings tracker = live calc **+** persisted daily snapshot |
| 2 | Lateness tiers configurable in an **HR Settings/Config tab** (default 1h=10%/2h=20%/3h=30%) |
| 3 | Lateness auto-raises a **query**; HR waive → pay restored, uphold → deduct from net; reminder after N days if ignored |
| 4 | New monthly **`performance_targets`** alongside the quarterly KPI appraisal |
| 5 | Target progress auto-sourced: stylists via Operations, sales reps via Sales (seam left for Operations) |
| 6 | Operations module is **separate/future**; HR exposes `updateTargetProgress` as the single wiring seam |
| 7 | Salary disbursement on **Nomba** (confirmed) |
| 8 | CEO **payout PIN** (argon2), set in HR Settings, required at the Pay step |
| 9 | **Unified onboarding wizard** (existing `EmployeeOnboardingPage` at `/contacts/staff/new`) |
| 10 | Provisioning: **invite or instant-create** login |
| 11 | Leave/queries routed through the **workflow engine** (Phase 2 escalation; direct approve in Phase 1) |
| 12 | Staff have a **primary brand** (owns payroll) + `additional_businesses` for cross-brand people |
| 13 | Two routes: **`/my-hr`** (everyone) + **`/hr`** (managers) |
| 14 | Reference logic ported onto our kit/tokens; all fields + better UX |
| 15 | Phase split: foundation/self-service first, money/perf ops second |

## Phase 1 (this PR) — foundation & self-service ✅

**Backend**
- Migration `000233_shared_hr_phase1.sql` (hr_settings, attendance_days,
  hr_queries, staff_earnings_daily, performance_targets, cross-brand column).
- Pure lateness/earnings engine `lateness.calc.js` (+ 17 unit tests).
- `hr_ops.repo / .service / .controller / .routes / .validator` mounted at
  `/api/v1/hr`: `/me`, `/me/leave`, `/me/queries/:id/respond`, `/overview`,
  `/attendance/reconcile`, `/attendance-days`, `/leave` (+approve/reject),
  `/queries` (+resolve), `/targets` (+progress), `/settings` (+payout-pin).

**Frontend (admin)**
- `lib/hr-api.ts` typed client.
- `pages/hr/MyHrPage.tsx` — live earnings, schedule, target countdowns,
  queries (respond), leave request, tasks, contracts.
- `pages/hr/HrStaffPage.tsx` — overview, leave inbox, queries (waive/uphold),
  attendance reconcile, target setter, HR Settings/Config tab (tiers, working
  week, payout PIN).
- Routes `/my-hr` + `/hr`; nav entries "My HR" + "HR & Staff".
- Onboarding reuses the existing unified wizard (`/contacts/staff/new`).

## Attendance PR (PR 2) — geofenced clock-in ✅

Separate focused PR between Phase 1 and the money/perf build.

**Backend**
- Migration `000234` (clock-event address + offsite, attendance-day offsite
  cols, hr_settings geofence policy) and `000235` (Help Center content).
- `flagOffsite` pure decision (record-and-flag, not reject) + 5 tests.
- Self clock-in: `GET /hr/me/today`, `POST /hr/me/clock` (captures coords + IP,
  flags off-site, blocks only when location missing on an on-site day).
- Reconcile raises an `offsite_clockin` query (precedence over lateness);
  resolve `upheld`/lapse → day absent (`POST /hr/attendance/apply-lapsed-offsite`).

**Frontend (admin)**
- Real top-bar `ClockWidget` (browser Geolocation + client reverse-geocode).
- `OfficeGeofenceSettings` — Google-Maps office/perimeter editor (radius circle,
  draggable pin, manual fallback) in the HR Settings tab + geofence policy toggles.
- Attendance tab shows clock-in address, off-site distance, and a lapsed-penalty action.

**Design guardrails (from the brainstorm):** geofence enforced only on on-site
days; off-site is provisional + queried, absent only after upheld/lapse with HR
override; generous radius + accuracy-flag (not auto-reject); point-in-time
capture, disclosed; coords are truth, spoofing treated as deterrent + audit.

## PR 3 — Payroll & disbursement (money flow) ✅

The meeting's core pay flow (§3.4): calculate → review → **CEO approve → enter
PIN → pay each employee's bank**, on top of the existing payroll engine.

**Backend**
- `disbursement.service.js` — provider-agnostic payout: selects the brand
  provider (Nomba, answer #7) and falls back to a **manual bank-schedule
  (queued)** when unconfigured, so payroll never blocks. Per-slip result maps to
  `payment_status` (paid / queued / failed); failed slips stay payable for retry.
- `nomba.service.disburseSalary` — Nomba bank-transfer adapter (endpoint flagged
  for go-live confirmation; reports `not_configured` → manual fallback).
- `payroll.service.payRun` — **payout-PIN gated** (verifies the hashed PIN from
  HR Settings, answer #8), disburses every payslip, settles commissions/bonuses
  for paid/queued slips, audits the run. Wired to `POST /hr/payroll-runs/:id/pay`.
- Unit tests: 8 for disbursement selection/result mapping.

**Frontend (admin)**
- `pages/hr/PayrollPage.tsx` — runs list, create run, run detail stepper
  (Calculate → Send for approval → Approve → **Pay (enter PIN)**), payslip list
  with per-slip payment status. Route `/payroll`; nav "Payroll".

**Verified:** 285/285 backend tests; ESLint clean; admin `tsc` → 0 errors.

## PR 4 — contract generation + target→bonus automation ✅

- **Contract generation:** `contractHtml` PDF template + `contracts.service`
  generates an employment-contract PDF, stores it via the documents service, and
  records a `staff_contracts` row linked to the document. Routed at
  `POST /hr/employees/:id/contract` (+ `GET …/contracts`). The stored document
  flows through the existing e-signature module (send-for-signing) — no separate
  e-sign build needed. Frontend: "Generate contract" modal in HR & Staff;
  contracts already surface in My HR.
- **Target → bonus:** `updateTargetProgress` emits a distinct `target_achieved`
  transition event; `target.subscribers` awards a pending-approval bonus exactly
  once (pct-of-salary or fixed ₦), defensively (failures logged, never block
  progress). Still flows through HR approval + payroll.

## PR 5 (remaining) — reviews UI, dashboards, automation

- Performance reviews UI (quarterly weighted KPIs); HR dashboards/analytics.
- Nightly reconcile + query-reminder cron; leave/query workflow escalation.
- Praxis-AI HR actions; **Operations module** wires stylist target progress +
  quality ratings into `updateTargetProgress` (seam documented in
  `hr_ops.service.js`).
- Bank-code capture for Nomba NIP transfers + payout-status webhook (pending
  the Nomba payout endpoint confirmation).
