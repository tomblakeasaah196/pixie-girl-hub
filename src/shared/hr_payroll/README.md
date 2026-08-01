# HR & Payroll (V2.2 §6.11)

Module key: `hr_payroll`. Mounted at `/api/v1/hr`. (Auth lives in the same
folder: `auth.*` + `staff.repo.js` resolve login identity; this README covers
the HR admin surface.)

## Pass 1 — employees + Tier-1 configuration (this delivery)

| Area               | Routes (`/api/v1/hr/...`)               | Table                                 |
| ------------------ | --------------------------------------- | ------------------------------------- |
| Employees          | `/employees`                            | `shared.staff_profiles`               |
| Commission rules   | `/commission-rules`                     | `{brand}.commission_rules`            |
| Bonus rules        | `/bonus-rules`                          | `{brand}.bonus_rules`                 |
| KPI definitions    | `/kpi-definitions` (+`/weight-summary`) | `{brand}.performance_kpi_definitions` |
| Performance cycles | `/performance-cycles`                   | `{brand}.performance_cycles`          |
| Payroll deductions | `/deductions`                           | `{brand}.payroll_deductions`          |

Each is full CRUD (`GET` list/detail, `POST`, `PATCH`, `DELETE`) gated on
`hr_payroll` view/create/edit/delete.

### Key behaviours

- **Employee PII is encrypted at rest.** `bank_account_number`,
  `bank_sort_code`, `nin`, `bvn` are AES-256-GCM encrypted on write
  (services/encryption.service) and decrypted on read, then **masked** unless
  the viewer is the owner/CEO (account number shows last 4; the rest fully
  masked). Every employee write is audited as sensitive and never logs raw PII.
- **KPI weights.** The weighted appraisal (default 40/25/20/15) must total 100.
  `GET /kpi-definitions/weight-summary` returns `{ total, target: 100, balanced }`
  so the UI can enforce it while still allowing incremental editing.
- **Cycle deletion guarded.** A `performance_cycle` can only be hard-deleted
  while `upcoming`; otherwise close/archive (its status lifecycle).
- **Soft-delete.** Employees use `is_deleted`/`deleted_at`; config tables with
  an `is_active` flag deactivate rather than delete.

### Building blocks

- `brand-crud.repo.js` — a reusable parameterised CRUD factory (per-brand or
  shared schema, real count, dynamic insert/update with JSONB/array casts,
  soft/hard delete). The five config repos are thin specs over it.
- `hr.fields.js` — pure PII-masking + KPI-weight helpers (unit-tested).

## Pass 2 — payroll operations (this delivery)

| Area            | Routes (`/api/v1/hr/...`)                                       | Table                         |
| --------------- | --------------------------------------------------------------- | ----------------------------- |
| Payroll runs    | `/payroll-runs` + `/:id/{calculate,review,approve,pay,reverse}` | `{brand}.payroll_runs`        |
| Payslips        | `/payslips` + `/:id/{breakdown,recalculate,pdf}` + `/:id/attendance/:dayId/resolve` | `{brand}.payslips` + `_lines` |
| Commissions     | `/commissions` + `/:id/{approve,reverse}`                       | `{brand}.commission_earned`   |
| Bonuses         | `/bonuses` + `/:id/{decision,reverse}`                          | `{brand}.bonuses_awarded`     |

- **Run state machine:** `draft → calculated → reviewed → approved → paid`
  (+ `reversed`); transitions are enforced. `calculate` rebuilds every active
  staffer's payslip from base salary + payable commissions + approved bonuses,
  applies the active PAYE/pension/NHF config (Pass-1 `payroll_deductions`), and
  rolls up run totals. `pay` settles payslips and links/settles the underlying
  commissions & bonuses.
- **Payroll math** lives in `payroll.calc.js` (pure, unit-tested): progressive
  PAYE over configured bands, consolidated relief, pension/NHF, payslip
  assembly with itemised lines (employer pension is reported, not withheld).
  It is **config-driven** — no tax year is hardcoded.
- **Numbering:** `services/numbering.service.js` allocates `run_number`,
  `payslip_number`, `earning_number`, `bonus_number` atomically from
  `shared.document_numbering` inside the transaction (shared with future
  finance modules).
- **Commissions:** accrue → approve → paid (or reversed). **Bonuses:** award →
  approve/reject (gated on `hr_payroll.approve`) → paid (or reversed).
- **Payslip figures are never edited by hand.** A slip changes only by being
  recalculated from the underlying attendance / commission / bonus truth, and
  payment is settled by the run's `pay` action.
- **Per-employee review + waive/uphold** (`payslip.breakdown.js`, pure/unit-tested):
  `GET /payslips/:id/breakdown` returns one employee's whole story for the period
  — every flagged attendance day with the query the reconciler raised and the
  employee's response, every commission/bonus being added, and a projection of
  what the net becomes if the run were recalculated now. `POST
  /payslips/:id/attendance/:dayId/resolve` waives or upholds ONE line (gated on
  `hr_payroll.approve` — it moves pay), and `POST /payslips/:id/recalculate`
  re-costs that single slip and re-derives the run's totals from its payslips.
  Locked once the run is approved/paid.
- **One decision primitive:** `hr_ops.setDayJustification()` is the only place a
  lateness decision changes money — the query inbox (`/queries/:id/resolve`) and
  the payroll review sheet both call it, so an employee can never see one answer
  in My HR while payroll acts on another. Waiving flips `attendance_days.
  justified` on and upholding flips it back off; the deduction amount is
  **preserved either way**, which is what makes a waive reversible.
- **One calculation path:** `computeSlipForStaff()` in `payroll.service.js` is
  shared by the whole-run calculate and the single-employee recalculation, so a
  slip recomputed alone can't disagree with the same slip recomputed in its run.
- **Payslip PDF** (`payslip.pdf.js`, pure/unit-tested): a full-page, brand-skinned
  A4 document on the same canon as the invoice/receipt renderer
  (`services/pdf.brand-docs`) — employer identity from `business_config`, the
  employee and period, itemised earnings beside itemised deductions, net pay in
  figures and words, employer contributions kept out of the deductions column,
  and the payment trail. It draws its own sheet, so it renders with
  `brandDocs.PDF_OPTIONS` (zero engine margins).

## Pass 3 — appraisal execution + attendance (next)

Performance `scores`/`reviews` (the scoring/calibration/acknowledge flow on top
of the Pass-1 KPI definitions) and attendance (`staff_clock_events` +
`geofences`, geolocated clock-in §6.11.1).
