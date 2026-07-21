-- Data fix: styled-product jobs mislabelled "Installation" → "Styling".
--
-- WHY: When an order clears deposit, service-jobs.createForOrder opens the job
-- and, for a styled line with no per-style default_service_type_id, it used to
-- fall through to getDefaultServiceType() — the first active service type
-- ORDER BY display_order, display_name. 'installation' seeds at display_order=1,
-- so every styled-product job came out "Installation" even though the work is
-- Styling. The code fix (service-jobs.service.js) now opens styled jobs as
-- Styling going forward; this script corrects the rows already created.
--
-- SCOPE: only jobs opened from a STYLED line (service_jobs.styled_id IS NOT NULL)
-- that currently sit on the 'installation' type. Genuine service purchases (a
-- walk-in "Long Hair Installation") have styled_id = NULL and are left alone.
-- All statuses are corrected — this is a labelling fix, not a lifecycle change
-- (agreed_cost_ngn, custody, assignments are untouched). To limit the sweep to
-- still-open jobs only, add to the _fix WHERE clause:
--     AND j.status IN ('pending','in_progress','on_hold')
--
-- Brand: faitlynhair only — Pixie Girl runs no in-house services (no service
-- jobs from this path), and the 'styling' type is a Faitlyn service.
--
-- HOW TO RUN — paste into an INTERACTIVE psql session (do NOT run with -f, which
-- would auto-commit past the review step):
--     sudo -u postgres psql -d pixiedata
--   then paste everything below. Review the BEFORE and AFTER snapshots, then
--   type  COMMIT;  if correct, or  ROLLBACK;  to abort — nothing is saved until
--   you commit.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SET LOCAL statement_timeout = '3min';

-- Guard: the Styling service type must exist (owner-added on Faitlyn). Abort the
-- whole transaction if it doesn't, rather than silently changing nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM faitlynhair.service_types
     WHERE service_key = 'styling' AND is_active = true
  ) THEN
    RAISE EXCEPTION
      'No active service_type ''styling'' on faitlynhair — create it first (Service Types -> New Type), then re-run.';
  END IF;
END $$;

-- The exact jobs in scope: styled-line jobs currently on the 'installation' type.
CREATE TEMP TABLE _fix ON COMMIT DROP AS
SELECT j.job_id, j.job_number, j.status, j.styled_id, j.sales_order_id
  FROM faitlynhair.service_jobs j
  JOIN faitlynhair.service_types inst
    ON inst.service_type_id = j.service_type_id
   AND inst.service_key = 'installation'
 WHERE j.styled_id IS NOT NULL;

-- BEFORE snapshot — eyeball exactly which jobs will flip Installation -> Styling,
-- with their order and the styled product each realises.
SELECT f.job_number,
       f.status,
       so.order_number,
       sty.name AS styled_product
  FROM _fix f
  LEFT JOIN faitlynhair.sales_orders    so  ON so.order_id   = f.sales_order_id
  LEFT JOIN faitlynhair.styled_products sty ON sty.styled_id = f.styled_id
 ORDER BY f.job_number;

-- Apply: point every mislabelled styled job at the Styling type.
UPDATE faitlynhair.service_jobs j
   SET service_type_id = st.service_type_id,
       updated_at      = now()
  FROM faitlynhair.service_types st
 WHERE st.service_key = 'styling'
   AND st.is_active   = true
   AND j.job_id IN (SELECT job_id FROM _fix);

-- AFTER snapshot — every listed job should now read service_key = 'styling'.
SELECT j.job_number,
       j.status,
       stt.service_key  AS now_service,
       stt.display_name AS now_service_name
  FROM faitlynhair.service_jobs j
  JOIN faitlynhair.service_types stt ON stt.service_type_id = j.service_type_id
 WHERE j.job_id IN (SELECT job_id FROM _fix)
 ORDER BY j.job_number;

-- Everything correct above? ->  COMMIT;
-- Anything off?            ->  ROLLBACK;
