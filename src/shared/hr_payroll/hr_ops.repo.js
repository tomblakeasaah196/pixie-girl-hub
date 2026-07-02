/**
 * HR operations repository (HR Phase 1).
 *
 * Parameterised SQL for the operational HR tables introduced in migration
 * 000233 plus the existing leave / clock / contract tables, all in the
 * `shared` schema and scoped by brand. Cross-brand staff (answer #12) are
 * matched on `business = brand OR brand = ANY(additional_businesses)`, but
 * payroll-owning queries use the primary `business` only.
 *
 * Repos never emit events or touch req/res — the service layer does that.
 */

"use strict";

const { ex: exec } = require("../../config/database");
// Staff visible to a brand: primary brand OR listed as an additional brand.
const VISIBLE = `(sp.business = $1 OR $1 = ANY(sp.additional_businesses))`;

// ── analytics (HR dashboard) ───────────────────────────────
/** Month-to-date HR metrics for the dashboard, scoped to the brand. */
async function analytics({ client, brand, year, month }) {
  const { rows } = await exec(client)(
    `WITH md AS (
       SELECT * FROM shared.attendance_days
        WHERE business = $1
          AND date_part('year', work_date) = $2
          AND date_part('month', work_date) = $3
     )
     SELECT
       (SELECT count(*) FROM shared.staff_profiles sp
         WHERE ${VISIBLE} AND sp.is_deleted = false
           AND (sp.end_date IS NULL OR sp.end_date >= CURRENT_DATE))::int AS headcount,
       (SELECT count(*) FROM md WHERE status IN ('present','late'))::int AS present_days,
       (SELECT count(*) FROM md WHERE status = 'late')::int AS late_days,
       (SELECT count(*) FROM md WHERE status = 'absent')::int AS absent_days,
       (SELECT count(*) FROM md WHERE status = 'on_leave')::int AS leave_days,
       (SELECT count(*) FROM md WHERE is_offsite = true)::int AS offsite_days,
       (SELECT COALESCE(SUM(deduction_ngn),0) FROM md WHERE justified = false)::numeric AS lateness_deductions_ngn,
       (SELECT count(*) FROM shared.hr_queries q
         WHERE q.business = $1 AND q.status IN ('open','responded'))::int AS open_queries,
       (SELECT count(*) FROM shared.leave_requests lr
          JOIN shared.staff_profiles sp ON sp.profile_id = lr.profile_id
         WHERE ${VISIBLE} AND lr.status = 'pending')::int AS pending_leave,
       (SELECT count(*) FROM shared.performance_targets t
         WHERE t.business = $1 AND t.period_year = $2 AND t.period_month = $3
           AND t.status = 'active')::int AS active_targets,
       (SELECT count(*) FROM shared.performance_targets t
         WHERE t.business = $1 AND t.period_year = $2 AND t.period_month = $3
           AND t.status = 'achieved')::int AS achieved_targets,
       (SELECT COALESCE(SUM(earned_ngn),0) FROM shared.staff_earnings_daily e
         WHERE e.business = $1
           AND date_part('year', e.work_date) = $2
           AND date_part('month', e.work_date) = $3)::numeric AS earned_mtd_ngn`,
    [brand, year, month],
  );
  return rows[0];
}

// ── identity ───────────────────────────────────────────────
/** Resolve the staff profile linked to a user, if visible to the brand. */
async function profileForUser({ client, brand, userId }) {
  const { rows } = await exec(client)(
    `SELECT sp.*, c.display_name, c.primary_phone, c.email AS contact_email
       FROM shared.users u
       JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE u.user_id = $2 AND ${VISIBLE} AND sp.is_deleted = false
      LIMIT 1`,
    [brand, userId],
  );
  return rows[0] || null;
}

async function profileById({ client, brand, profileId }) {
  const { rows } = await exec(client)(
    `SELECT sp.*, c.display_name, u.user_id
       FROM shared.staff_profiles sp
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
       LEFT JOIN shared.users u ON u.staff_profile_id = sp.profile_id
      WHERE sp.profile_id = $2 AND ${VISIBLE} AND sp.is_deleted = false
      LIMIT 1`,
    [brand, profileId],
  );
  return rows[0] || null;
}

