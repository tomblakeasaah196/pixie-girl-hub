# Schema Changelog — Pixie Girl Hub Shared Migrations

Tracks edits made to the shared migrations after the initial draft. Each
entry names the SOURCE (which V-of-spec drove the change), the FILES
edited, and a precise WHAT/WHY.

The intent of editing in place (rather than appending patch migrations)
is so that a clean checkout of `migrations/` is the complete, current
truth for the database. A first-time deployment never has to apply
patches; only the in-order `.sql` files.

---

## 2026-07-29 — Display-name alias split from the name of record

**Source:** Owner directive — "this edit can be the display name only, it
can't be changing the user's full name on the system."

**Files:** `000371_shared_user_preferred_name.sql` (new, shared).

`shared.users.display_name` was doing two incompatible jobs: it was the
name ~30 modules join for "created by / assigned / actor" labels (plus IAM
Users & Access, org-chart holder resolution and audit snapshots), *and* it
was the field the self-service **My Profile → Display name** edit wrote. So
a user renaming themselves silently changed how their name appeared to
everyone, system-wide, and overrode their official HR name in the admin
user list.

Adds `preferred_name` and splits the two roles cleanly:

- `display_name` — the **canonical name of record**. Read everywhere a
  person is shown to others. No longer writable by the profile edit.
- `preferred_name` — the **personal alias**, self-editable, surfaced only
  in the user's own account menu and their own profile. Nothing else joins
  it, so editing it cannot change the user's name anywhere.

Backfill: each account's current label is preserved as its alias (so no
one's header changes on deploy), then `display_name` is reset to the linked
contact's name for staff — purging any alias a prior self-edit had baked
into the canonical column. External users (no linked contact) keep their
admin-set `display_name`. Idempotent: the alias copy is guarded on NULL and
the canonical reset is a no-op on re-run.

---

## 2026-07-22 — Lace ladder Trash (delete + 15-day purge)

**Source:** Owner directive (catalogue UX pass) — clean up duplicate lace
constructions that earlier imports minted (13X4 + 134FRONTAL, etc.).

**Files:** `migrations/template/000087_business_lace_ladder_soft_delete.sql.template`.

Adds `is_deleted` / `deleted_at` (+ a partial trash index) to
`{{BUSINESS}}.styled_lace_sizes` so a lace construction can be deleted to
Trash (restorable 15 days) rather than only deactivated. Deleting a lace
still used by variants is gated in the app: a replacement must be picked and
every affected variant repointed before the row is trashed, so a trashed lace
never violates the `styled_product_variants.lace_code` `ON DELETE RESTRICT`
FK. The daily `catalogue-trash-purge` sweep hard-deletes lace rows past the
15-day window alongside styled products/colours/variants.

---

## 2026-07-17 — HR clock-out overtime + close-time reminders

**Source:** owner directive — "edit an employee's work days/times after
onboarding (e.g. 5 days → 3), add a closing time, get the supplementary hours
worked past close, and push 3 clock-out reminders (5 min before / at / 5 min
after) so people never miss clocking out."

**Files:** `000350_shared_hr_clockout_overtime.sql` (new, shared).

**What / why:**
- `attendance_days`: `overtime_minutes` — supplementary time worked past the
  expected closing time (last clock-out − expected end, floored at 0). The
  mirror of `early_leave_minutes` on the "stayed late" side. Reconcile fills
  it every day. **Tracking only** — payroll's manual `overtime` line is
  untouched (no auto-pay).
- `hr_settings`: `clockout_reminder_enabled` (default **true**) — per-brand
  master switch for the "remember to clock out" nudges.
- `clockout_reminders` (new table) — a thin idempotency ledger so the
  every-minute sweep sends each of the three nudges AT MOST ONCE per employee
  per day, even across worker restarts / a second worker. `UNIQUE
  (profile_id, work_date, offset_tag)` is the claim: the sweep INSERTs before
  it notifies, and only the winning INSERT fires the notification.
- (Closing time itself, `staff_profiles.work_expected_end_time`, already
  existed from 000257; this release makes it settable end-to-end — validator,
  repo, onboarding wizard and the new HR edit-schedule form.)

## 2026-07-16 — Stylist Studio: lifecycle collapse + own-scope RBAC

**Source:** owner directive — "the stylist studio gives every stylist access
to the whole studio; and completed jobs shows 0 even after stylists have
shipped work. Fix both." The job lifecycle used to require four separate
Ops clicks after the wig came back (`qc pass → ready_for_dispatch →
handed_to_sales → completed`); nobody clicked all four, so scorecards +
HR `styles_completed` targets showed zero for real work. Separately, the
`tech_stylist` role had `full` on `service_jobs` (view/create/edit/delete/
approve/export at scope `all`), so every stylist could see every job and
even approve write-offs; the Ops Manager was capped at `partial_team`,
narrower than the stylists — the opposite of what the org runs on.

- `000348_shared_stylist_studio_rbac_own_scope` (shared) — reseats the two
  roles for the `service_jobs` module: `tech_stylist` = view/create/edit
  at scope `own` (no delete/approve/export); `ops_mgr` = view/create/edit/
  delete/approve/export at scope `all`. Idempotent delete-then-insert on
  those two roles so repeated runs converge. CEO/owner bypass anyway.
- `000084_business_service_jobs_lifecycle_backfill` (brand template) —
  data-only backfill for rows stuck in the retired `qc_passed`,
  `ready_for_dispatch`, `handed_to_sales` statuses: sets them to
  `completed` and derives `completed_at` from the best available
  timestamp (`handed_at` → `ready_at` → `qc_at` → `updated_at`). The
  CHECK constraint is left tolerant of the retired values so historical
  rebuilds don't fail; application code no longer writes them.
- `src/modules/service_jobs/service-jobs.service.js` — `recordQc` on
  `pass` now sets status directly to `completed`, stamps `completed_at`,
  adds the `dispatched` custody row (wig leaves the studio for
  Logistics/Sales), and creates the shipment via `logistics.createForOrder`
  (best-effort, moved from the old `dispatch()` fn). The old `dispatch()`
  and `handToSales()` service fns + `/service-jobs/:id/dispatch` +
  `/service-jobs/:id/hand-to-sales` routes are removed — those flows now
  live on the Logistics/Order side, single source of truth.
- Service + repo scope-thread: `listJobs`, `getJob`, `listStylistScorecards`,
  `getStylistScorecard`, `getAccountability`, `listCustodyLedger` all
  accept `scope` + `user`. Own-scope callers see only jobs they are
  currently assigned to OR were ever a stylist on (kept visible via the
  wig_custody_ledger); `getJob` throws `NO_LONGER_ASSIGNED` with the
  current assignee's name so the Stylist Studio can render
  "reassigned to X → back to my jobs" instead of a bare 403.
- Admin: `JOB_STATUS_META`, `JOB_NEXT_STATES`, `BOARD_COLUMNS` collapsed
  to the six flowing states (`pending, assigned, in_progress, on_hold,
  returned_for_qc, rework, completed`); dispatch/hand-to-sales buttons
  removed from the drawer. Stylist Studio hides the Job Board / Team
  Scorecards / Wig Accountability / Types / Recipes / Reconciliation
  tabs for own-scope users and defaults them to "My Jobs".

Apply to existing brands with `npm run db:repair`. RBAC change takes
effect on the next `identityCache` refresh (30s TTL).

---

## 2026-07-16 — Stylist Studio: lockable style brief

**Source:** "the style brief came under QC instead of at job creation" — the
brief (what the customer asked for) had no capture point at job open, so it
only got filled in ad hoc whenever someone opened the stylist/QC work panel.
Now captured once, at open, and locked.

- `000083_business_stylist_brief_lock` (brand template) — adds
  `service_job_references.is_locked BOOLEAN NOT NULL DEFAULT false`. `true`
  marks the customer's original brief (captured at job open); `false` marks a
  supplementary stylist/QC note. `deleteReference` refuses to remove locked
  rows (guarded in SQL), so the original request can't be overwritten.
  Existing references default to `false` (stay editable). Column add only;
  per-brand table count unchanged.
- `src/modules/service_jobs/service-jobs.service.js` — `createJob` accepts an
  optional `brief` ({body, url}) written as locked reference rows;
  `createForOrder` auto-pulls the source order line's `notes` into a locked
  brief so order-opened jobs arrive with the customer request already on
  them; `addReference` forces `is_locked = false` (the public endpoint can
  only add supplementary notes, never a locked brief).
- Admin: the "+ New Job" form gains a Style brief field (note + inspiration
  link); the job drawer separates the locked brief from stylist/QC notes; the
  work panel shows locked entries with a 🔒 and no delete control.

Apply to existing brands with `npm run db:repair`.

---

## 2026-07-15 — Stylist Studio: job drawer enrichment (PR1 of 2)

**Source:** "make the job drawer rich" — customer/order/product identity,
inline ratings open the whole time a job is live (not just after QC),
workload badges, cost breakdown, wig custody mini-timeline, activity
timeline, and a non-sequential hand-off tag format.

- `000082_business_stylist_tag_code_format` (brand template) — `CREATE OR
  REPLACE` of `fn_next_stylist_tag`. Changed from a bare 5-digit counter to a
  3-digit counter (this migration) + 2 letters drawn from the styled product
  name, computed in `deriveTagInitials` (`service-jobs.repo.js`) — e.g.
  "342NS" instead of "00342". Same cycle-then-wrap counter, just half the
  digits since letters now carry the other half of the code. No `CREATE
  TABLE` (idempotent function replace); per-brand table count unchanged.
- `src/modules/service_jobs/service-jobs.repo.js` (`getServiceJob`) — joins
  customer name (name only, never contact details), order placed-at, base +
  styled product names, styled product photo, wig-out timestamp, and a
  materials/chemicals cost rollup. New `listJobActivity` reads the existing
  audit log for a job's full lifecycle — no new event table needed.
- `assignStylist` now returns `is_new_tag` so the drawer shows a "copy this
  onto the tag" confirmation only on the assignment that actually allocated
  the code, never on a later reassignment of the same job.

Apply to existing brands with `npm run db:repair`.

Companion data fix (not a migration — run by hand): styled products'
`default_service_type_id` was unset for some/all styled products, so
`createForOrder` fell back to whichever service type sorted first
("Installation") instead of "Styling". SQL handed to the operator directly
rather than baked into a migration, since it depends on row data (which
service type is actually named "Styling" in this deployment) rather than
schema shape.

