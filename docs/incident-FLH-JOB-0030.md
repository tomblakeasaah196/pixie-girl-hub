# Incident Report — FLH-JOB-0030 "missing hair"

**Date of investigation:** 8 August 2026
**Raised as:** "The hair on this order is missing."
**Job:** FLH-JOB-0030 · **Order:** FLH-SO-0059 · **Brand:** Faitlynhair
**Product:** Lita Signature Full Frontal Black (base: Black Straight HD13x6 Pixie Wig – XL)
**Customer:** Paulina Quaye
**Source:** Direct query against `pixiedata` (`faitlynhair.service_jobs`, `shared.audit_log`,
`faitlynhair.wig_custody_ledger`, `faitlynhair.service_job_time_logs`, `shared.tasks`).
Query preserved at `scripts/investigate-job.sql`.

---

## 1. Answer to the question asked

The hair was assigned to **Blessing Donatus** (in-house staff, user ID
`fb725616-890e-487b-9615-0055492a3eb6`).

Per the wig custody ledger, the wig went **out** to her on **23 July 2026 at 10:26** and
**no return has ever been logged**. As far as the system is concerned she has held it for
16 days.

## 2. Timeline

| Time (23 Jul 2026, UTC) | Actor | Event |
|---|---|---|
| 08:02:25 | `system` | Job FLH-JOB-0030 opened from order FLH-SO-0059 (`service_jobs.from_order`) |
| 10:26:45 | Samuel Ifeoluwa | Job assigned to Blessing Donatus (`service_jobs.assign`) |
| 10:26:45 | Samuel Farounbi | Custody ledger: wig **out**, qty 1, reason "assigned to stylist" |
| 10:26:45 | — | Task "Service Job FLH-JOB-0030" raised for Blessing, due 24 Jul 08:02 |
| 10:40:44 | Faitlyn Alex | Job **cancelled** (`service_jobs.advance`), 14 minutes after assignment |
| — | — | **No custody return. No restock. Task never closed.** |

Supporting facts:

- **Time logs: zero rows.** Blessing never clocked on to the job. No work was started.
- **Task status: still `to_do`**, assigned to Blessing, due 24 July — an orphan on her list.
- **Cancellation reason: blank.** Nothing recorded about why it was cancelled.
- **`created_by`: null.** The job was opened by a script, not a signed-in user —
  consistent with the multi-hair backfill (`scripts/backfill-multi-hair-jobs.js`) that
  was run that day to split multi-hair orders into one job per hair.
- **Order FLH-SO-0059 is still at status `assigned`** and has never been fulfilled.
- **Sibling job FLH-JOB-0021**, same order, also assigned to Blessing Donatus, created
  3 July 2026 and **still `in_progress`** more than a month later. This order has two
  wigs against one stylist and neither has closed.
- **`updated_at` on FLH-JOB-0030 is 5 August 2026** — the row was touched two weeks
  after cancellation. Not yet explained.

## 3. Root cause

Two separate defects, both confirmed in the code.

### Defect A — cancelling an assigned job does not unwind custody

`advanceJob()` in `src/modules/service_jobs/service-jobs.service.js` (line ~286), when
moving a job to `cancelled`, writes **only** the `cancelled_at` timestamp.

Compare `unassignStaff()` in the same file (line ~1090), which performs the full unwind:

1. logs a balancing `return` row in `wig_custody_ledger`,
2. calls `restockBaseWig()` to put the unit back into stock,
3. clears `assigned_staff_user_id`.

The cancel path does none of these three. The consequence is that **every job cancelled
while assigned leaves a wig permanently reading as "out" with the stylist, stock never
restored, and an open task on that stylist's list.** FLH-JOB-0030 is one instance; it is
very unlikely to be the only one.

### Defect B — the assigned stylist's name was invisible in the admin UI

The data was never lost: `assigned_staff_user_id` has been populated on this row the
entire time. The admin simply had no name to render.

- `getServiceJob()` in `service-jobs.repo.js` returned the assignee as a bare UUID and
  never joined `shared.users`. The frontend resolved the name client-side against the
  **assignable stylists** list, so anyone off that roster fell back to the generic label
  "Assigned stylist".
- Where a job has been unassigned or cancelled and the assignment field cleared, the
  assignment panel rendered empty entirely.

This is why the drawer could not tell anyone who was holding the wig.

## 4. Fixes already applied (in the working tree, not yet deployed)

Defect B is fixed:

- `src/modules/service_jobs/service-jobs.repo.js` — `getServiceJob()` now returns
  `assigned_staff_name`, `assigned_stylist_name`, and `last_custody_holder_name`
  (the latter derived from the custody ledger, which is never rewound and therefore
  survives completion, cancellation and unassignment).
- `apps/admin/src/pages/service-jobs/types.ts` — new fields typed.
- `apps/admin/src/pages/service-jobs/JobBoard.tsx` — new read-only `HistoricAssignee`
  row shows "Was assigned to (job cancelled)" / "Completed by" when there is no live
  assignee; `AssignedRow` falls back to the server-joined name; the stylist picker no
  longer opens on terminal jobs.

**Not yet run:** `npm run build` in `apps/admin`, and the backend test suite. These must
pass before deploy.

**Defect A is NOT fixed.** No change has been made to the cancel path.

## 5. Recommended actions

1. **Physically confirm the wig with Blessing Donatus.** The system says she has held it
   since 23 July. Recover it and log the custody return.
2. **Fix Defect A** — make the cancel path mirror `unassignStaff()`: log a custody
   `return`, restock the base wig, close the linked task, and require a cancellation
   reason.
3. **Sweep for other strays.** Run a query for every job with a custody `out` and no
   matching `return`. Given Defect A has been live for some time, expect more than one.
4. **Chase FLH-JOB-0021** — in progress since 3 July, same stylist, same order.
5. **Resolve order FLH-SO-0059**, still sitting at `assigned` and unfulfilled.
6. **Clarify the Samuel discrepancy.** The audit records the assigner as "Samuel
   Ifeoluwa"; the custody row, joined live against `users.display_name`, says "Samuel
   Farounbi". `shared.audit_log` stores a name snapshot taken at the time of the action,
   so either that user was renamed after 23 July, or these are two different people and
   one of the two records is attributing the action to the wrong person. This should be
   settled before anyone relies on the audit trail for accountability.
7. **Require a cancellation reason** at the UI level. The blank field here cost us the
   single most useful piece of context.

---

## Conclusion

The hair is not missing from the system — the system was never told it came back.

FLH-JOB-0030 was assigned to **Blessing Donatus** on 23 July at 10:26, the wig was booked
out to her at that moment, and the job was cancelled 14 minutes later by Faitlyn Alex.
Cancellation in this platform does not return custody, does not restock, and does not
close the stylist's task, so the wig has read as "out with Blessing Donatus" ever since
and will continue to do so until someone logs a return by hand.

The reason nobody could see this from the admin screen is a separate display defect: the
assignee's name was resolved against the list of *currently assignable* stylists rather
than being returned by the API, so it rendered as a generic label and, on cancelled jobs,
as nothing at all. The underlying record was intact the whole time.

Both findings are defects in the platform, not user error, and neither is specific to
this job. The display defect is fixed pending a build check. The custody defect is not
fixed and should be treated as the priority, because until it is, every cancellation
silently loses a wig.

*Investigated 8 August 2026. Reproduction query: `scripts/investigate-job.sql`.*