/** All active staff for a brand (incl. cross-brand). Lightweight columns. */
async function activeStaff({ client, brand }) {
  const { rows } = await exec(client)(
    `SELECT sp.profile_id, sp.business, sp.base_salary, sp.job_title,
            sp.work_schedule, sp.work_expected_start_time, sp.work_grace_minutes,
            c.display_name
       FROM shared.staff_profiles sp
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE ${VISIBLE} AND sp.is_deleted = false
        AND (sp.end_date IS NULL OR sp.end_date >= CURRENT_DATE)`,
    [brand],
  );
  return rows;
}

// ── hr_settings ────────────────────────────────────────────
async function getSettings({ client, brand }) {
  const run = exec(client);
  let { rows } = await run(
    `SELECT * FROM shared.hr_settings WHERE business = $1`,
    [brand],
  );
  if (!rows[0]) {
    // Lazily create the default row so a brand added after 000233 still works.
    ({ rows } = await run(
      `INSERT INTO shared.hr_settings (business) VALUES ($1)
         ON CONFLICT (business) DO UPDATE SET updated_at = now()
       RETURNING *`,
      [brand],
    ));
  }
  return rows[0];
}

async function updateSettings({ client, brand, patch }) {
  const cols = [
    "lateness_enabled",
    "lateness_tiers",
    "lateness_auto_query",
    "lateness_query_reminder_days",
    "default_grace_minutes",
    "default_expected_start_time",
    "working_days",
    "leave_escalation_days",
    "earnings_tracker_enabled",
    "geofence_enabled",
    "geofence_required_on_site",
    "geofence_accuracy_max_m",
    "offsite_auto_query",
    "offsite_marks_absent",
    "payout_require_pin",
    "payout_provider",
    "onboarding_checklist",
    "contract_template_doc_id",
  ];
  const jsonb = new Set(["lateness_tiers", "onboarding_checklist"]);
  const arr = new Set(["working_days"]);
  const sets = [];
  const params = [brand];
  let i = 2;
  for (const col of cols) {
    if (patch[col] === undefined) continue;
    if (jsonb.has(col)) {
      sets.push(`${col} = $${i}::jsonb`);
      params.push(JSON.stringify(patch[col]));
    } else if (arr.has(col)) {
      sets.push(`${col} = $${i}::text[]`);
      params.push(patch[col]);
    } else {
      sets.push(`${col} = $${i}`);
      params.push(patch[col]);
    }
    i++;
  }
  if (!sets.length) return getSettings({ client, brand });
  const { rows } = await exec(client)(
    `UPDATE shared.hr_settings SET ${sets.join(", ")}
      WHERE business = $1 RETURNING *`,
    params,
  );
  return rows[0];
}

async function setPayoutPin({ client, brand, pinHash }) {
  await exec(client)(
    `UPDATE shared.hr_settings
        SET payout_pin_hash = $2, payout_pin_set_at = now()
      WHERE business = $1`,
    [brand, pinHash],
  );
}

