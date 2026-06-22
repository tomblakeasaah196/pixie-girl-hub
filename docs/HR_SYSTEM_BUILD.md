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

## Phase 2 (next PR) — money & performance ops

- Payroll run UI + **Nomba disbursement** + CEO payout-PIN gate at Pay.
- Commission/bonus automation; monthly-target → bonus payout on achievement.
- **Contract generation** (PDF from template) + **e-signature** on
  `staff_contracts` (esignature tables already exist).
- Performance reviews UI (quarterly weighted KPIs); HR dashboards/analytics.
- Nightly reconcile + query-reminder cron; leave/query workflow escalation.
- Praxis-AI HR actions; **Operations module** wires stylist target progress +
  quality ratings into `updateTargetProgress` (seam documented in
  `hr_ops.service.js`).
