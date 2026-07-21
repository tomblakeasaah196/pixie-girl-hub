-- ============================================================
-- CLEANUP — permanently remove ONE test employee and all their data
-- Pixie Girl Hub · employee test-account cleanup
--
-- Deletes, in FK-safe order, everything OWNED by this employee:
--   • their staff profile      -> cascades all HR: attendance_days, hr_queries,
--                                 staff_earnings_daily, performance_targets,
--                                 leave_requests, staff_contracts, staff_assets,
--                                 staff_clock_events, staff_onboarding_progress,
--                                 reward_grants, clockout_reminders, anomalies
--   • their login user         -> cascades sessions, roles, refresh tokens,
--                                 device bindings, push subs, MFA, performance
--                                 scores/reviews
--   • their pay records        -> payslips (+lines), commission_earned,
--                                 bonuses_awarded  (these DON'T cascade / would
--                                 otherwise block the login delete)
--   • their contact card       -> cascades addresses, tags, social handles and
--                                 any customer-side loyalty/crown/wishlist rows
--   • their audit-log entries  -> soft ref; removed so the footprint reads clean
--
-- Places where the account is only REFERENCED (created_by, assigned_to,
-- stylist_user_id on service jobs, sender on messages, reports_to, org
-- position, …) are left in place and auto-nulled by the DB's SET NULL rules —
-- we do NOT delete other people's records just because this account touched
-- them. If a business record the account AUTHORED is protected by a hard FK
-- (a NOT NULL created_by / initiated_by / submitted_by, e.g. a task, goal,
-- workflow, cash request, e-signature), the DELETE below will ERROR and name
-- that constraint. That is by design: the whole thing rolls back untouched and
-- you tell me what blocked, so we handle those specific rows deliberately
-- (reassign or delete) instead of silently nuking them.
--
--   Run it FIRST as a dry run:  scripts/inspect-employee-account.sql
--   Then on the VPS:
--     cd /var/www/pixie-girl-hub
--     git pull origin claude/employee-test-account-cleanup-25feac
--     sudo -u postgres psql -d pixiedata -f - < scripts/cleanup-employee-account.sql
--   Review the BEFORE list + AFTER (must be all-zeros), then COMMIT or ROLLBACK.
--
--   Change the target on the next line only.
-- ============================================================
\set EMP 'FLH-EMP-0002'
\pset pager off

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '120s';
SET LOCAL statement_timeout = '5min';

-- ── 1) Resolve identity + guard (must be exactly one profile) ────────
CREATE TEMP TABLE _emp ON COMMIT DROP AS
SELECT sp.profile_id,
       sp.employee_number,
       sp.business,
       sp.job_title,
       sp.contact_id,
       c.display_name,
       c.primary_phone,
       c.email        AS contact_email,
       c.contact_type,
       u.user_id      AS login_user_id,
       u.email        AS login_email
  FROM shared.staff_profiles sp
  JOIN shared.contacts       c ON c.contact_id = sp.contact_id
  LEFT JOIN shared.users     u ON u.staff_profile_id = sp.profile_id
 WHERE sp.employee_number = :'EMP';

DO $$
DECLARE n int; v_biz text;
BEGIN
  SELECT count(*) INTO n FROM _emp;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 staff_profile for the employee_number set at the top of this script, found % — aborting.', n;
  END IF;
  SELECT business INTO v_biz FROM _emp;
  IF v_biz NOT IN ('pixiegirl','faitlynhair') THEN
    RAISE EXCEPTION 'Unexpected business schema % — aborting.', v_biz;
  END IF;
END $$;

-- WHO are we deleting? Eyeball this before trusting anything below.
SELECT * FROM _emp;

-- ── 2) BEFORE footprint — every uuid column carrying one of the ids ──
DO $$
DECLARE
  r record; cnt bigint;
  v_profile uuid; v_contact uuid; v_user uuid; tgt uuid; kind text;
BEGIN
  SELECT profile_id, contact_id, login_user_id INTO v_profile, v_contact, v_user FROM _emp;

  DROP TABLE IF EXISTS _fp;
  CREATE TEMP TABLE _fp (match_kind text, schema_name text, table_name text, column_name text, rows bigint) ON COMMIT DROP;

  FOR r IN
    SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS col
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
       AND tb.table_type = 'BASE TABLE'
     WHERE c.table_schema IN ('shared','pixiegirl','faitlynhair')
       AND c.data_type = 'uuid'
       AND ( c.column_name IN ('profile_id','staff_profile_id')
             OR c.column_name LIKE '%contact_id'
             OR c.column_name = 'user_id'
             OR c.column_name IN ('created_by','updated_by','assigned_to','submitted_by','initiated_by',
                 'posted_by','set_by','granted_by','resolved_by','closed_by','scored_by','awarded_by',
                 'approved_by','proposed_by_user_id','reviewer_user_id','reviewed_by_manager_id',
                 'approved_by_user_id','sender_user_id','actor_user_id','changed_by','uploaded_by',
                 'created_by_user_id','deleted_by') )
  LOOP
    IF r.col IN ('profile_id','staff_profile_id') THEN tgt := v_profile; kind := '1_profile';
    ELSIF r.col LIKE '%contact_id' THEN tgt := v_contact; kind := '2_contact';
    ELSIF r.col = 'user_id' THEN tgt := v_user; kind := '3_login_owned';
    ELSE tgt := v_user; kind := '4_acted_by';
    END IF;
    IF tgt IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1', r.s, r.t, r.col) INTO cnt USING tgt;
    IF cnt > 0 THEN INSERT INTO _fp VALUES (kind, r.s, r.t, r.col, cnt); END IF;
  END LOOP;