---

## 2026-07-15 — Expenses: amount_paid_ngn column + approver/payer name joins

**Source:** live repro on the expense detail drawer — the "Paid" summary
tile and status pill always rendered "—"/no amount after marking an expense
paid, and "Approved By" showed a raw user UUID instead of a name.

- `000346_business_expenses_amount_paid` (root migration, both brand
  schemas) — adds `expenses.amount_paid_ngn NUMERIC(14,2)` (declared in the
  frontend type and read by the UI, but never created — template 000023
  omitted it) and backfills existing paid/partially_paid/reimbursed rows
  with `total_amount_ngn + vat_amount_ngn`. `src/modules/expenses/expenses.service.js`
  (`markPaid`) now writes it on every payment.
- `migrations/template/000023_business_expenses.sql.template` — added the
  same column so fresh bootstraps match.
- `src/modules/expenses/expenses.repo.js` (`findById`, `listReceipts`) —
  joins `shared.users` to resolve `submitted_by_name`, `approved_by_name`,
  `paid_by_name`, and `shared.documents` to resolve receipt filenames. No
  new tables; per-brand table count unchanged.

---

## 2026-07-15 — Stylist Studio: assignment picker narrowing, task-trigger created_by fix, hand-off tag code

**Source:** live repro assigning FLH-JOB-0027 to a Head Stylist. A prior same-day
fix already corrected `listAssignableStylists`' `sp.end_date IS NULL` (excluded
staff with a scheduled *future* contract end date even though still employed
today) to `(sp.end_date IS NULL OR sp.end_date >= CURRENT_DATE)`. This entry
covers what came after that: the picker still listed the whole Operations
department, not just stylists, and assigning any order-generated job (no
recorded creator) failed outright with "A required detail was missing."

- `src/modules/service_jobs/service-jobs.repo.js` (`listAssignableStylists`)
  — narrowed the candidate pool from every Operations employee to stylist
  seats only (`job_title ILIKE '%stylist%'`) — Operations Manager, Head of
  Security, and Sanitation Officer are Operations staff but not assignable
  to styling jobs.