// ── leave_requests ─────────────────────────────────────────
async function listLeave({ client, brand, filters = {} }) {
  const where = [VISIBLE];
  const params = [brand];
  let i = 2;
  if (filters.status) {
    where.push(`lr.status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.profile_id) {
    where.push(`lr.profile_id = $${i++}`);
    params.push(filters.profile_id);
  }
  const { rows } = await exec(client)(
    `SELECT lr.*, c.display_name AS staff_name
       FROM shared.leave_requests lr
       JOIN shared.staff_profiles sp ON sp.profile_id = lr.profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE ${where.join(" AND ")}
      ORDER BY lr.created_at DESC
      LIMIT 200`,
    params,
  );
  return rows;
}

async function createLeave({ client, brand, profileId, input }) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.leave_requests
       (profile_id, leave_type, start_date, end_date, days_requested, reason)
     SELECT $2, $3, $4, $5, $6, $7
      WHERE EXISTS (SELECT 1 FROM shared.staff_profiles sp
                     WHERE sp.profile_id = $2 AND ${VISIBLE})
     RETURNING *`,
    [
      brand,
      profileId,
      input.leave_type,
      input.start_date,
      input.end_date,
      input.days_requested,
      input.reason || null,
    ],
  );
  return rows[0] || null;
}

async function findLeave({ client, brand, id }) {
  const { rows } = await exec(client)(
    `SELECT lr.* FROM shared.leave_requests lr
       JOIN shared.staff_profiles sp ON sp.profile_id = lr.profile_id
      WHERE lr.leave_id = $2 AND ${VISIBLE} LIMIT 1`,
    [brand, id],
  );
  return rows[0] || null;
}

async function setLeaveStatus({ client, brand, id, status, userId, reason }) {
  const { rows } = await exec(client)(
    `UPDATE shared.leave_requests lr
        SET status = $3,
            approved_by = $4,
            approved_at = CASE WHEN $3 = 'approved' THEN now() ELSE approved_at END,
            rejection_reason = CASE WHEN $3 = 'rejected' THEN $5 ELSE rejection_reason END
       FROM shared.staff_profiles sp
      WHERE lr.leave_id = $2 AND sp.profile_id = lr.profile_id AND ${VISIBLE}
      RETURNING lr.*`,
    [brand, id, status, userId, reason || null],
  );
  return rows[0] || null;
}

// ── hr_queries ─────────────────────────────────────────────
async function listQueries({ client, brand, filters = {} }) {
  const where = ["q.business = $1"];
  const params = [brand];
  let i = 2;
  if (filters.status) {
    where.push(`q.status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.profile_id) {
    where.push(`q.profile_id = $${i++}`);
    params.push(filters.profile_id);
  }
  if (filters.open) where.push(`q.status IN ('open','responded')`);
  const { rows } = await exec(client)(
    `SELECT q.*, c.display_name AS staff_name
       FROM shared.hr_queries q
       JOIN shared.staff_profiles sp ON sp.profile_id = q.profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE ${where.join(" AND ")}
      ORDER BY q.created_at DESC
      LIMIT 200`,
    params,
  );
  return rows;
}

async function findQuery({ client, brand, id }) {
  const { rows } = await exec(client)(
    `SELECT * FROM shared.hr_queries WHERE query_id = $2 AND business = $1 LIMIT 1`,
    [brand, id],
  );
  return rows[0] || null;
}

async function createQuery({ client, brand, input }) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.hr_queries
       (business, profile_id, query_type, severity, subject, details, source,
        attendance_day_id, deduction_pct, deduction_ngn, remind_after, raised_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      brand,
      input.profile_id,
      input.query_type || "other",
      input.severity || "normal",
      input.subject,
      input.details || null,
      input.source || "manual",
      input.attendance_day_id || null,
      input.deduction_pct ?? null,
      input.deduction_ngn ?? null,
      input.remind_after || null,
      input.raised_by || null,
    ],
  );
  return rows[0];
}

/**
 * Idempotent auto query (lateness OR offsite): one per attendance day
 * (uq_hr_queries_auto_day). The reconciler upserts the relevant type;
 * offsite takes precedence over lateness when both apply (it can discard the
 * whole day, making the lateness deduction moot).
 */
async function upsertAutoQuery({ client, brand, input }) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.hr_queries
       (business, profile_id, query_type, severity, subject, details, source,
        attendance_day_id, deduction_pct, deduction_ngn, remind_after)
     VALUES ($1,$2,$3,$4,$5,$6,'auto',$7,$8,$9,$10)
     ON CONFLICT (attendance_day_id) WHERE (source = 'auto' AND attendance_day_id IS NOT NULL)
     DO UPDATE SET query_type = EXCLUDED.query_type,
                   severity = EXCLUDED.severity,
                   deduction_pct = EXCLUDED.deduction_pct,
                   deduction_ngn = EXCLUDED.deduction_ngn,
                   subject = EXCLUDED.subject,
                   details = EXCLUDED.details,
                   remind_after = EXCLUDED.remind_after
     RETURNING *`,
    [
      brand,
      input.profile_id,
      input.query_type || "lateness",
      input.severity || "normal",
      input.subject,
      input.details || null,
      input.attendance_day_id,
      input.deduction_pct ?? null,
      input.deduction_ngn ?? null,
      input.remind_after || null,
    ],
  );
  return rows[0];
}

async function respondToQuery({ client, brand, id, profileId, response }) {
  const { rows } = await exec(client)(
    `UPDATE shared.hr_queries
        SET employee_response = $4, responded_at = now(),
            status = CASE WHEN status = 'open' THEN 'responded' ELSE status END
      WHERE query_id = $2 AND business = $1 AND profile_id = $3
        AND status IN ('open','responded')
      RETURNING *`,
    [brand, id, profileId, response],
  );
  return rows[0] || null;
}

async function resolveQuery({ client, brand, id, resolution, userId, note }) {
  const { rows } = await exec(client)(
    `UPDATE shared.hr_queries
        SET status = $3, resolution = $3, resolution_note = $5,
            resolved_by = $4, resolved_at = now()
      WHERE query_id = $2 AND business = $1
      RETURNING *`,
    [brand, id, resolution, userId, note || null],
  );
  return rows[0] || null;
}

// ── attendance_days ────────────────────────────────────────
async function upsertAttendanceDay({ client, brand, input }) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.attendance_days
       (business, profile_id, work_date, status, expected_start_time,
        first_clock_in_at, minutes_late, is_late, daily_rate_ngn,
        deduction_pct, deduction_ngn, clock_event_id, leave_id, reconciled_by,
        is_offsite, offsite_distance_m, clock_in_address, clock_in_lat, clock_in_lng)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (profile_id, work_date) DO UPDATE SET
        status = EXCLUDED.status,
        expected_start_time = EXCLUDED.expected_start_time,
        first_clock_in_at = EXCLUDED.first_clock_in_at,
        minutes_late = EXCLUDED.minutes_late,
        is_late = EXCLUDED.is_late,
        daily_rate_ngn = EXCLUDED.daily_rate_ngn,
        deduction_pct = EXCLUDED.deduction_pct,
        deduction_ngn = EXCLUDED.deduction_ngn,
        clock_event_id = EXCLUDED.clock_event_id,
        leave_id = EXCLUDED.leave_id,
        reconciled_at = now(),
        reconciled_by = EXCLUDED.reconciled_by,
        is_offsite = EXCLUDED.is_offsite,
        offsite_distance_m = EXCLUDED.offsite_distance_m,
        clock_in_address = EXCLUDED.clock_in_address,
        clock_in_lat = EXCLUDED.clock_in_lat,
        clock_in_lng = EXCLUDED.clock_in_lng
     RETURNING *`,
    [
      brand,
      input.profile_id,
      input.work_date,
      input.status,
      input.expected_start_time || null,
      input.first_clock_in_at || null,
      input.minutes_late || 0,
      input.is_late || false,
      input.daily_rate_ngn || 0,
      input.deduction_pct || 0,
      input.deduction_ngn || 0,
      input.clock_event_id || null,
      input.leave_id || null,
      input.reconciled_by || null,
      input.is_offsite || false,
      input.offsite_distance_m ?? null,
      input.clock_in_address || null,
      input.clock_in_lat ?? null,
      input.clock_in_lng ?? null,
    ],
  );
  return rows[0];
}

async function linkDayQuery({ client, dayId, queryId }) {
  await exec(client)(
    `UPDATE shared.attendance_days SET query_id = $2 WHERE day_id = $1`,
    [dayId, queryId],
  );
}

/** Mark a day justified (waived) and zero its deduction. */
async function justifyDay({ client, dayId }) {
  const { rows } = await exec(client)(
    `UPDATE shared.attendance_days
        SET justified = true, deduction_ngn = 0, deduction_pct = 0
      WHERE day_id = $1 RETURNING *`,
    [dayId],
  );
  return rows[0] || null;
}

async function listAttendanceDays({ client, brand, filters = {} }) {
  const where = ["ad.business = $1"];
  const params = [brand];
  let i = 2;
  if (filters.profile_id) {
    where.push(`ad.profile_id = $${i++}`);
    params.push(filters.profile_id);
  }
  if (filters.from) {
    where.push(`ad.work_date >= $${i++}`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push(`ad.work_date <= $${i++}`);
    params.push(filters.to);
  }
  if (filters.is_late) where.push(`ad.is_late = true`);
  const { rows } = await exec(client)(
    `SELECT ad.*, c.display_name AS staff_name
       FROM shared.attendance_days ad
       JOIN shared.staff_profiles sp ON sp.profile_id = ad.profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE ${where.join(" AND ")}
      ORDER BY ad.work_date DESC, c.display_name ASC
      LIMIT 500`,
    params,
  );
  return rows;
}

// ── staff_earnings_daily ───────────────────────────────────
async function upsertEarningsDay({ client, brand, input }) {
  await exec(client)(
    `INSERT INTO shared.staff_earnings_daily
       (business, profile_id, work_date, base_salary_ngn, daily_rate_ngn,
        earned_ngn, deduction_ngn, worked)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (profile_id, work_date) DO UPDATE SET
        base_salary_ngn = EXCLUDED.base_salary_ngn,
        daily_rate_ngn = EXCLUDED.daily_rate_ngn,
        earned_ngn = EXCLUDED.earned_ngn,
        deduction_ngn = EXCLUDED.deduction_ngn,
        worked = EXCLUDED.worked`,
    [
      brand,
      input.profile_id,
      input.work_date,
      input.base_salary_ngn || 0,
      input.daily_rate_ngn || 0,
      input.earned_ngn || 0,
      input.deduction_ngn || 0,
      input.worked || false,
    ],
  );
}

/** Month-to-date earned & deducted from the daily snapshot. */
async function earningsMonthToDate({ client, brand, profileId, year, month }) {
  const { rows } = await exec(client)(
    `SELECT COALESCE(SUM(earned_ngn),0)::numeric AS earned,
            COALESCE(SUM(deduction_ngn),0)::numeric AS deducted,
            COUNT(*) FILTER (WHERE worked)::int AS days_worked
       FROM shared.staff_earnings_daily
      WHERE business = $1 AND profile_id = $2
        AND date_part('year', work_date) = $3
        AND date_part('month', work_date) = $4`,
    [brand, profileId, year, month],
  );
  return rows[0];
}

// ── performance_targets ────────────────────────────────────
async function listTargets({ client, brand, filters = {} }) {
  const where = ["t.business = $1"];
  const params = [brand];
  let i = 2;
  if (filters.profile_id) {
    where.push(`t.profile_id = $${i++}`);
    params.push(filters.profile_id);
  }
  if (filters.status) {
    where.push(`t.status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.period_year) {
    where.push(`t.period_year = $${i++}`);
    params.push(filters.period_year);
  }
  if (filters.period_month) {
    where.push(`t.period_month = $${i++}`);
    params.push(filters.period_month);
  }
  const { rows } = await exec(client)(
    `SELECT t.*, c.display_name AS staff_name
       FROM shared.performance_targets t
       JOIN shared.staff_profiles sp ON sp.profile_id = t.profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE ${where.join(" AND ")}
      ORDER BY t.period_year DESC, t.period_month DESC, c.display_name ASC
      LIMIT 500`,
    params,
  );
  return rows;
}

