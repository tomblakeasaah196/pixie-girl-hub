-- ============================================================
-- Who was FLH-JOB-0030 assigned to?  (and everything else we hold on it)
--
-- RUN (from project root):
--   psql -U hub_admin -d pixiedata -f scripts/investigate-job.sql
--
-- To look at a different job, change :job below.
-- ============================================================
\set job 'FLH-JOB-0030'
\pset expanded on

-- ── 1. The job row + the assignee's NAME (this is the answer) ──
SELECT
  j.job_number,
  j.status,
  st.display_name                                   AS service_type,
  COALESCE(u.display_name, u.email::text, sp.display_name) AS assigned_to,
  CASE
    WHEN j.assigned_staff_user_id IS NOT NULL THEN 'in-house staff'
    WHEN j.assigned_stylist_id    IS NOT NULL THEN 'external stylist partner'
    ELSE 'NOBODY right now — see sections 2 and 4 for who had it'
  END                                               AS assignee_kind,
  j.assigned_staff_user_id,
  j.assigned_stylist_id,
  cust.display_name                                 AS customer,
  so.order_number                                   AS sales_order,
  so.status                                         AS order_status,
  so.placed_at                                      AS order_placed_at,
  sty.name                                          AS styled_product,
  pv.variant_name                                   AS base_product,
  j.hair_description,
  j.scheduled_for,
  j.expected_completion_at,
  j.started_at,
  j.completed_at,
  j.cancelled_at,
  j.cancellation_reason,
  COALESCE(cu.display_name, cu.email::text)         AS created_by,
  j.created_at,
  j.updated_at
FROM faitlynhair.service_jobs j
LEFT JOIN faitlynhair.service_types    st   ON st.service_type_id = j.service_type_id
LEFT JOIN shared.users                 u    ON u.user_id  = j.assigned_staff_user_id
LEFT JOIN shared.stylist_partners      sp   ON sp.stylist_id = j.assigned_stylist_id
LEFT JOIN shared.contacts              cust ON cust.contact_id = j.customer_contact_id
LEFT JOIN faitlynhair.sales_orders     so   ON so.order_id = j.sales_order_id
LEFT JOIN faitlynhair.styled_products  sty  ON sty.styled_id = j.styled_id
LEFT JOIN faitlynhair.product_variants pv   ON pv.variant_id = j.hair_variant_id
LEFT JOIN shared.users                 cu   ON cu.user_id = j.created_by
WHERE j.job_number = :'job';

\pset expanded off

-- ── 2. Audit trail — every touch, in order, with who did it ──
-- If the job was assigned then unassigned/reassigned, this still holds the
-- ORIGINAL assigned_staff_user_id. Note service_jobs.unassign records the
-- person it was taken away from under metadata.reverted_assignee.
SELECT a.occurred_at,
       a.user_name                                   AS actor,
       a.action,
       a.before_state ->> 'status'                   AS status_before,
       a.after_state  ->> 'status'                   AS status_after,
       a.before_state ->> 'assigned_staff_user_id'   AS staff_before,
       a.after_state  ->> 'assigned_staff_user_id'   AS staff_after,
       a.metadata     ->> 'reverted_assignee'        AS reverted_assignee,
       a.metadata     ->> 'assigned_staff_user_id'   AS meta_assigned
FROM shared.audit_log a
WHERE a.record_id = (SELECT job_id FROM faitlynhair.service_jobs WHERE job_number = :'job')
ORDER BY a.occurred_at;

-- ── 3. Wig custody ledger — who PHYSICALLY took the hair ──
-- Strongest evidence of possession; never rewound, so it survives
-- cancellation and unassignment. 'out' with no matching 'return' = still held.
SELECT l.created_at, l.event, l.quantity, l.location, l.reason,
       COALESCE(su.display_name, su.email::text) AS stylist_holding,
       COALESCE(bu.display_name, bu.email::text) AS logged_by
FROM faitlynhair.wig_custody_ledger l
LEFT JOIN shared.users su ON su.user_id = l.stylist_user_id
LEFT JOIN shared.users bu ON bu.user_id = l.created_by
WHERE l.job_id = (SELECT job_id FROM faitlynhair.service_jobs WHERE job_number = :'job')
ORDER BY l.created_at;

-- ── 4. Time logs — who actually clocked on to it ──
SELECT tl.started_at, tl.ended_at, tl.duration_minutes, tl.note,
       COALESCE(u.display_name, u.email::text) AS stylist
FROM faitlynhair.service_job_time_logs tl
LEFT JOIN shared.users u ON u.user_id = tl.stylist_user_id
WHERE tl.job_id = (SELECT job_id FROM faitlynhair.service_jobs WHERE job_number = :'job')
ORDER BY tl.started_at;

-- ── 5. Sibling jobs on the same order (the multi-hair split) ──
-- FLH-SO-0059 may have produced several jobs; the hair may be sitting under
-- one of the others — this is exactly what the multi-hair fix changed.
SELECT j2.job_number, j2.status,
       COALESCE(u2.display_name, u2.email::text) AS assigned_to,
       j2.created_at, j2.cancelled_at, j2.completed_at
FROM faitlynhair.service_jobs j2
LEFT JOIN shared.users u2 ON u2.user_id = j2.assigned_staff_user_id
WHERE j2.sales_order_id = (
  SELECT sales_order_id FROM faitlynhair.service_jobs WHERE job_number = :'job'
)
ORDER BY j2.created_at;

-- ── 6. The linked task — assigning a job also raises a task ──
SELECT t.title, t.status, t.due_at,
       COALESCE(au.display_name, au.email::text) AS task_assigned_to,
       t.created_at
FROM shared.tasks t
LEFT JOIN shared.users au ON au.user_id = t.assigned_to
WHERE t.task_id = (SELECT task_id FROM faitlynhair.service_jobs WHERE job_number = :'job')
   OR (t.reference_type = 'service_job'
       AND t.reference_id = (SELECT job_id FROM faitlynhair.service_jobs WHERE job_number = :'job'));