- `000080_business_service_job_task_created_by_fix` (brand template) —
  `CREATE OR REPLACE` of `fn_service_job_create_task` (see 000073, the same
  trigger's first fix). The trigger inserted the auto-raised staff task with
  `created_by = NEW.created_by`, but `service_jobs.created_by` is nullable
  (jobs raised by a background/order process may never set it) while
  `shared.tasks.created_by` is `NOT NULL` — so assigning a stylist to any
  job with no recorded creator violated that constraint and **the
  assignment failed outright**. Now falls back to
  `COALESCE(NEW.created_by, NEW.assigned_staff_user_id)`. No `CREATE TABLE`
  (idempotent function replace, re-applied every `db:repair`); per-brand
  table count unchanged.
- `000081_business_stylist_studio_tag_code` (brand template) — new
  `service_jobs.tag_code` column + `fn_next_stylist_tag()`, a 5-digit counter
  (backed by the same `shared.document_numbering` table every other document
  sequence in this codebase uses) that cycles 1..99999 and wraps back to 1
  automatically. `assignStylist` allocates one on first assignment so ops can
  write it on the physical tag pinned to the customer's hair; the Job Board
  can now search by tag code, and the job drawer shows it. Per-brand table
  count unchanged (column add only).

Apply to existing brands with `npm run db:repair`.

---

## 2026-07-13 — Reconcile shared.service_booking_requests

**Source:** production 500 on `GET /api/v1/smartcomm/channels/:id/order-links`
—
```
column b.link_id does not exist
hint: Perhaps you meant to reference the column "l.link_id".
```
The order-links sidebar (`listForChannel` in
`smartcomm.order-links.repo.js`) joins `shared.service_booking_requests`
on `link_id` to count bookings per link. Production had an older-shape
copy of the table sitting there before migration 000317 ran, and 000317
uses `CREATE TABLE IF NOT EXISTS` — the whole new schema, including
`link_id`, was silently skipped. Every catalogue-share thread that
opened the sidebar 500'd.

**Files (new):**
- `000337_shared_service_booking_requests_reconcile.sql` — idempotent
  `ADD COLUMN IF NOT EXISTS` for every column 000317 declared, guarded
  FKs + CHECKs added via a DO-block, indexes and the updated-at trigger
  re-created via IF NOT EXISTS. A DB where 000317 landed cleanly (or a
  first-time deployment) is a no-op.

**No change to 000317.** A first-time `migrations/` apply still lands
the correct schema — 000317's `CREATE TABLE` builds it directly. This
patch exists purely to reconcile deployed databases that got the older
shape.

---

## 2026-07-12 — Workspace reminders that fire + CoS catalogue v3

**Source:** user bug report — CoS task/event writes failed Zod with
"Invalid datetime" (the model emits `+01:00` Lagos offsets; the task
validator only accepted UTC and the calendar validator refused zoneless
datetimes), task reminders were written once and never swept or re-derived
when a due date moved, calendar events had no reminders at all, and the
CoS schemas never exposed reminder fields so "remind me the day before"
was silently dropped.

**Files (new):**
- `000334_shared_workspace_reminders.sql` — `shared.tasks.reminder_sent_at`
  plus `shared.calendar_events.{reminder_minutes,remind_at,reminder_sent_at}`
  and partial sweep indexes on both tables (armed, live reminders only).
  The new `workspace-reminders` scheduler notifies the owner when
  `remind_at <= now()` and stamps `reminder_sent_at`; editing a reminder
  clears the stamp so it re-fires.
- `000335_shared_cos_catalogue_v3.sql` — updates
  `workspace.{create,update}_task`, `workspace.{create,update}_event` and
  `workspace.reschedule_event`: datetime descriptions now spell out the
  ISO-8601-with-Lagos-offset shape (with examples), payload schemas gain
  `reminder_minutes`/`remind_at`, and the event_type enum widens to the
  full calendar vocabulary.

**Related (no migration):** `flexDatetime` in `src/utils/validation.js` —
task/calendar validators now accept UTC, any offset, zoneless local
(business TZ) and bare-date shapes, normalising to UTC; task/calendar
services re-derive `remind_at` whenever the anchor datetime or the
relative offset changes.

---

## 2026-07-12 — Chief of Staff: plan anchoring + workspace catalogue v2

**Source:** user bug report (PR 2 of the CoS audit) — plan cards rendered
detached at the bottom of the thread repeating the whole message as their
summary; the 15-action allowlist had no reads, no deletes and no note
update, so the CoS couldn't check for duplicates, clean up after itself,
or look up people.

**Files (new):**
- `000332_shared_cos_plan_anchor.sql` — adds
  `shared.ai_pending_plans.anchor_message_id` (FK → `shared.ai_messages`,
  `ON DELETE SET NULL`): the assistant reply that proposed the plan; the
  chat UI renders the card directly under that bubble.
- `000333_shared_cos_catalogue_v2.sql` — 12 more surface='workspace'
  actions: READS (list_goals, get_goal, list_tasks, list_events,
  list_notes, search_contacts — is_write=false, no confirmation, executed
  IMMEDIATELY during the turn over the loopback executor so RBAC applies)
  and WRITES (update_note, delete_note, delete_task, delete_event,
  delete_milestone, delete_goal — queued as plan steps). 27 workspace
  actions total.

**Related (no migration):** `cos.plan-rounds.js` executes read tool calls
inline and feeds real data back to the model; deterministic plan card
title/summary (`cos.planner.deriveTitleSummary`); chat history window
10 → 40 messages with feature-off stub replies excluded and a back-online
pickup note; `postMessage` transaction split (user message commits before
any LLM work).

---

## 2026-07-11 — Chief of Staff: resumable plan building

**Source:** user bug report — the CoS narrated full plans ("goal + 4
milestones + 6 tasks + 3 events + a note") but the proposed plan carried
only the steps one truncated completion managed to emit (usually just the
goal), then celebrated "Plan completed" over a 1-step plan.

**Files (new):** `000331_shared_cos_plan_build_state.sql` — adds
`shared.ai_pending_plans.is_complete BOOLEAN NOT NULL DEFAULT true`.
`false` marks a plan whose per-turn build budget ran out with steps still
owed; the admin UI offers "Continue building" (POST
`/api/v1/cos/plans/:id/continue`) which appends the remaining steps to the
SAME plan. Backfill: existing plans default to complete.

**Related (no migration):** `src/modules/chief_of_staff/cos.plan-rounds.js`
(bounded multi-round plan building with truncation continuation, a
broken-promise retry, and a narrated-kind check), plan supersession + the
duplicate-goal guard in `cos.planner.js` / `cos.plan-executor.js`, editable
step payloads (PATCH `/api/v1/cos/plans/:planId/steps/:stepId`), and the
DATE type parser in `src/config/database.js` (date columns now serialise as
plain `YYYY-MM-DD`, fixing the "Invalid Date" / off-by-one goal cards).

---

## 2026-07-11 — Chief of Staff: save conversation to Notes

**Source:** user request — the CEO wants the Chief of Staff to summarise a
chat and push (or refresh) a personal note in the Workspace Notes surface,
searchable alongside manual notes.

**Files (new):** `000329_shared_cos_notes_link.sql` — adds
`shared.workspace_notes.source_conversation_id` (FK →
`shared.ai_conversations`, `ON DELETE SET NULL`) plus a partial UNIQUE
index `(user_id, source_conversation_id) WHERE source='cos' AND
is_deleted=false AND source_conversation_id IS NOT NULL`. The unique index
is what enforces "one CoS note per conversation" — re-summarising upserts
the same row instead of duplicating. A second partial index backs the
reverse "does this conversation already have a saved note?" lookup.

**Related (no migration):** `src/modules/chief_of_staff/cos.service.js`
(`saveConversationAsNote` — summarises the thread via the same failover LLM
router + `cos_chat` governance envelope, then upserts), `notes.repo.js`
(`upsertCosNote` / `findNoteByCosConversation`), the
`POST /cos/conversations/:id/save-note` route, and the admin CoS tab
("Save to notes" header button + inline suggestion; a "Chief of Staff" tag
on the note card).

---

## 2026-07-11 — Recruitment: countersignatory e-signature

**Source:** user request — offer packets need one signature area (not two),
and the person who countersigns the offer on the Company's behalf needs a
real captured signature that rides on every packet, side-by-side with the
candidate's.

**Files (new):** `000326_shared_recruitment_signatory.sql` — adds
`shared.recruitment_context.signatory_signature_data_url` (base64 data
URL of the captured countersignatory signature, drawn once in the
Company-context modal); nudges the seeded default `signatory_name`
from `'Faith'` to `'Faitlyn Alex'` only where the row is still on the
literal seed default.

**Related (no migration):** `src/modules/recruitment/recruitment.render.js`
(strips the AI's trailing "Accepted and Agreed" block; brand contact strip
on the cover; footer shows CAC only when set + optional italic mission
statement; proper `@page` top/bottom margins; stamps the countersignatory
signature onto the "For {brand}" side of the Execution block),
`apps/admin/src/pages/hr/RecruitmentTab.tsx` (SignaturePad for Faith in
the Company-context modal; live preview pane is now an iframe of the
server-rendered packet HTML), `apps/admin/src/pages/offer/OfferPage.tsx`
(candidate reads the same packet HTML in an iframe).

---

## 2026-07-10 — WhatsApp Business Calling (inbound voice)

**Source:** user request — customers close deals on WhatsApp calls;
inbound (customer→business) calling via Meta's Cloud API Calling, answered
by staff in the Hub browser over WebRTC.

**Files (new):** `000319_shared_whatsapp_calls.sql` — adds
`shared.whatsapp_calls` (one row per call: ringing → in_progress →
completed / missed / rejected / failed, agent, duration, outcome,
missed-call follow-up flags) and `shared.whatsapp_call_events` (raw
webhook/action audit, deduped per (call, event)); widens
`messages_message_type_check` with `'call'` and teaches
`fn_smartcomm_touch_channel` the 📞 preview so calls land as timeline
cards on the customer's SmartComm thread.

**Related (no migration):** `src/modules/calls/` (state machine, ring
choreography: conversation owner first, everyone after 15 s),
`src/services/whatsapp-calling.service.js` (Graph /calls edge +
per-number calling settings), the `calls-lifecycle` BullMQ queue, and the
CallLayer in the admin app. `scripts/verify-schema.js` EXPECTED_SHARED
179 → 188 (also counts 000317 order links +2 and 000318 recruitment +5,
which had shipped without bumping it).

---

## 2026-07-09 — Email account activation + OTP password reset

**Source:** user request — every account must verify ownership of its email
once ("activate"), shown as a post-login banner until done; and forgotten
passwords should be reset with an emailed one-time code instead of a link.
Email-only by design (no SMS/WhatsApp). A per-login OTP challenge was
explicitly rejected as too much friction, so login itself is unchanged.

**Files (new):** `000312_shared_email_mfa.sql` — adds `email_verified`
(BOOLEAN, default false) and `email_verified_at` on `shared.users`. The
transient 6-digit codes live in Redis (single-use, 10-min TTL); only the
resulting flag + timestamp persist.

**Related (no migration):** `auth.service` now (a) sends/confirms a
one-time activation code (`/auth/activate/send` + `/confirm`), surfacing
`email_verified` on login + `/auth/me`; and (b) reworks
`forgotPassword`/`resetPassword` to an emailed OTP keyed by address
(attempt-capped, resend cooldown) rather than a hashed link token.

---

## 2026-07-09 — Fix TOTP secret column type (MFA "Invalid code")

**Source:** user report that MFA/TOTP setup always failed with "Invalid code.
Check your authenticator app and try again", regardless of the code entered.

**Root cause:** `shared.users.totp_secret_enc` was declared `BYTEA`, but the
shared encryption service (`services/encryption.service.js`) returns/accepts
base64 **TEXT** — like every other `*_enc` column. The base64 ciphertext was
stored as raw bytes; on read `decrypt()` ran `Buffer.from(buffer, "base64")`,
which ignores the encoding when handed a Buffer, so AES-256-GCM auth failed
and `verifyTotp` threw a 500 that the admin UI relabelled as "Invalid code".

**Files (edited):** `000211_shared_iam_security.sql` — column is now `TEXT`
so a clean checkout is correct on first deploy.
**Files (new):** `000311_shared_totp_secret_text.sql` — converts existing
deployments from `BYTEA` to `TEXT` (guarded; `convert_from` recovers any
in-progress secret losslessly, so no re-scan is needed).

---

## 2026-07-08 — Curated onboarding articles (HR & Staff → Onboarding)

**Source:** user feedback on My HR's "Getting started" card pulling
unrelated Help Center articles (any article tagged `onboarding` brand-wide,
regardless of what it's actually about).

**Files (new):** `000308_shared_hr_onboarding_articles.sql`.

**What:** `shared.hr_settings.onboarding_help_article_ids UUID[]` — an
explicit, ordered list of Help Center articles HR curates for new hires via
a new HR & Staff → Onboarding tab. `hr_ops.repo.onboardingHelpArticles` uses
this list when non-empty and falls back to the legacy tag-based query
otherwise, so existing installs are unaffected until HR picks articles.

---

## 2026-07-08 — Praxis campaign action payload schemas (hallucination fixes PR 1)

**Source:** Praxis hallucination root-cause analysis (2026-07-08). The six
`sales_campaigns.*` rows seeded by 000221 carry routes with `:id` but left
`payload_schema` at the default `'{}'`, which the orchestrator normalises to
an EMPTY tool-parameter schema — the model was never told a campaign id is
required, so every proposed action failed after human confirmation with
`ACTION_ROUTE_PARAMS_MISSING` ("This action is missing a required reference").

**Files (new):** `000307_shared_praxis_campaign_action_payload_schemas.sql`.

**What:** real JSON Schemas (mirroring each route's Zod validator plus the
`id` route param, with `required` lists) for the six campaign actions;
descriptions + examples now tell the model to look the campaign id up via
the new `query_campaigns_recent` catalogue query instead of guessing.
Backend companions (same PR): proposal-time route-param validation with one
corrective model round, inline execution of read-safe catalogue actions, and
a RAG similarity floor (`PRAXIS_RAG_MIN_SCORE`) + provenance labels on
retrieved chunks.

## 2026-07-07 — Stamp `sales_orders.paid_at` on payment + backfill (V2.2 §6.2)

**Source:** Sales/Logistics audit follow-up (2026-07-07). The `paid_at`
column has always existed on `sales_orders` (template 000019 declares it,
template 000033 indexes it, `sales-report.export.js` reads it as "Paid
At"), but nothing ever wrote to it — the trigger stamped `fully_paid_at`
only. Reports rendered "Paid At" as always null; downstream queries that
filtered on `paid_at` silently returned zero rows (that's how the
Sales-vs-Logistics discrepancy audit hit a wall earlier).

**Files (new):** `000306_business_paid_at_stamp_and_backfill.sql`.
**Files (edited):** `template/000034_business_triggers.sql.template`.

**What:**
- Trigger `fn_sales_order_recompute_paid` now stamps `paid_at` alongside
  `fully_paid_at` (COALESCE-guarded, sticky). Template updated for future
  brand bootstraps; the migration `CREATE OR REPLACE`s the function in
  both already-provisioned brand schemas.
- Existing rows: `paid_at := fully_paid_at` wherever `paid_at IS NULL AND
  fully_paid_at IS NOT NULL`. Idempotent.

## 2026-07-07 — Sales KPI defaults to MTD when no window is given (V2.2 §6.20)

**Source:** Same audit. Sales dashboard tiles ("Orders MTD", "Revenue
MTD") were showing all-time totals because the frontend called
`/dashboards/kpis/sales` with no `from`/`to`, and the repo silently
appended no date filter (the field name was `orders_mtd` regardless).

**Files (edited):** `src/modules/dashboards/dashboards.repo.js` — code
change only, no schema migration.

**What:** `salesKpis` now defaults to the Africa/Lagos current calendar
month when the caller doesn't supply a window. Boundaries computed in
SQL (`date_trunc('month', now() AT TIME ZONE 'Africa/Lagos')`) so no
clock drift between the API host and PG. Explicit `from`/`to` still
override.

## 2026-07-07 — Backfill pickup orders' `order_type` (V2.2 §6.4 / §6.10)

**Source:** Sales/Logistics count discrepancy audit (2026-07-07). Paid
pickup orders were showing as "DELIVERY" on the Sales list and never
appearing on the Logistics queue. Root cause: both public checkouts
(`storefront.service.js`, `campaigns.public.service.js`) hardcoded
`order_type = 'dispatch'` even when the buyer chose pickup; the pickup
flag lived only inside `internal_notes.fulfilment_type`. The logistics
auto-create subscriber correctly skipped these (no
`delivery_address_snapshot`), but the Sales UI reads `order_type`
directly and rendered the "Delivery" pill from the enum mapping.

**Files (new):** `000305_business_backfill_pickup_order_type.sql`.

**What:** Walks `pixiegirl` + `faitlynhair` schemas and moves any
`sales_orders` row still tagged `order_type = 'dispatch'` with
`internal_notes.fulfilment_type = 'pickup'` (and no delivery address
snapshot) to `order_type = 'collection'` — a value the existing CHECK
already allows and the frontend already maps to "Pick-up". Guarded so
non-JSON / null `internal_notes` never raise a cast error; idempotent
(only rewrites `dispatch` rows).

**Companion code fix** (not a migration): the two checkouts now write
`order_type: isPickup ? 'collection' : 'dispatch'`, so no future
pickup order carries the wrong label.

## 2026-07-07 — Attendance clock controls (dedupe + clock-out location + IP)

**Source:** Clock-in audit (2026-07-07). Three gaps found on the top-bar
clock widget → `POST /hr/me/clock` (`selfClock`): (1) the append-only
`staff_clock_events` log had no per-day uniqueness, so a double-tap / direct
API call could record two `clock_in` rows for one day; (2) clock-out location
was captured on the raw event but never persisted to the reconciled day ledger;
(3) the in/out IP was captured on the raw event but never surfaced.

**Files (new):** `000303_shared_attendance_clock_controls.sql`.

**What:**
- `staff_clock_events.occurred_on` (Africa/Lagos calendar day, trigger-
  maintained) + a partial unique index on
  `(profile_id, occurred_on, event_type) WHERE accepted = true`, created
  defensively so pre-existing historical duplicates never break the deploy.
  This backstops the new service-layer guard (one accepted clock-in + one
  clock-out per day; clock-out must follow a clock-in).
- `attendance_days` gains `clock_out_{address,lat,lng,is_offsite,distance_m}`
  and `clock_{in,out}_ip`, populated by the reconciler from the first
  clock-in / last clock-out events, and shown in the attendance tables.

**Note:** location is now mandatory for BOTH clock-in and clock-out (enforced
in `selfClock`); refusing location on clock-in records nothing, so reconcile
marks the day absent. IP is audit evidence only — office WiFi NATs everyone.

## 2026-07-06 — Help Center content: Grow & System modules + in-app editor (PR3 of 3)

**Source:** Help Center completeness pass — final batch, plus the DB-driven
in-app Help Editor (the "add the editor" follow-up noted in the module README).

**Files (new):** `000288_shared_help_social.sql`,
`000289_shared_help_marketing.sql`, `000290_shared_help_praxis.sql`,
`000291_shared_help_settings.sql`, `000292_shared_help_iam_security.sql`,
`000293_shared_help_documents.sql`, `000294_shared_help_ai_control.sql`,
`000295_shared_help_storefront_studio.sql`,
`000296_shared_help_notifications.sql`, `000297_shared_help_help_center.sql`,
`000298_shared_help_getting_started.sql`,
`000299_shared_help_praxis_mirror_pr3.sql`.

**What:** Seeds **42 articles across 11 Grow + System modules** (Social,
Marketing, Praxis AI, Settings, IAM & Security, Documents, AI Control,
Storefront Studio, Notifications, Help Center, Getting Started). This fills the
last previously-empty seeded categories — `praxis`, `security` and
`getting-started` — so the Help Center landing has **no empty categories left**.
`000299` re-runs the generic `ai_knowledge_chunks` mirror for the PR3 set.

**No schema change:** the in-app Help Editor (help_center create/edit/delete
endpoints + admin editor page) reuses the existing `help_articles` /
`help_categories` / `ai_knowledge_chunks` tables and the `help_center`
permission grants seeded in 000214 — no migration needed. Article writes resync
`ai_knowledge_chunks` live, so Praxis is grounded the moment content is saved.

**Count:** No table created or dropped — rows only. Shared (**177**) and
per-brand table counts are unchanged.

---

## 2026-07-06 — Help Center content: Finance & People modules (PR2 of 3)

**Source:** Help Center completeness pass — same full guide sets (overview +
task how-tos + FAQ), grounded in shipped routes/services/pages (built-and-wired
only).

**Files (new):** `000275_shared_help_invoicing.sql`,
`000276_shared_help_accounting.sql`, `000277_shared_help_expenses.sql`,
`000278_shared_help_pricing.sql`, `000279_shared_help_cash_requests.sql`,
`000280_shared_help_my_hr.sql`, `000281_shared_help_hr.sql`,
`000282_shared_help_payroll.sql`, `000283_shared_help_performance.sql`,
`000284_shared_help_contacts.sql`, `000285_shared_help_retention.sql`,
`000286_shared_help_org_workflow.sql`,
`000287_shared_help_praxis_mirror_pr2.sql`.

**What:** Seeds **54 articles across 12 Finance + People modules** (Invoicing,
Accounting, Expenses, Pricing, Cash Requests, My HR, HR & Staff, Payroll,
Performance, Contacts, Retention, Org & Workflow). Accounting populates the
existing (previously-empty) `finance` category; the rest add their own
categories. HR cross-links to the existing `attendance` category (000235)
rather than duplicating it. All inserts idempotent (`ON CONFLICT (slug) DO
NOTHING`). `000287` re-runs the generic `ai_knowledge_chunks` mirror so the PR2
articles are grounded for Praxis (the one-time 000274 sweep couldn't see them).

**Count:** No table created or dropped — rows only. Shared (**177**) and
per-brand table counts are unchanged.

---

## 2026-07-06 — Help Center content: Run & Operate modules (PR1 of 3)

**Source:** Help Center completeness pass — every module gets a full guide set
(overview + task how-tos + FAQ), written in plain English and grounded in the
shipped routes/services/pages (built-and-wired only, no spec-ahead content).

**Files (new):** `000262_shared_help_dashboard.sql`,
`000263_shared_help_sales.sql`, `000264_shared_help_crm.sql`,
`000265_shared_help_stylist_studio.sql`, `000266_shared_help_workspace.sql`,
`000267_shared_help_stock.sql`, `000268_shared_help_catalogue.sql`,
`000269_shared_help_logistics.sql`, `000270_shared_help_purchasing.sql`,
`000271_shared_help_production.sql`, `000272_shared_help_retail_partners.sql`,
`000273_shared_help_stylists.sql`, `000274_shared_help_praxis_mirror.sql`.

**What:** Seeds `shared.help_categories` / `shared.help_articles` with **59
articles across 12 Run + Operate modules** (Dashboard, Sales, CRM, Stylist
Studio, Workspace, Stock, Catalogue, Logistics, Purchasing, Production, Retail
Partners, Stylists). Reuses the existing `sales` and `catalogue` categories;
adds ten new categories. All inserts are idempotent (`ON CONFLICT (slug) DO
NOTHING`). `000274` re-runs the generic `ai_knowledge_chunks` mirror from
000214 so **every** active, `praxis_indexed` help article is grounded for
Praxis — this self-heals the previously-unmirrored attendance (000235) and
insights (000258) sets, which the one-time 000214 sweep never captured.

**Count:** No table created or dropped — rows only. Shared (**177**) and
per-brand table counts are unchanged.

---

## 2026-07-06 — Appraisal auto-scoring: brand-schema parity

**Source:** HR system audit follow-up (PR-B) — auto-populate appraisal KPI
scores from real HR data (attendance, sales targets, service-job quality,
customer ratings).

**Files:** `000261_shared_appraisal_autoscore.sql` (new).

**What:** The per-brand appraisal tables (`performance_scores`,
`performance_kpi_definitions`) live in the template and already carry the
auto-score fields (`auto_score_config`, `evidence`, the auto-score health
columns, and the calibration columns). This migration idempotently brings any
existing brand schema up to parity — `ADD COLUMN IF NOT EXISTS` for those
fields — and reconciles the `score_source` CHECK on both tables to the full
source list (`manual`, `customer_ratings`, `sales_data`, `crm_data`,
`service_job_ratings`, `clock_in_data`, `custom`) plus the
`last_auto_score_status` CHECK (`ok`/`no_data`/`error`/`skipped`/NULL), so the
auto-score engine can write on any brand regardless of when it was provisioned.

**Count:** No table created or dropped — columns/constraints only — so the
shared (**177**) and per-brand table counts are unchanged.

---

## 2026-07-05 — Signer page: PIN-protected signature on file

**Source:** HR system audit follow-up — the public signer page (`/sign/:token`)
the e-signature backend was missing a frontend for.

**Files:** `000260_shared_esign_signer_pin.sql` (new).

**What:** Adds `shared.signer_signatures` — a reusable "signature on file"
protected by an argon2 PIN and keyed by the signer's email (works for staff,
contacts, and external signers). The model: anyone can sign, but to *store* a
signature (so it isn't re-drawn on every future document) you set a PIN; later
documents only need the PIN and the saved signature is applied. Also adds
`signature_request_signers.signature_data_url` (the drawn signature captured
inline as a base64 PNG) and `.verification_code` (a short, human-verifiable code
derived from the tamper-evident `audit_hash`, printed on the document and
resolvable on the public verify page). The `signer_signed_consistency` CHECK is
relaxed to accept an inline data-URL signature as proof (the original required a
media `captured_signature_path`).

**Count:** `scripts/verify-schema.js` shared count 175 → **177**: +1 for
`signer_signatures` (this migration) and +1 correcting `staff_onboarding_progress`
(000259), whose table was added without a matching count bump. (The AI-insight
frequency migration below is a duplicate `000259` number — established precedent
for pairs touching unrelated tables — and is column-only, so it doesn't affect
the count.)

---

## 2026-07-05 — AI Insights: honour the per-module frequency cadence

**Source:** Praxis Insights follow-up (V2.2 §6.31) — make the AI Control
Frequency control actually do something.

**Files:** `000259_shared_ai_insight_frequency.sql` (new).

**What:** Adds a nullable `last_swept_at TIMESTAMPTZ` column to
`shared.ai_insight_modules`. The AI Control matrix already stored a `frequency`
per module (realtime/daily/weekly/off), but the 30-minute cron sweep ignored it
and re-scanned every enabled module on every tick — so setting a module to
"weekly" to cut spend had no effect. The sweep now records when it last ran a
module (`repo.markSwept`) and the cron path only scans modules whose cadence is
due (`repo.dueModules`): realtime → every tick, daily → once/24h, weekly →
once/7d, off → never auto-run. The manual "Run scan" button is unchanged — it
still scans every enabled module immediately.

**Why:** The Frequency dropdown was a no-op, which read as "insights don't
work" when a lone module was enabled and nothing surfaced. Honouring the
cadence makes the spend control real and the behaviour predictable.

**Verify:** Column add only — no new table, so it doesn't change the shared
table count. NULL `last_swept_at` = never swept = due on the next tick, so
enabled modules keep scanning after deploy with no backfill.

---

## 2026-07-05 — AI Insights: legacy cleanup + briefing refs unlock + Help Center guide

**Source:** Praxis Insights Wave 4 (V2.2 §6.30/§6.31) — finish the unified-store
transition and ship the complete user documentation.

**Files:** `000257_shared_ai_insights_cleanup.sql`,
`000258_shared_help_insights.sql` (both new; the numbers are shared with the
HR payroll-truth / HR-rewards migrations below — duplicate numbers are
established precedent here and the pairs touch unrelated tables).

**What (000257):** Drops the seven legacy per-category tier-1 tables from
000012 (`ai_insight_stock_alerts`, `ai_insight_margin_breaches`,
`ai_insight_invoice_alerts`, `ai_insight_intercompany_alerts`,
`ai_insight_attendance_anomalies`, `ai_insight_approval_queue_alerts`,
`ai_insight_service_match`) — the unified `shared.ai_insights` store has been
the only write path since the Wave-1 cutover and is live in production; no code
references remain. Also drops the stale `insight_category` CHECK on
`shared.ai_briefing_insight_refs` (it enumerated the six original category
names and would reject unified module keys like `purchasing`), since the
briefing generator now populates that table with paragraph→alert links keyed by
unified module. `scripts/verify-schema.js` shared count brought current: 178
baseline + 2 (insights 000256) + 2 (HR rewards 000258) − 7 (this cleanup) =
**175**.

**What (000258):** Seeds the DB-backed Help Center with the full Praxis
Insights guide — a new `insights` category and seven articles (overview,
per-module enable/disable + spend, the Insights Center, AI Control & budget,
the complete 27-module detector reference with thresholds, briefings & asking
Praxis, FAQ/troubleshooting). Articles are `praxis_indexed`, so Praxis chat can
answer insights questions from this content. Idempotent (`ON CONFLICT (slug)
DO NOTHING`).

---

## 2026-07-05 — HR onboarding pack

**Source:** Meeting transcript §3.7 + HR coverage audit (deferred item A), PR-A.

**Files:** `000259_shared_hr_onboarding.sql` (new, shared).

**What / why:** `shared.staff_onboarding_progress` (per-employee completion of
each brand onboarding-checklist item, unique-keyed on `(profile_id,
item_key)`), plus `hr_settings.onboarding_links` (JSONB — HR-maintained handy
links) and `hr_settings.onboarding_welcome` (welcome note). Surfaces the
existing `onboarding_checklist` as a ticked, per-employee "Getting started"
card on My HR (always available), with SOP articles (Help Center tag
`onboarding`), the employee's own documents, and contracts + signature status.
Idempotent.

## 2026-07-05 — HR rewards engine

**Source:** Meeting transcript §3 ("reward system") + HR coverage audit
(H2), PR3.

**Files:** `000258_shared_hr_rewards.sql` (new, shared).

**What / why:** `shared.reward_rules` (HR-configured behaviour rewards —
metric + comparator + threshold → fixed ₦ / % salary / salary-increase %) and
`shared.reward_grants` (one grant per rule/employee/period, unique-keyed for
idempotent nightly evaluation). Monetary grants create a pending-approval
bonus (flows through the existing bonus → payroll pipeline); salary-increase
grants stay pending until HR applies them (base salary + amendment). Shared
tables with a `business` column, matching the HR phase-1 pattern.

## 2026-07-04 — HR payroll truth (attendance → payslip, PAYE toggle, advances)

**Source:** Meeting transcript §3.4/§3.5 (SSOT) + HR coverage audit
(`docs/HR_FULL_COVERAGE_AUDIT_2026-07-04.md`), PR1.

**Files:** `000257_shared_hr_payroll_truth.sql` (new, shared),
`template/000027_business_payroll.sql.template` (fresh-provisioning parity).

**What / why:**
- `hr_settings`: `statutory_deductions_enabled` (default **false** — both
  brands pay simple salaries today; flip on for full PAYE/pension/NHF),
  `advance_recovery_cap_pct` (default 50 — max % of net one run recovers
  against cash advances), `default_expected_end_time` (default 18:00 — drives
  early-departure / last-out tracking).
- `staff_profiles`: `statutory_exempt` (per-employee override) and
  `work_expected_end_time` (personal closing time).
- `attendance_days`: `last_clock_out_at` + `early_leave_minutes` (clock-out
  reconciliation — §6.11 early departures + "last to leave").
- Brand `payslips`: `attendance_deduction_ngn`, `days_worked`,
  `working_days_in_period`, `prorate_factor`; `payslip_lines.line_type` gains
  `attendance_deduction`. Attendance deductions and mid-period pro-rating now
  reach net pay (audit C1/C2); cash-advance recovery uses the existing
  `advance_recovery_ngn` column (audit C4).

## 2026-07-04 — Unified AI Insights store + per-module control matrix

**Source:** Praxis AI insights expansion (V2.2 §6.30/§6.31) — scale insights
from 7 hardcoded category tables to all 27 modules, each gated from AI Control
and surfaced by one reusable UI slot on the module's own page.

**Files:** `000256_shared_ai_insights_unified.sql` (new).

**What:** Adds two tables. `shared.ai_insights` — a single unified finding
store (module + detector + severity + status + typed `context` JSONB + drill
target + open→resolved lifecycle + partial-unique suppression on
`(module, COALESCE(business,'*'), suppression_key)` while open).
`shared.ai_insight_modules` — the AI Control switchboard: one row per module
with `insights_enabled` (tier-1 rules), `narration_enabled` (tier-2 AI
briefing) and `frequency`; seeded with all 27 candidate modules
(`insights_enabled = true` for the 5 already live, false otherwise;
`narration_enabled = false` for all).

**Why:** The concrete-table-per-category pattern (000012) does not scale to 27
modules (≈20 more tables + repos + raise fns). One unified store gives a single
list/summary/lifecycle path and lets a new module ship insights via a registry
entry + a UI slot, not new plumbing. ADDITIVE: the legacy 000012 category
tables are untouched; because tier-1 detectors are idempotent and re-run every
30 min, open findings re-materialise into `ai_insights` on the next sweep, so
no backfill is needed and the legacy tables can be dropped in a later cleanup
once the unified path is verified. `narration_enabled` defaults off so enabling
a module never triggers surprise DeepSeek spend — tier-1 rules stay free.

---

## 2026-07-04 — Shop AI Search feature flag (public "ask Praxis" search)

**Source:** Shop page search + filters build (Collection/Bundle/Shade
dropdowns plus a Gemini-backed natural-language search box).

**Files:** `000255_shared_shop_ai_search.sql` (new).

**What:** Seeds one `shared.ai_feature_flags` row — `shop_ai_search`
(gemini / gemini-2.5-flash, est ₦0.50/call). Idempotent
`ON CONFLICT DO NOTHING`.

**Why:** Same contract as Shade Finder: the public search box's Gemini calls
meter into `shared.ai_usage_ledger` (user_id NULL — anonymous visitors) and
must be toggleable + budget-capped from AI Governance; `feature_key` is a
RESTRICT FK onto the flags table, so the flag row has to exist before the
feature can record usage.

---

## 2026-07-03 — Shade Finder feature flag (public Praxis shade match)

**Source:** Shade Finder build (photo → shade + product recommendation on
the Storefront Website).

**Files:** `000254_shared_shade_finder.sql` (new).

**What:** Seeds one `shared.ai_feature_flags` row — `shade_finder`
(gemini / gemini-2.5-flash, est ₦2.00/call). Idempotent
`ON CONFLICT DO NOTHING`.

**Why:** The public Shade Finder meters its Gemini calls into
`shared.ai_usage_ledger` (user_id NULL — anonymous visitors) and must be
toggleable + budget-capped from AI Governance; `feature_key` is a
RESTRICT FK onto the flags table, so the flag row has to exist.

---

## 2026-07-02 — Stylist Partner Programme v2 (§6.26 full build-out, PR1)

**Source:** V2.2 §6.26 + `docs/STYLIST_PROGRAMME_IMPLEMENTATION_GUIDE.md`
(20-question decision session Q1–Q20).

**Files:** `000251_shared_stylist_programme_v2.sql`,
`template/000075_business_stylist_referral.sql.template`.

**What:** 8 new shared tables — `stylist_tiers` (D-2 config-driven tiers with
payout multipliers), `stylist_programme_config` (quality-hold days, routing
weights, offer window/top-N, referral commission %, portal subdomain),
`stylist_questionnaire_questions` + `stylist_application_responses`
(config-driven brand-alignment questionnaire), `stylist_vetting_reviews`
(rubric-scored human vetting), `stylist_referral_links` +
`stylist_referral_attributions` (two-way earnings), `stylist_notifications`
(in-portal feed). Alters: partners (+socials, probation, ID/contract doc
refs, referral code/commission, denormalised verified rating), assignments
(+review token, satisfaction confirmation, quality-hold `payable_at`,
disputes), offers (+match score/rank), payout lines (assignment XOR referral
attribution), payouts (+`pending_approval` status + workflow ref),
certifications (+reminder markers), credentials (+reset-token rail). Brand
template 000075 adds `sales_orders.stylist_referral_code` (distinct from the
customer rail's `referral_code_used`).

**Why:** closes every §6.26 spec gap ahead of the admin Stylists module (PR2)
and the style.pixiegirlglobal.com portal (PR3/PR4).

---

## 2026-06-30 — Stylist Studio: sell-a-service rail + POS teardown (PR3)

**Source:** Stylist Studio (V2.2 §6.24) — sell services through the same order →
payment-link → checkout machinery as products, take in a customer's own wig, and
retire the POS terminal module in favour of the Quick Sale Form. Mostly code
(sales order lines now carry `line_kind`/`service_offering_id`/`styled_id`; a
service line prices from `shared.service_offerings` and skips stock/COGS; new
`customer_assets` module for own-wig check-in/out). Migrations:

- `000074_business_pos_teardown` (brand template) — drops every `{{BUSINESS}}.pos_*`
  table (DO-block, idempotent) and the POS document-number sequences. KEEPS the
  `pos` price tier / `sales_channel` / payroll commission channel — that is the
  "in-store price" concept, not the terminal app, and is woven into pricing +
  payroll; retiring it is a separate deliberate refactor.
- `000248_shared_pos_permission_teardown` — removes the `pos` module permission
  grants (`DELETE FROM shared.permissions WHERE module='pos'`).

Tooling: `verify-schema.js` expected per-brand table count 170 → 162 (−8 pos).
Apply to existing brands with `npm run db:repair`.

---

## 2026-06-30 — Stylist Studio: backend logic + task-trigger fix (PR2)

**Source:** Stylist Studio (V2.2 §6.24) — operational backend on the existing
`service_jobs` module (kept that module/permission key; "Stylist Studio" is the
product name — renaming would break ~17 files that reference the table/key).
Adds the full lifecycle (assign → start → return → QC/rework → dispatch →
hand-to-sales), time sessions, materials, the style-brief references, the
quantity-based wig-accountability ledger, DNA-aware job auto-open, and
in-app/push notifications. Logic-only except for one migration:

- `000073_business_studio_task_trigger_fix` (brand template) — `CREATE OR
REPLACE` of `fn_service_job_create_task`. The trigger inserted the auto-raised
  staff task with status `'today'`, but migration 000224 changed
  `shared.tasks`' vocabulary to `('to_do','in_progress','in_review','done',
'cancelled')`, so `'today'` violated `tasks_status_check` and **every stylist
  assignment failed**. Now inserts `'to_do'`. No `CREATE TABLE` (idempotent
  function replace, re-applied every `db:repair`); per-brand table count
  unchanged.

Apply to existing brands with `npm run db:repair`.

---

## 2026-06-30 — Stylist Studio: schema foundation (PR1)

**Source:** Stylist Studio strategy (V2.2 §6.24) — in-house Faitlyn styling
operations: sell services, assign wigs to stylists, track time/materials/
references, QC, dispatch, and a quantity-based wig-accountability ledger so no
wig is ever lost. This PR is schema-only; logic lands in PR2–PR4. See
`docs/STYLIST_STUDIO_IMPLEMENTATION_GUIDE.md`.

Brand templates (apply to existing brands with `npm run db:repair`):

- `000067_business_stylist_studio_styled_dna` — styled products gain "production
  DNA": `default_service_type_id`, `default_recipe_id` (shared recipe reuse),
  `standard_turnaround_days`, `sop_steps` (JSONB), and a new
  `styled_product_bom` default-materials table (sentinel).
- `000068_business_stylist_studio_jobs` — widens `service_jobs.status` to the
  full lifecycle (`assigned → in_progress → returned_for_qc → qc_passed →
rework → ready_for_dispatch → handed_to_sales` + existing terminals) and adds
  lifecycle timestamps, `qc_by`, `rework_count`, `reserved_variant_id`,
  `sla_due_at`, `styled_id`, `shipment_id`, `customer_asset_id`. Pure-ALTER
  (no sentinel) — idempotent CHECK swap + `ADD COLUMN IF NOT EXISTS`.
- `000069_business_stylist_studio_children` — `service_job_time_logs` (sentinel),
  `service_job_materials`, `service_job_references`, `wig_custody_ledger`,
  `customer_assets`.
- `000070_business_stylist_studio_sales_lines` — `sales_order_lines` gains
  `line_kind` (`product|styled|bundle|service`), `service_offering_id`,
  `styled_id`. Pure-ALTER.
- `000071_business_stylist_studio_config` — `studio_config` singleton
  (`missing_wig_threshold_days` default 7) + registers the `customer_asset`
  document sequence (`<PFX>-CA`).
- `000072_business_stylist_studio_services_seed` — seeds Faitlyn's 11-service
  price list into `shared.service_offerings` (brand-key guarded to faitlynhair;
  Pixie runs no in-house services). Idempotent via `ON CONFLICT (business,slug)`.

Shared:

- `000247_shared_stylist_studio_permissions` — ADDS the `stylist_studio`
  permission key mirroring every role's `service_jobs` grant (non-destructive;
  the old key is removed in PR2 once the backend flips to the new key, so the
  live service-jobs routes never lose their permission mid-rename).

Tooling:

- `scripts/verify-schema.js` — expected per-brand table count 163 → 170 (the
  seven new brand tables).

Note: POS teardown (drop `pos_*`, remove the `pos` permission key + numbering
rows) is intentionally deferred to PR3 so all POS removal lives in one PR.

---

## 2026-06-24 — Fix: styled_products missing compare_at_price_usd (template 000046)

**Source:** bug report — every Styled Product save (PATCH
`/catalogue/styled-products/:id`) 500'd, since `styled.repo.js`'s
`STYLED_COLS` and the validator have always included `compare_at_price_usd`,
but template 000046 only ever added `retail_price_usd` to
`{{BUSINESS}}.styled_products` — the column never existed, so the UPDATE
errored on every request.

- `000046_business_catalogue_usd_pricing.sql.template` — adds the missing
  `compare_at_price_usd NUMERIC(14,2)` column to `styled_products`
  alongside `retail_price_usd`.
- This template has no `CREATE TABLE` sentinel, so `npm run db:repair`
  always re-runs it (idempotent `ADD COLUMN IF NOT EXISTS`) — run it
  against pixiegirl/faitlynhair to apply the missing column to already-
  bootstrapped schemas.

---

## 2026-06-22 — HR final wiring (000236, 000237)

- `000236_business_payslip_bank_sort_code` — adds `bank_sort_code_snapshot` to
  every brand's `payslips` (+ template). Payroll calculate now snapshots the
  staff bank account + sort/NIP code (decrypted) so disbursement can transfer.
- `000237_shared_hr_leave_escalation` — adds `hr_settings.leave_escalation_days`
  (leave ≥ N days requires CEO approval).

Plus (no schema): salary payout webhook reconciliation, auto target-progress
from Sales/Service-Jobs, KPI scoring-entry UI, and Praxis HR read actions.

---

## 2026-06-22 — HR attendance: geofenced clock-in (000234, 000235)

**Source:** chat brainstorm on geolocated attendance.

- `000234_shared_hr_attendance_geo` — adds `is_offsite` + `formatted_address`
  to `staff_clock_events`; offsite columns (`is_offsite`, `offsite_distance_m`,
  `clock_in_address/lat/lng`) to `attendance_days`; and a geofence policy block
  to `hr_settings` (`geofence_enabled`, `geofence_required_on_site`,
  `geofence_accuracy_max_m`, `offsite_auto_query`, `offsite_marks_absent`).
  Clock-in is recorded-and-flagged (not rejected) when off-site; off-site on an
  on-site working day auto-raises an `offsite_clockin` query → respond, else
  (upheld/lapsed) the day is marked absent. Coordinates from the browser
  Geolocation API are the truth; the address is client reverse-geocoded.
- `000235_shared_help_attendance` — Help Center articles (staff + HR/CEO)
  covering clock-in, off-site flags, lateness/earnings and office setup.

---

## 2026-06-22 — HR system Phase 1 (000233_shared_hr_phase1)

**Source:** `docs/PixieGirl_Hub_Meeting_Notes_Transcript.docx` §3 (HR design)

- HR build decisions (chat answers #1–#15).

Adds the operational HR tables the meeting required that the existing
Pass-1/Pass-2 HR schema (template 000027) did not cover:

- `shared.hr_settings` — per-brand lateness deduction tiers (default
  1h=10%/2h=20%/3h=30%), working days, real-time earnings toggle, CEO
  payout PIN (argon2 hash) + provider (Nomba), onboarding checklist.
- `shared.attendance_days` — reconciled daily attendance ledger with the
  lateness minutes + deduction each late day produced.
- `shared.hr_queries` — formal staff queries; every lateness auto-raises
  one (waive → restore pay, uphold → deduct from net, reminder if ignored).
- `shared.staff_earnings_daily` — daily snapshot backing the live
  earnings tracker.
- `shared.performance_targets` — monthly per-staff target + live countdown.
- `staff_profiles.additional_businesses` — cross-brand staff (primary
  `business` still owns payroll/books).

All objects are additive + idempotent. Lateness/earnings math is a pure,
unit-tested engine (`src/shared/hr_payroll/lateness.calc.js`).

---

## 2026-06-19 — Pricing advisor: cost-grounded, governed, seeded

**Source:** Owner directive — "make the pricing module very easy to use"; it is
an ADVISORY engine (the catalogue owns the live prices), it must ground
recommendations in TRUE landed cost, seed industry scenarios + sensitivity, take
a fixed manual USD price, and apply with threshold governance.

**Migration `template/000042_business_pricing_advisor.sql.template` (NEW,
additive).** Applied to existing brands by `db:repair`; all statements idempotent.

- **NEW** `pricing_config` (singleton): `instant_apply_threshold_pct` (small
  changes apply instantly, larger → CEO proposal), `default_target_margin_pct`,
  `round_to_ngn` (clean-figure rounding), and configurable `channel_fees` JSONB
  (were hard-coded in the admin).
- `product_variants` + `styled_product_variants` gain `price_usd` (fixed manual
  dollar price — never auto-converts); `styled_products` gains `styling_cost_ngn`
  (advisor input for a styled retail = base landed cost + styling cost).
- **Seeds:** the config singleton, a `charm_rounding` pass-through layer (the
  `cost_pass_through_rules` table existed but was unused), and three ready-to-run
  industry scenarios — Naira devaluation (+15% FX), Freight shock (+20%), Festive
  peak (60% margin) — each with a sensitivity slider.

**App layer:** new `pricing_advisor` module — `POST /pricing/recommend`
(cost-vault-grounded suggestion: target margin/markup/price → price, channel-fee
gross-up, VAT only when the business charges it, floor clamp, rounding, real
kept-margin), `POST /pricing/apply` (threshold governance: instant write +
price_history, or a one-variant CEO proposal via the existing scenario flow),
`GET/PUT /pricing/config`, `PUT /pricing/variants/:id/usd`. Scenario sensitivity
sliders (FX/freight/raw cost) now actually flex the cost basis (were
informational). Cost is never leaked to a non-Cost-Vault user.

---

## 2026-06-18 — Catalogue: Styled colour×size variants, size pricing, trash

**Source:** Owner directives (June 2026) — base products are RAW China hair
(wholesale-priced); colour and head size are created during STYLING, so
colour×size variants and the RETAIL price belong on the STYLED product, never
"base + add-on". Plus: a global size-premium config + head-size guide, a
searchable base picker, per-colour pictures, and reversible deletes.

**Migration `template/000041_business_catalogue_styled_variants.sql.template`
(NEW, additive).** Applied to existing brands by `db:repair` (every statement
is idempotent — `IF NOT EXISTS` / `ON CONFLICT` / `DROP CONSTRAINT IF EXISTS`).

- **NEW** `styled_product_colours` — a styled product's colour options; each
  owns its pictures (`product_images.styled_colour_id`, added here) + an
  optional self-hosted/IG video link + an optional per-colour price bump.
- **NEW** `styled_product_variants` — the colour × size SKU matrix. Retail =
  `COALESCE(price_override_ngn, styled.retail_price_ngn + colour.premium_ngn +
size_tier.premium_ngn)`.
- **NEW** `styled_size_tiers` — brand-wide S/M/L/XL ladder (premium +
  head-circumference range + tip), seeded (S 0 · M +5k · L +15k · XL +30k).
- **NEW** `catalogue_config` (singleton) — the customer-facing head-size guide
  copy, seeded with a friendly emoji guide; editable from the Styled tab modal.
- `styled_products` gains `retail_price_ngn` (its own size-S anchor) +
  `compare_at_price_ngn`. `style_addon_price_ngn` retained for legacy rows only.
- **Trash + Restore:** `products`/`styled_products` `UNIQUE(code, slug)`
  replaced with PARTIAL uniques over LIVE rows, so a soft-delete frees the name
  (fixes the un-recreatable "Full Frontal Curly Pixie") and restore is possible
  (the service disambiguates a reused name on restore).

**App layer:** new `styled_variants` module (colours, variant matrix bulk
generator, size/guide config, per-colour image upload via the Documents
gateway); product + styled trash/restore endpoints; admin UI for all of the
above plus a searchable base-product picker and quick add-to-collection.

---

## 2026-06-16 — Smartcomm V2: unified inbox + commerce-in-chat (PR 1)

**Source:** Owner directive — 70% of revenue arrives via Instagram +
WhatsApp DMs; the hub-system reference shipped these channels DISABLED.
This migration brings the V2.2 §6.17 vision to life: WhatsApp Cloud API

- Instagram Graph API + Cloudflare-routed inbound email all flow into
  one inbox; commerce flows (catalogue share, order capture, custom-wig
  revamp) are first-class; per-user × per-platform permissions; Praxis
  draft staging; a shareable Online QR welcome form; Service Catalogue.

**Migration `000213_shared_smartcomm_v2.sql` (NEW).**

- Extended `shared.message_channels` (`status`, `assigned_to`,
  `assigned_at`, `wa_window_expires_at`, denormalised `last_message_*`).
- Extended `shared.channel_members` (`is_pinned`, `muted_until`,
  `notification_pref`, `last_seen_at`).
- Extended `shared.messages` (`edited_at`, `is_forwarded`,
  `forwarded_from_id`, `delivery_status`, `delivery_error`).
- **NEW** `shared.message_reactions`, `shared.message_stars`,
  `shared.message_drafts` (Praxis-/human-staged replies),
  `shared.message_quick_replies` (personal + brand-shared with
  `{{variable}}` interpolation),
  `shared.contact_social_handles` (multi-platform identity bridge),
  `shared.messaging_accounts` (webhook → brand routing — separate from
  `social_accounts` which is for posting),
  `shared.smartcomm_platform_permissions` (per-user × per-platform ×
  per-business reply/template/close + personal mute),
  `shared.user_dnd_schedules` (weekday × local-time DND),
  `shared.customer_onboarding_submissions` (the Online QR form),
  `shared.service_offerings` (Service Catalogue — revamps, custom
  styles, install, etc.),
  `shared.brand_voice_config` (Praxis per-brand tone + FAQ + few-shot
  transcripts; classify-inbound and draft-on-tap toggles default OFF
  and ON respectively).
- Widened `shared.social_accounts.platform` to include
  `whatsapp_business` and `email`.
- Added triggers:
  - `fn_smartcomm_touch_channel` — keeps the denormalised
    `last_message_*` columns in sync with every insert/edit/delete.
  - `fn_smartcomm_refresh_wa_window` — resets `wa_window_expires_at`
    to NOW+24h on every inbound from the customer.
- Seeded `permission_module_keys` with `service_catalogue` and
  `customer_onboarding`.

**Schema-wide impact:** shared table count: 104 → 115 (added 11);
`message_channels` and `channel_members` and `messages` widened.

---

## 2026-06-15 — Products: Base/Styled, Cost Vault, pre-order, AI drafting

**Source:** V2.2 §6.4/§6.24 audit gaps P0-6 (3-tier Base→Styled catalogue),
P0-7 (pre-order / production timeline), P0-1 (cost field-privacy), plus the
owner's "only Faith sees true cost & supplier" requirement.

**Phase 1 — data model (this entry):**

- **P0-6** `template/000016` — **NEW `styled_products`** table: a
  storefront-facing "Styled" skin over exactly one base product (`products`,
  which stays the only stock-bearing record). Many styled per base; no stock
  of its own; final price = base + `style_addon_price_ngn`; lifecycle
  `draft→live→archived` with AI-draft provenance columns. Added nullable
  `product_images.styled_id` so a styled skin can carry its own gallery.
- **P0-1** `template/000016` — **NEW `product_variant_cost_vault`**: true
  landed cost + supplier identity, AES-256-GCM encrypted at the app layer
  (`encryption.service`). `products.cost_price_ngn`/`min_price_ngn` are now
  DEPRECATED (left NULL; redacted regardless). `template/000038` — vault
  added to the `hub_basic` sensitive-table exclusion list.
- **P0-1** `000117_shared_cost_vault_grants.sql` (**NEW**) — owner-controlled
  per-USER vault access list, modelled on `ai_access_grants`. Visibility is
  nobody-by-default except the owner (is_ceo); only the owner writes it.
- **P0-7** `template/000016` — `products` gains `preorder_enabled`,
  `expected_ready_date`, `production_lead_days` for the production-framed
  out-of-stock fallback ("In production · ready ~{date}").
- `000015` — seeded AI feature flag `products_ai_drafting` (draft-only).
- `000103` — catalogue `publish` action (owner/admin/manager) for the
  styled draft→live workflow.

Existing dev brand schemas (pixiegirl, faitlynhair) must be re-bootstrapped
(`npm run db:reset` then bootstrap) to pick up the new per-brand tables;
`000117` applies to the shared schema via `db:migrate:shared`.

## 2026-06-04 — V2.2 conformance pass

**Source:** `Final_PixieGirl_Hub_Product_Description_v2_2__3_.html`
(authoritative V2.2, full module-by-module audit)

A complete conformance pass against the final V2.2 spec, organised into
three buckets. Three architectural decisions were locked in first:
RLS = full (Option A); E-signature = full workflow tables;
Cash Request = shared table with `business` discriminator.

### Bucket A — cheap spec mismatches

- **A-1** `template/000035` — loyalty tier thresholds corrected to V2.2
  values (0 / 500 / 2,000 / 5,000 lifetime points). Were 20× too high.
- **A-2 / A-9** `000008`, `000015` — stylist tier dictionary
  `shared.stylist_tier_keys` seeded Certified → Pro → Elite; comment on
  `stylist_partners.current_tier_key` updated.
- **A-3** `template/000034` — `fn_kpi_weights_sum_to_100` CONSTRAINT
  TRIGGER (DEFERRABLE) blocks any active-KPI weight set that doesn't
  total exactly 100. Live-tested: rejects a 5th KPI pushing the sum to 110.
- **A-4** `template/000020` — POS `client_idempotency_key` + partial
  UNIQUE index `(terminal_id, client_idempotency_key)` to stop
  double-charge on network retry.
- **A-5** `000010` — `shared.customer_wishlists` (contact_id, business,
  soft-FK variant_id, snapshots, lifecycle) + GRANT to `hub_storefront`.
- **A-6 / C-4** `000002`, `template/000019/000020/000022` — all
  `strive_connect` references replaced with `opay` (Strive Connect is
  not in V2.2).
- **A-7** `template/000035` — Payment Processing Fees split into 9
  per-gateway × per-currency COA sub-accounts (5510–5518).
- **A-8** — verified cancellation defaults already correct (3 hr free /
  50% custom non-refundable); no change.

### Bucket B — missing spec features

- **B-1** `000100_shared_cash_request.sql` — **NEW Module 6.32 Cash
  Request & Disbursement.** Four shared tables (cash_requests +
  state_history + documents + settlements), 8-state status pill, mandatory
  `bank_transaction_id` at disbursement (CHECK), append-only state log via
  trigger, CEO-threshold config in business_config. Live-tested the full
  4-stage workflow PXG-CR-0001: pending_finance → pending_ceo → approved →
  disbursed (correctly blocked without bank_transaction_id, succeeded with).
- **B-2** `000002`, `template/000016/000019/000034` — installment payment
  model. `payment_model` ('layaway' | 'deposit_triggered' |
  'full_payment_only') on products + variant overrides; sales_orders
  lifecycle fields (required_deposit_ngn, deposit_met_at, fully_paid_at,
  abandoned_at, last_payment_at); sales_order_payments manual-transfer +
  idempotency fields; `fn_sales_order_recompute_paid` rewritten to set the
  sticky timestamps; `fn_validate_manual_payment` guard. Live-tested the
  3-stage manual-payment gate.
- **B-9** `000002` — `payment_gateway_fees` JSONB in business_config
  (Paystack/Opay 1.5% capped ₦2k, Nomba 0.5%, Stripe 3.4%+$0.30 uncapped).
- **B-3** `template/000036` — **Streak Stars.** earn_rules, tiers, ledger
  (append-only), customer_streak_state (trigger-maintained). Tier ladder
  Starlet → Rising Star → Shining Star → Supernova → Galaxy
  (100/200/400/700★ → 10/15/20/25% lifetime discount). Live-tested
  auto-promotion 50★ → 110★ (Rising Star) → 810★ (Galaxy 25%).
- **B-4** `template/000036` — **Hair Quiz** ("Find your style"): quizzes,
  questions, responses; links to a star-award rule + CRM lead capture.
  Seeded a 5-question starter quiz.
- **B-7** `template/000036` — storefront analytics: sessions, page_views,
  funnel_events (view → ATC → checkout → complete).
- **B-5** `template/000037` — **UGC pipeline + self-hosted video.**
  media_assets (canonical self-hosted store) + ugc_ingestion_queue
  (IG/TikTok capture → FFmpeg → moderation). `product_videos` migrated off
  the embed model: source CHECK now only `direct_upload` / `ugc_ingested`,
  `media_asset_id` NOT NULL FK, embed_url/external_ref deprecated.
- **B-6** `template/000019` — Public Order Form: sales_channel CHECK
  extended with public_form / facebook / tiktok / intercompany.
- **B-8** `template/000037` — Curated Delivery Letter + Install QR Hub:
  delivery_letter_templates (+ default seed with 7 layout blocks) and
  delivery_letter_renders (QR reuses public_tracking_token).
- **B-10** `000101_shared_esignature.sql` — **full e-signature workflow.**
  signature_requests + signers (exactly-one-of user/contact/external CHECK)
  - tamper-evident audit_events (append-only, hash-chained). documents gains
    signing_state + frozen_at + a frozen-doc lock trigger.

### Bucket C — architectural

- **C-1** `000200_shared_rls.sql` — **Row-Level Security (Option A).**
  `shared.current_business()` / `shared.current_user_id()` GUC helpers;
  generator enables RLS + a `brand_isolation` policy on every shared table
  with a `business` column (**63 policies**); custom dual-visibility policy
  for intercompany (seller_brand OR buyer_brand); `pixie_app` role
  (no BYPASSRLS). Live-tested: CEO/no-GUC sees both brands; per-brand
  context sees only its own rows.
- **C-2** `template/000038` — field-level privacy: 6 restricted views per
  brand hiding cost_price / factory cost / salary; roles hub_full /
  hub_basic / hub_payroll with a grant matrix that denies hub_basic the
  base sensitive tables.
- **C-3** `000202_shared_soft_fk_reconciliation.sql` — soft_fk_registry +
  reconciliation_runs + findings + 2 helper functions; 8 critical
  cross-schema soft-FK pairs registered for the nightly orphan sweep.

### Net schema delta

| Layer                    | Before  | After   |
| ------------------------ | ------- | ------- |
| shared base tables       | 107     | 119     |
| pixiegirl base tables    | 159     | 173     |
| faitlynhair base tables  | 159     | 173     |
| **total base tables**    | **425** | **465** |
| restricted views / brand | 0       | 6       |
| shared RLS policies      | 0       | 63      |
| soft-FK registrations    | 0       | 8       |

### App-layer follow-ups (TODO, documented not coded)

- `withBrand(brand, fn)` helper in `src/config/database.js` that runs
  `SET LOCAL app.current_business` per transaction.
- Cron `src/jobs/schedulers/soft-fk-reconciliation.js` to call
  `fn_soft_fk_reconciliation_start/finish`.
- Cron for layaway abandonment + reminders (reads the B-2 partial index).
- The signing UX (signature pad, PDF sealing) + UGC FFmpeg worker.
- Set `pixie_app` LOGIN + password out-of-band; point the app's DB user
  at it so RLS actually engages (superuser bypasses RLS).

---

## 2026-05-26 — V2.2 alignment

**Source:** `PixieGirl_Hub_Product_Description_V2__2_.html`
(V2.2 of the Product Description, received 2026-05-26)

### Summary of the spec delta

V2.2 added five concrete refinements over V2.1:

1. **Module 6.11 (HR & Payroll)** — Faitlyn employment-handbook detail:
   probation tracking, leave balances (annual / public holidays /
   "Special Event Days" day-off-in-lieu), non-solicitation window,
   summary-dismissal trigger log, sale-channel on commissions,
   weighted performance appraisal (Customer Feedback 40% / Sales
   Conversion 25% / Work Quality 20% / Cleanliness 15%).
2. **Module 6.24 (Production)** — the Faitlyn "Service Job Tracker"
   (digitises the Hair Assignment Register), with a 5-item service
   taxonomy (Installation / Revamping / Colour Creation /
   Customization / Packing), each priced and tracked individually
   for itemised intercompany styling invoices.
3. **Module 6.27 (Org & Workflow Builder)** — dotted-line reporting
   (information only, no approval authority), deputy pattern
   (a role inheriting "most of the CEO's operational capacities"),
   amount-thresholded approvals (manager approves up to N, escalates
   above).
4. **Module 6.30 (AI Insights)** — auto-generated weekly reports
   (replacing the manual Saturday 8 PM Zoho/Sheet ritual).
5. **Section 8 (Technology) — NEW deep-dive AI pages (8.1–8.5)**:
   - Thin-server stack: DeepSeek (LLM) + Groq Whisper API
     (transcription) + OpenAI text-embedding-3-small (embeddings) +
     pgvector
   - Three vendors → three encrypted, CEO-controlled API keys
   - **Future-proofing the embeddings**: dedicated table keyed to
     source records, with `embedding_model` + `embedding_version`,
     source text retained alongside the vector
   - Permission-scoped + entity-scoped RAG retrieval **before**
     similarity ranking (data-leak prevention)
   - Action catalogue gains `entity_scope` and explicit `is_write`

### Files edited in place

| File                          | What changed                                                                                                                                                                                                                                                                                                                                            | Why                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `000003_shared_people.sql`    | `staff_profiles`: added probation*\*, annual_leave*_, public*holiday*_, special*event_days*_, non*solicit*_, dismissal_triggers_log                                                                                                                                                                                                                     | Module 6.11 — Faitlyn HR fields                                                                                              |
| `000003_shared_people.sql`    | `staff_profiles`: added 2 partial indexes (probation ending, non-solicit active)                                                                                                                                                                                                                                                                        | Common HR queries from spec                                                                                                  |
| `000003_shared_people.sql`    | `leave_requests`: extended `leave_type` CHECK to include `special_event_in_lieu`, `public_holiday`, `bereavement`                                                                                                                                                                                                                                       | Module 6.11 leave types                                                                                                      |
| `000003_shared_people.sql`    | `org_positions`: added `reports_to_position_id` (solid-line FK), `is_deputy` flag, `deputy_capacities[]`, `approval_threshold_ngn`                                                                                                                                                                                                                      | Module 6.27 — deputy pattern + thresholds                                                                                    |
| `000003_shared_people.sql`    | **NEW table** `org_position_dotted_lines`                                                                                                                                                                                                                                                                                                               | Module 6.27 — dotted-line reporting (info-only, never used for approval routing)                                             |
| `000003_shared_people.sql`    | `workflow_definitions` comment: expanded JSON shape to document amount thresholds, deputy fallback, dotted-line non-routing                                                                                                                                                                                                                             | Module 6.27 — clarification for engineers                                                                                    |
| `000012_shared_ai.sql`        | `ai_action_catalogue`: **removed inline `embedding vector(1536)` column**, added `title`, `entity_scope` (pxg/flh/both/any), `is_write` boolean; dropped `idx_ai_actions_embedding` (moves to new table)                                                                                                                                                | V2.2 §8.1 (embeddings in dedicated table) + §8.3 (entity_scope, is_write)                                                    |
| `000012_shared_ai.sql`        | `ai_knowledge_chunks`: **removed inline `embedding vector(1536) NOT NULL`**; added `required_permissions[]`, `sensitivity`, `contains_field_tags[]`, `content_hash`; widened source_type CHECK to include `action_catalogue` and `action_example`                                                                                                       | V2.2 §8.4 (permission-scoped retrieval BEFORE similarity ranking) + §8.1 (dedicated embeddings table)                        |
| `000012_shared_ai.sql`        | **NEW table** `shared.ai_embeddings` (the dedicated embeddings store) — soft FKs by `(source_table, source_id, source_sub_key)`, columns for `embedding_model`, `embedding_version`, `embedding_dim`, retained `source_text`, denormalised `business` + `required_permissions[]` + `sensitivity` for filter-before-rank, `is_stale` flag for migrations | V2.2 §8.1 ("a future move off vector(1536) becomes a controlled migration, with no data loss and no core-schema disruption") |
| `000012_shared_ai.sql`        | **NEW table** `shared.ai_vendor_credentials` — encrypted multi-vendor API key store; cost tables (per-1k input/output tokens, per-audio-minute); per-vendor monthly caps                                                                                                                                                                                | V2.2 §8.1 ("three vendor keys, stored encrypted, CEO-controlled, AI Control meters per-vendor usage")                        |
| `000012_shared_ai.sql`        | `ai_usage_ledger`: added `audio_seconds` column; clarified `provider` semantics                                                                                                                                                                                                                                                                         | V2.2 §8.1 (Groq Whisper bills per minute, needs separate tracking)                                                           |
| `000012_shared_ai.sql`        | `ai_usage_daily`: added `vendor` to the unique key; added `audio_seconds` aggregate                                                                                                                                                                                                                                                                     | Per-vendor live spend meter on AI Control dashboard                                                                          |
| `000014_shared_triggers.sql`  | `fn_ai_usage_rollup()` updated to include `vendor` and `audio_seconds` in the daily aggregate                                                                                                                                                                                                                                                           | Matches the schema change above                                                                                              |
| `000015_shared_seed_data.sql` | Changed `praxis_voice` default_provider from `self_whisper` to `groq`, default_model unchanged                                                                                                                                                                                                                                                          | V2.2 §8.1 (Groq Whisper API replaces self-hosted)                                                                            |
| `000015_shared_seed_data.sql` | Added 3 new feature flags: `insights_weekly_report`, `insights_service_match`, `embeddings`                                                                                                                                                                                                                                                             | Module 6.30 weekly report auto-gen; service-job anti-pocketing; embeddings as a costed feature                               |
| `000015_shared_seed_data.sql` | Seeded `shared.ai_vendor_credentials` with the 3 launch vendors and current public per-token pricing                                                                                                                                                                                                                                                    | Bootstrap the multi-vendor metering                                                                                          |

### Schema-wide impact summary

- Table count: shared schema went from **101 → 104 tables**
  (added: `org_position_dotted_lines`, `ai_embeddings`, `ai_vendor_credentials`)
- Dropped columns: `ai_action_catalogue.embedding`, `ai_knowledge_chunks.embedding`
- The pgvector ivfflat index moved from being two per-source indexes
  to one unified index on `ai_embeddings.embedding`. The retrieval
  pattern is now: filter by business/permissions/sensitivity in the
  WHERE clause, ORDER BY cosine distance, LIMIT N.

### Still in the per-business templates (next files to be built)

The V2.2 changes that land in the per-business `template/*.sql.template`
files (NOT in shared) are noted here for tracking:

1. **`000018_business_payroll.sql.template`** — `commission_earned`
   table needs a `sale_channel` column (Instagram / Website / WhatsApp
   / Walk-in) per V2.2 §6.11; performance appraisal tables
   (`performance_cycles`, `performance_scores` with weighted KPIs).
2. **`000015_business_production.sql.template`** — the Faitlyn Service
   Job Tracker (`service_jobs`, `service_types` taxonomy with cost +
   turnaround + colour recipe).
3. **`000023_business_dashboards_reports.sql.template`** — saved
   weekly report templates (Sales report, Customer report) backing
   the auto-generation in `insights_weekly_report`.

These are planned for the per-business template build, not patches.

### Validation

All 16 shared migrations apply cleanly with `ON_ERROR_STOP=1` against
PostgreSQL 16 + pgvector 0.6. End-to-end test confirms:

- Embedding model versioning (two versions side-by-side, stale flag)
- Permission-scoped retrieval (array containment filter before
  vector similarity)
- All 12 spot-checks of V2.2 features pass.

---

## 2026-05-25 — Initial shared schema build

**Source:** `PixieGirl_Hub_Product_Description_V2__1_.html` (V2.1).

Initial 15-file migration set built. See the per-file headers for
scope. No prior changelog entries.