async function findTarget({ client, brand, id }) {
  const { rows } = await exec(client)(
    `SELECT * FROM shared.performance_targets WHERE target_id = $2 AND business = $1 LIMIT 1`,
    [brand, id],
  );
  return rows[0] || null;
}

async function createTarget({ client, brand, input }) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.performance_targets
       (business, profile_id, user_id, period_month, period_year, metric,
        metric_label, target_value, source, reward_type, reward_value,
        reward_note, bonus_rule_id, set_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (profile_id, period_year, period_month, metric) DO UPDATE SET
        metric_label = EXCLUDED.metric_label,
        target_value = EXCLUDED.target_value,
        source = EXCLUDED.source,
        reward_type = EXCLUDED.reward_type,
        reward_value = EXCLUDED.reward_value,
        reward_note = EXCLUDED.reward_note,
        bonus_rule_id = EXCLUDED.bonus_rule_id,
        status = 'active'
     RETURNING *`,
    [
      brand,
      input.profile_id,
      input.user_id || null,
      input.period_month,
      input.period_year,
      input.metric || "custom",
      input.metric_label,
      input.target_value,
      input.source || "manual",
      input.reward_type || "pct_salary",
      input.reward_value || 0,
      input.reward_note || null,
      input.bonus_rule_id || null,
      input.set_by || null,
    ],
  );
  return rows[0];
}

async function updateTargetProgress({ client, brand, id, currentValue }) {
  const { rows } = await exec(client)(
    `UPDATE shared.performance_targets
        SET current_value = $3,
            last_progress_at = now(),
            status = CASE WHEN $3 >= target_value AND status = 'active' THEN 'achieved' ELSE status END,
            achieved_at = CASE WHEN $3 >= target_value AND achieved_at IS NULL THEN now() ELSE achieved_at END
      WHERE target_id = $2 AND business = $1
      RETURNING *`,
    [brand, id, currentValue],
  );
  return rows[0] || null;
}

async function deleteTarget({ client, brand, id }) {
  await exec(client)(
    `DELETE FROM shared.performance_targets WHERE target_id = $2 AND business = $1`,
    [brand, id],
  );
}

/** profile_id for a user, visible to the brand (auto target-progress wiring). */
async function profileIdForUser({ client, brand, userId }) {
  const { rows } = await exec(client)(
    `SELECT sp.profile_id
       FROM shared.users u
       JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
      WHERE u.user_id = $2 AND ${VISIBLE} AND sp.is_deleted = false
      LIMIT 1`,
    [brand, userId],
  );
  return rows[0] ? rows[0].profile_id : null;
}

/**
 * Increment the active monthly target for (profile, metric) by delta. Flips to
 * 'achieved' on crossing the goal. RETURNING includes prev_value (current minus
 * the just-applied delta) so the caller can detect the achieve transition.
 */
async function incrementActiveTarget({ client, brand, profileId, metric, delta, year, month }) {
  const { rows } = await exec(client)(
    `UPDATE shared.performance_targets
        SET current_value = current_value + $4,
            last_progress_at = now(),
            status = CASE WHEN current_value + $4 >= target_value AND status = 'active'
                          THEN 'achieved' ELSE status END,
            achieved_at = CASE WHEN current_value + $4 >= target_value AND achieved_at IS NULL
                               THEN now() ELSE achieved_at END
      WHERE business = $1 AND profile_id = $2 AND metric = $3
        AND period_year = $5 AND period_month = $6
        AND status IN ('active','achieved')
      RETURNING *, (current_value - $4) AS prev_value`,
    [brand, profileId, metric, delta, year, month],
  );
  return rows[0] || null;
}

// ── reconcile inputs (clock-ins + approved leave for a date) ──
/** First accepted clock-in per profile on a date, for all brand staff. */
async function firstClockInsForDate({ client, profileIds, dateStr }) {
  if (!profileIds.length) return {};
  const { rows } = await exec(client)(
    `SELECT DISTINCT ON (profile_id) profile_id, event_id, occurred_at,
            is_offsite, distance_m, formatted_address, latitude, longitude
       FROM shared.staff_clock_events
      WHERE profile_id = ANY($1::uuid[])
        AND event_type = 'clock_in' AND accepted = true
        AND occurred_at::date = $2::date
      ORDER BY profile_id, occurred_at ASC`,
    [profileIds, dateStr],
  );
  const map = {};
  for (const r of rows) map[r.profile_id] = r;
  return map;
}

/** Today's clock events for one profile, newest first (My HR clock widget). */
async function todayClockEvents({ client, profileId }) {
  const { rows } = await exec(client)(
    `SELECT event_id, event_type, occurred_at, accepted, is_offsite,
            distance_m, formatted_address, rejection_reason
       FROM shared.staff_clock_events
      WHERE profile_id = $1 AND occurred_at::date = CURRENT_DATE
      ORDER BY occurred_at DESC`,
    [profileId],
  );
  return rows;
}

/** Discard a day's presence: mark absent and zero its pay (offsite upheld). */
async function markDayAbsent({ client, dayId }) {
  const { rows } = await exec(client)(
    `UPDATE shared.attendance_days
        SET status = 'absent', deduction_ngn = 0, deduction_pct = 0
      WHERE day_id = $1 RETURNING *`,
    [dayId],
  );
  return rows[0] || null;
}

/** Open offsite queries whose response deadline has passed (lapse → absent). */
async function lapsedOffsiteQueries({ client, brand }) {
  const { rows } = await exec(client)(
    `SELECT * FROM shared.hr_queries
      WHERE business = $1 AND query_type = 'offsite_clockin'
        AND status = 'open' AND remind_after IS NOT NULL
        AND remind_after < CURRENT_DATE`,
    [brand],
  );
  return rows;
}

/** Open queries due for a reminder today (deadline reached, not reminded today). */
async function dueReminderQueries({ client, brand }) {
  const { rows } = await exec(client)(
    `SELECT * FROM shared.hr_queries
      WHERE business = $1 AND status = 'open'
        AND remind_after IS NOT NULL AND remind_after <= CURRENT_DATE
        AND (last_reminded_at IS NULL OR last_reminded_at::date < CURRENT_DATE)
      ORDER BY remind_after ASC
      LIMIT 500`,
    [brand],
  );
  return rows;
}

/** Stamp a reminder onto a query (count + timestamp). */
async function bumpReminder({ client, id }) {
  await exec(client)(
    `UPDATE shared.hr_queries
        SET reminder_count = reminder_count + 1, last_reminded_at = now()
      WHERE query_id = $1`,
    [id],
  );
}

/** profile_id → leave_id for any approved leave covering the date. */
async function approvedLeaveForDate({ client, profileIds, dateStr }) {
  if (!profileIds.length) return {};
  const { rows } = await exec(client)(
    `SELECT DISTINCT ON (profile_id) profile_id, leave_id
       FROM shared.leave_requests
      WHERE profile_id = ANY($1::uuid[]) AND status = 'approved'
        AND $2::date BETWEEN start_date AND end_date
      ORDER BY profile_id, start_date DESC`,
    [profileIds, dateStr],
  );
  const map = {};
  for (const r of rows) map[r.profile_id] = r.leave_id;
  return map;
}

// ── overview counts (HR & Staff) ───────────────────────────
async function overviewCounts({ client, brand }) {
  const run = exec(client);
  const { rows } = await run(
    `SELECT
       (SELECT count(*) FROM shared.staff_profiles sp
         WHERE ${VISIBLE} AND sp.is_deleted = false
           AND (sp.end_date IS NULL OR sp.end_date >= CURRENT_DATE))::int AS total_staff,
       (SELECT count(*) FROM shared.attendance_days ad
         WHERE ad.business = $1 AND ad.work_date = CURRENT_DATE
           AND ad.status IN ('present','late'))::int AS present_today,
       (SELECT count(*) FROM shared.attendance_days ad
         WHERE ad.business = $1 AND ad.work_date = CURRENT_DATE
           AND ad.status = 'late')::int AS late_today,
       (SELECT count(*) FROM shared.attendance_days ad
         WHERE ad.business = $1 AND ad.work_date = CURRENT_DATE
           AND ad.status = 'on_leave')::int AS on_leave_today,
       (SELECT count(*) FROM shared.leave_requests lr
          JOIN shared.staff_profiles sp ON sp.profile_id = lr.profile_id
         WHERE ${VISIBLE} AND lr.status = 'pending')::int AS pending_leave,
       (SELECT count(*) FROM shared.hr_queries q
         WHERE q.business = $1 AND q.status IN ('open','responded'))::int AS open_queries`,
    [brand],
  );
  return rows[0];
}

// ── tasks & contracts (My HR widgets) ──────────────────────
async function tasksForUser({ client, brand, userId }) {
  const { rows } = await exec(client)(
    `SELECT task_id, title, status, priority, due_at, reference_type
       FROM shared.tasks
      WHERE business = $1 AND assigned_to = $2 AND is_deleted = false
        AND status <> 'cancelled'
      ORDER BY (status = 'done') ASC, due_at ASC NULLS LAST
      LIMIT 25`,
    [brand, userId],
  );
  return rows;
}

async function contractsForProfile({ client, profileId }) {
  const { rows } = await exec(client)(
    `SELECT contract_id, contract_type, effective_from, effective_to,
            gross_salary, document_id
       FROM shared.staff_contracts
      WHERE profile_id = $1
      ORDER BY effective_from DESC`,
    [profileId],
  );
  return rows;
}

module.exports = {
  analytics,
  profileForUser,
  profileById,
  activeStaff,
  getSettings,
  updateSettings,
  setPayoutPin,
  listLeave,
  createLeave,
  findLeave,
  setLeaveStatus,
  listQueries,
  findQuery,
  createQuery,
  upsertAutoQuery,
  respondToQuery,
  resolveQuery,
  upsertAttendanceDay,
  linkDayQuery,
  justifyDay,
  listAttendanceDays,
  upsertEarningsDay,
  earningsMonthToDate,
  listTargets,
  findTarget,
  createTarget,
  updateTargetProgress,
  incrementActiveTarget,
  profileIdForUser,
  deleteTarget,
  overviewCounts,
  firstClockInsForDate,
  approvedLeaveForDate,
  todayClockEvents,
  markDayAbsent,
  lapsedOffsiteQueries,
  dueReminderQueries,
  bumpReminder,
  tasksForUser,
  contractsForProfile,
};
