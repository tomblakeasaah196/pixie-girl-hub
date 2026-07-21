-- ============================================================
-- INSPECT — full footprint of ONE employee, before any deletion
-- Pixie Girl Hub · employee test-account cleanup
--
-- READ ONLY. Wrapped in BEGIN … ROLLBACK so it can NEVER write.
-- Run it first to SEE exactly what a deletion would touch, then run
-- scripts/cleanup-employee-account.sql to actually remove it.
--
-- It resolves the employee by employee_number (UNIQUE), captures the
-- three identity keys — staff profile_id, contact_id, login user_id —
-- and then scans EVERY uuid column across the shared, pixiegirl and
-- faitlynhair schemas for rows carrying any of those three ids. Because
-- it matches by uuid *value*, every hit is genuinely about this person
-- (uuids are unique) — this catches hard FKs, SET NULL FKs AND the soft
-- (plain-uuid, no-constraint) columns a hand-written table list misses.
--
--   Usage on the VPS:
--     cd /var/www/pixie-girl-hub
--     sudo -u postgres psql -d pixiedata -f - < scripts/inspect-employee-account.sql
--
--   Change the target on the next line only.
-- ============================================================
\set EMP 'FLH-EMP-0002'
\pset pager off

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '3min';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- ── Resolve identity + guard (must be exactly one profile) ──────────
CREATE TEMP TABLE _emp ON COMMIT DROP AS
SELECT sp.profile_id,
       sp.employee_number,
       sp.business,
       sp.job_title,
       sp.contact_id,
       c.display_name,
       c.primary_phone,
       c.email          AS contact_email,
       c.contact_type,
       u.user_id        AS login_user_id,
       u.email          AS login_email,
       u.is_active      AS login_active
  FROM shared.staff_profiles sp
  JOIN shared.contacts       c ON c.contact_id = sp.contact_id
  LEFT JOIN shared.users     u ON u.staff_profile_id = sp.profile_id
 WHERE sp.employee_number = :'EMP';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _emp;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 staff_profile for the employee_number set at the top of this script, found % — check the value and re-run.', n;
  END IF;
END $$;

-- WHO are we about to inspect? Eyeball this row before trusting the rest.
SELECT * FROM _emp;

-- ── Dynamic footprint: every uuid column that carries one of the ids ──
DO $$
DECLARE
  r        record;
  cnt      bigint;
  v_profile uuid;
  v_contact uuid;
  v_user   uuid;
  tgt      uuid;
  kind     text;
BEGIN
  SELECT profile_id, contact_id, login_user_id
    INTO v_profile, v_contact, v_user
    FROM _emp;

  CREATE TEMP TABLE _fp (
    match_kind  text,
    schema_name text,
    table_name  text,
    column_name text,
    rows        bigint
  ) ON COMMIT DROP;

  FOR r IN
    SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS col
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema
       AND tb.table_name   = c.table_name
       AND tb.table_type   = 'BASE TABLE'
     WHERE c.table_schema IN ('shared','pixiegirl','faitlynhair')
       AND c.data_type = 'uuid'
       AND (
              c.column_name IN ('profile_id','staff_profile_id')      -- HR / staff owned
           OR c.column_name LIKE '%contact_id'                        -- contact links
           OR c.column_name = 'user_id'                               -- login-owned (pay, perf, sessions, roles…)
           OR c.column_name IN (                                      -- "acted on by" (created/approved/etc.)
                'created_by','updated_by','assigned_to','submitted_by','initiated_by',
                'posted_by','set_by','granted_by','resolved_by','closed_by','scored_by',
                'awarded_by','approved_by','proposed_by_user_id','reviewer_user_id',
                'reviewed_by_manager_id','approved_by_user_id','sender_user_id',
                'actor_user_id','changed_by','uploaded_by','created_by_user_id','deleted_by')
       )
  LOOP
    IF r.col IN ('profile_id','staff_profile_id') THEN
      tgt := v_profile; kind := '1_profile';
    ELSIF r.col LIKE '%contact_id' THEN
      tgt := v_contact; kind := '2_contact';
    ELSIF r.col = 'user_id' THEN
      tgt := v_user;    kind := '3_login_owned';
    ELSE
      tgt := v_user;    kind := '4_acted_by';
    END IF;

    IF tgt IS NULL THEN CONTINUE; END IF;

    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1', r.s, r.t, r.col)
      INTO cnt USING tgt;

    IF cnt > 0 THEN
      INSERT INTO _fp VALUES (kind, r.s, r.t, r.col, cnt);
    END IF;
  END LOOP;
END $$;

-- Footprint, grouped:
--   1_profile      = HR/staff records keyed to the staff profile
--   2_contact      = anything linked to their contact card
--   3_login_owned  = rows OWNED by their login (payslips-by-user, commission,
--                    bonuses, performance, sessions, roles, devices…)
--   4_acted_by     = business records this account merely CREATED/APPROVED/etc.
--                    (these are the "everything they did" rows — deciding whether
--                     to delete THESE is the scope call; most FKs null them.)
SELECT match_kind, schema_name, table_name, column_name, rows
  FROM _fp
 ORDER BY match_kind, schema_name, table_name, column_name;

-- Totals per bucket
SELECT match_kind, count(*) AS tables_touched, sum(rows) AS total_rows
  FROM _fp
 GROUP BY match_kind
 ORDER BY match_kind;

ROLLBACK;   -- read-only: nothing is ever written