END $$;

\echo '===== BEFORE: rows tied to this employee ====='
SELECT match_kind, schema_name, table_name, column_name, rows
  FROM _fp ORDER BY match_kind, schema_name, table_name, column_name;
SELECT match_kind, count(*) AS tables_touched, sum(rows) AS total_rows
  FROM _fp GROUP BY match_kind ORDER BY match_kind;

-- ── 3) Delete OWNED rows that don't cascade / would block the login ──
--     (brand pay records + their own audit-log entries)
DO $$
DECLARE v_biz text; v_user uuid; v_profile uuid; d bigint;
BEGIN
  SELECT business, login_user_id, profile_id INTO v_biz, v_user, v_profile FROM _emp;

  -- performance scores/reviews cascade from the user delete, but clear them
  -- explicitly too so a NO-ACTION variant can never block. Guarded by table
  -- existence so it is safe on any brand.
  IF v_user IS NOT NULL THEN
    IF to_regclass(format('%I.commission_earned', v_biz)) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I.commission_earned WHERE user_id = $1', v_biz) USING v_user;
      GET DIAGNOSTICS d = ROW_COUNT; RAISE NOTICE 'commission_earned: % rows', d;
    END IF;
    IF to_regclass(format('%I.bonuses_awarded', v_biz)) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I.bonuses_awarded WHERE user_id = $1', v_biz) USING v_user;
      GET DIAGNOSTICS d = ROW_COUNT; RAISE NOTICE 'bonuses_awarded: % rows', d;
    END IF;
  END IF;

  -- payslips (cascades payslip_lines; also clears payroll_deductions if those
  -- hang off the payslip). Keyed by profile and/or login.
  IF to_regclass(format('%I.payslips', v_biz)) IS NOT NULL THEN
    EXECUTE format('DELETE FROM %I.payslips WHERE staff_profile_id = $1 OR user_id = $2', v_biz)
      USING v_profile, v_user;
    GET DIAGNOSTICS d = ROW_COUNT; RAISE NOTICE 'payslips: % rows', d;
  END IF;

  -- Their own audit-log entries (soft ref — no FK). Comment this line out if
  -- you would rather RETAIN the audit trail (it will just point at a gone id).
  IF v_user IS NOT NULL THEN
    DELETE FROM shared.audit_log WHERE user_id = v_user;
    GET DIAGNOSTICS d = ROW_COUNT; RAISE NOTICE 'audit_log: % rows', d;
  END IF;
END $$;

-- ── 4) Delete the login (cascades sessions/roles/tokens/devices/perf) ─
DELETE FROM shared.users
 WHERE user_id IN (SELECT login_user_id FROM _emp WHERE login_user_id IS NOT NULL);

-- ── 5) Delete the staff profile (cascades ALL HR records) ────────────
DELETE FROM shared.staff_profiles
 WHERE profile_id IN (SELECT profile_id FROM _emp);

-- ── 6) Delete the contact card (cascades owned contact children) ─────
DELETE FROM shared.contacts
 WHERE contact_id IN (SELECT contact_id FROM _emp);

-- ── 7) AFTER footprint — this MUST come back EMPTY to COMMIT ─────────
DO $$
DECLARE
  r record; cnt bigint;
  v_profile uuid; v_contact uuid; v_user uuid; tgt uuid; kind text;
BEGIN
  SELECT profile_id, contact_id, login_user_id INTO v_profile, v_contact, v_user FROM _emp;
  DROP TABLE IF EXISTS _after;
  CREATE TEMP TABLE _after (match_kind text, schema_name text, table_name text, column_name text, rows bigint) ON COMMIT DROP;
  FOR r IN
    SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS col
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type='BASE TABLE'
     WHERE c.table_schema IN ('shared','pixiegirl','faitlynhair')
       AND c.data_type = 'uuid'
       AND ( c.column_name IN ('profile_id','staff_profile_id')
             OR c.column_name LIKE '%contact_id'
             OR c.column_name = 'user_id' )
  LOOP
    IF r.col IN ('profile_id','staff_profile_id') THEN tgt := v_profile;
    ELSIF r.col LIKE '%contact_id' THEN tgt := v_contact;
    ELSE tgt := v_user; END IF;
    IF tgt IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1', r.s, r.t, r.col) INTO cnt USING tgt;
    IF cnt > 0 THEN INSERT INTO _after VALUES ('LEFTOVER', r.s, r.t, r.col, cnt); END IF;
  END LOOP;
END $$;

\echo '===== AFTER: OWNED rows still remaining (must be empty) ====='
SELECT * FROM _after ORDER BY schema_name, table_name, column_name;

-- ============================================================
--  DECISION
--  • BEFORE list is all this test employee's data, AND
--  • AFTER list is EMPTY (0 rows), AND
--  • nothing above raised a foreign-key ERROR
--      -> COMMIT;
--  • Anything looks real, or a *_by/created_by/initiated_by FK error appeared
--      -> ROLLBACK;   (then tell me which constraint blocked)
-- ============================================================
-- COMMIT;
-- ROLLBACK;
