/**
 * HR operations service (HR Phase 1).
 *
 * Business logic for the meeting's HR design (docs notes §3):
 *  - Self-service "My HR" dashboard: live earnings tracker, lateness, schedule,
 *    leave, monthly target countdown, tasks, contracts (answer #1, #13).
 *  - HR & Staff overview + leave inbox + queries + attendance reconcile.
 *  - The lateness → query → waive/uphold loop (answer #3): reconcile flags a
 *    late day, auto-raises a query, and the deduction shows on the running
 *    salary until HR waives it (restored) or upholds it (deducts from net).
 *  - Monthly performance targets the boss sets, with progress auto-counted by
 *    Sales / the future Operations module (answer #4, #5, #6).
 *  - HR Settings: lateness tiers, working days, CEO payout PIN (answer #2, #8).
 *
 * Transactions, audit and events live here; SQL lives in hr_ops.repo.
 */

"use strict";

const argon2 = require("argon2");
const repo = require("./hr_ops.repo");
const payrollRepo = require("./payroll.repo");
const appraisalRepo = require("./appraisal.repo");
const rewardsRepo = require("./rewards.repo");
const hrService = require("./hr.service");
const attendanceRepo = require("../attendance/attendance.repo");
const devicesRepo = require("./devices.repo");
const calc = require("./lateness.calc");
const geo = require("../attendance/geo.calc");
const { evaluateClockTransition } = require("./clock.guard");
const { evaluateDeviceRecognition } = require("./device.guard");
const events = require("./hr.events");
const { reverseGeocode } = require("../../services/geoapify.service");
const notifications = require("../../services/notifications.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, ConflictError, ValidationError } =
  require("../../utils/errors");
// Day boundaries + lateness math are pinned to Africa/Lagos (both businesses
// operate there); UTC would shift the working day by an hour.
const { LAGOS_UTC_OFFSET_MIN, todayStr, ym, addDays } = require("./lagos-time");

/** Is `dateStr` within the employee's employment window? */
function isEmployedOn(dateStr, startDate, endDate) {
  if (startDate && dateStr < String(startDate).slice(0, 10)) return false;
  if (endDate && dateStr > String(endDate).slice(0, 10)) return false;
  return true;
}

// ── HR Settings ────────────────────────────────────────────
async function getSettings({ brand }) {
  const s = await repo.getSettings({ brand });
  // Never leak the PIN hash; expose only whether one is set.
  const { payout_pin_hash, ...safe } = s;
  return { ...safe, payout_pin_set: Boolean(payout_pin_hash) };
}

async function updateSettings({ brand, user, request_id, patch }) {
  return transaction(async (client) => {
    const before = await repo.getSettings({ client, brand });
    const updated = await repo.updateSettings({ client, brand, patch });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.update_settings",
      target_type: "hr_settings",
      target_id: brand,
      before: { ...before, payout_pin_hash: undefined },
      after: { ...updated, payout_pin_hash: undefined },
      request_id,
      is_sensitive: true,
    });
    const { payout_pin_hash, ...safe } = updated;
    return { ...safe, payout_pin_set: Boolean(payout_pin_hash) };
  });
}

async function setPayoutPin({ brand, user, request_id, pin }) {
  if (!/^\d{4,8}$/.test(String(pin || ""))) {
    throw new ValidationError("Payout PIN must be 4–8 digits");
  }
  const pinHash = await argon2.hash(String(pin));
  await transaction(async (client) => {
    await repo.setPayoutPin({ client, brand, pinHash });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.set_payout_pin",
      target_type: "hr_settings",
      target_id: brand,
      request_id,
      is_sensitive: true,
    });
  });
  return { payout_pin_set: true };
}

/** Verify the brand payout PIN (used by the Phase-2 payroll "Pay" step). */
async function verifyPayoutPin({ brand, pin }) {
  const s = await repo.getSettings({ brand });
  if (!s.payout_pin_hash) return false;
  try {
    return await argon2.verify(s.payout_pin_hash, String(pin));
  } catch {
    return false;
  }
}

// ── Leave ──────────────────────────────────────────────────
async function listLeave({ brand, filters }) {
  return { data: await repo.listLeave({ brand, filters }) };
}

async function requestLeave({ brand, user, input }) {
  return transaction(async (client) => {
    // A staff member files for themselves unless HR passes an explicit profile.
    let profileId = input.profile_id;
    if (!profileId) {
      const me = await repo.profileForUser({ client, brand, userId: user.user_id });
      if (!me) throw new NotFoundError("Staff profile");
      profileId = me.profile_id;
    }
    const leave = await repo.createLeave({ client, brand, profileId, input });
    if (!leave) throw new NotFoundError("Staff profile");
    events.emit("leave_requested", { brand, leave_id: leave.leave_id });
    return leave;
  });
}

async function decideLeave({ brand, user, request_id, id, status, reason }) {
  return transaction(async (client) => {
    const before = await repo.findLeave({ client, brand, id });
    if (!before) throw new NotFoundError("Leave request");
    if (before.status !== "pending") {
      throw new ConflictError("Leave request already decided");
    }
    // Escalation (answer #11): long leave can only be APPROVED by the CEO.
    if (status === "approved") {
      const settings = await repo.getSettings({ client, brand });
      const threshold = Number(settings.leave_escalation_days || 0);
      if (
        threshold > 0 &&
        Number(before.days_requested) >= threshold &&
        !(user && user.is_ceo)
      ) {
        throw new ConflictError(
          `Leave of ${threshold}+ days needs CEO approval.`,
        );
      }
    }
    const updated = await repo.setLeaveStatus({
      client, brand, id, status, userId: user.user_id, reason,
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: `hr_payroll.${status === "approved" ? "approve" : "reject"}_leave`,
      target_type: "leave_requests",
      target_id: id,
      before,
      after: updated,
      request_id,
    });
    // Approved leave shows on the shared Calendar (§6.11 module wiring / audit
    // M8). Best-effort — a calendar hiccup must not fail the approval.
    if (status === "approved" && updated && updated.start_date && updated.end_date) {
      try {
        const calendar = require("../calendar/calendar.service");
        const who = updated.staff_name || "Staff";
        await calendar.createForReference({
          brand,
          title: `${who} — ${updated.leave_type} leave`,
          event_type: "leave",
          start_at: `${String(updated.start_date).slice(0, 10)}T00:00:00Z`,
          end_at: `${String(updated.end_date).slice(0, 10)}T23:59:59Z`,
          reference_type: "leave_request",
          reference_id: id,
          created_by: user.user_id,
        });
      } catch (err) {
        require("../../config/logger").logger.warn(
          { err: err.message, leave_id: id },
          "leave→calendar sync failed (approval stands)",
        );
      }
    }
    events.emit("leave_decided", { brand, leave_id: id, status });
    return updated;
  });
}

// ── Queries (lateness & conduct) ───────────────────────────
async function listQueries({ brand, filters }) {
  return { data: await repo.listQueries({ brand, filters }) };
}

async function raiseQuery({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const created = await repo.createQuery({
      client, brand,
      input: { ...input, source: "manual", raised_by: user.user_id },
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.raise_query",
      target_type: "hr_queries",
      target_id: created.query_id,
      after: created,
      request_id,
    });
    events.emit("query_raised", { brand, query_id: created.query_id });
    return created;
  });
}

/** The employee answers a query (My HR). Resolves only against their profile. */
async function respondToQuery({ brand, user, id, response }) {
  return transaction(async (client) => {
    const me = await repo.profileForUser({ client, brand, userId: user.user_id });
    if (!me) throw new NotFoundError("Staff profile");
    const updated = await repo.respondToQuery({
      client, brand, id, profileId: me.profile_id, response,
    });
    if (!updated) throw new NotFoundError("Query");
    events.emit("query_responded", { brand, query_id: id });
    return updated;
  });
}

/**
 * HR resolves a query. 'waived' restores the day's pay (justifies the linked
 * attendance day and zeroes the deduction); 'upheld' leaves the deduction so
 * it rolls into net pay (answer #3).
 */
async function resolveQuery({ brand, user, request_id, id, resolution, note }) {
  if (!["waived", "upheld"].includes(resolution)) {
    throw new ValidationError("resolution must be 'waived' or 'upheld'");
  }
  return transaction(async (client) => {
    const before = await repo.findQuery({ client, brand, id });
    if (!before) throw new NotFoundError("Query");
    const updated = await repo.resolveQuery({
      client, brand, id, resolution, userId: user.user_id, note,
    });
    if (before.attendance_day_id) {
      const isOffsite = before.query_type === "offsite_clockin";
      if (resolution === "waived") {
        // Restore the day: clear the lateness deduction / accept the off-site
        // explanation. Presence stands and earns the full day.
        const day = await repo.justifyDay({ client, dayId: before.attendance_day_id });
        if (day) {
          await repo.upsertEarningsDay({
            client, brand,
            input: {
              profile_id: day.profile_id,
              work_date: day.work_date,
              base_salary_ngn: 0,
              daily_rate_ngn: day.daily_rate_ngn,
              earned_ngn: day.daily_rate_ngn,
              deduction_ngn: 0,
              worked: ["present", "late"].includes(day.status),
            },
          });
        }
      } else if (resolution === "upheld" && isOffsite) {
        // Off-site clock-in upheld → discard presence for that day (absent),
        // per the meeting rule (answer / brainstorm). Pay for the day is lost.
        const day = await repo.markDayAbsent({ client, dayId: before.attendance_day_id });
        if (day) {
          await repo.upsertEarningsDay({
            client, brand,
            input: {
              profile_id: day.profile_id,
              work_date: day.work_date,
              base_salary_ngn: 0,
              daily_rate_ngn: day.daily_rate_ngn,
              earned_ngn: 0,
              deduction_ngn: day.daily_rate_ngn,
              worked: false,
            },
          });
        }
      }
    }
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: `hr_payroll.${resolution}_query`,
      target_type: "hr_queries",
      target_id: id,
      before,
      after: updated,
      request_id,
      is_sensitive: true, // money impact
    });
    events.emit("query_resolved", { brand, query_id: id, resolution });
    return updated;
  });
}

// ── Performance targets ────────────────────────────────────
async function listTargets({ brand, filters }) {
  const data = await repo.listTargets({ brand, filters });
  // Attach the live countdown for each target.
  return {
    data: data.map((t) => ({
      ...t,
      remaining: Math.max(0, Number(t.target_value) - Number(t.current_value)),
      progress_pct: Number(t.target_value) > 0
        ? Math.min(100, Math.round((Number(t.current_value) / Number(t.target_value)) * 100))
        : 0,
    })),
  };
}

async function setTarget({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const created = await repo.createTarget({
      client, brand, input: { ...input, set_by: user.user_id },
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.set_target",
      target_type: "performance_targets",
      target_id: created.target_id,
      after: created,
      request_id,
    });
    events.emit("target_set", { brand, target_id: created.target_id });
    return created;
  });
}

/**
 * Update a target's progress count. Called manually by HR, or by the Sales
 * module and the future Operations module (answer #5/#6) as work completes.
 *
 * OPERATIONS WIRING SEAM: when the Operations module is built, it should call
 * this with source-counted values for stylist styling/service completions and
 * quality ratings (meeting §3.3/§3.6). Sales already owns sales_count /
 * sales_revenue progress. Keep this the single entry point so both modules
 * converge on one countdown.
 */
async function updateTargetProgress({ brand, user, request_id, id, current_value }) {
  const before = await repo.findTarget({ brand, id });
  if (!before) throw new NotFoundError("Target");
  const updated = await repo.updateTargetProgress({
    brand, id, currentValue: current_value,
  });
  if (!updated) throw new NotFoundError("Target");
  if (user) {
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.update_target_progress",
      target_type: "performance_targets",
      target_id: id,
      after: { current_value, status: updated.status },
      request_id,
    });
  }
  events.emit("target_progress", { brand, target_id: id, status: updated.status });
  // Distinct transition event (active → achieved), so the bonus subscriber
  // awards exactly once even though progress updates fire repeatedly.
  if (before.status === "active" && updated.status === "achieved") {
    events.emit("target_achieved", { brand, target_id: id });
  }
  return updated;
}

/**
 * Increment a staff member's active monthly target for a metric (auto
 * progress from Sales / Service Jobs). Resolves the user's profile, bumps the
 * matching target, and emits `target_achieved` exactly once on crossing the
 * goal (which the bonus subscriber turns into a pending bonus). Defensive: no
 * profile or no matching target → silent no-op.
 */
async function bumpTargetProgress({ brand, userId, metric, delta }) {
  if (!userId || !(delta > 0)) return null;
  const { year, month } = ym();
  const profileId = await repo.profileIdForUser({ brand, userId });
  if (!profileId) return null;
  const row = await repo.incrementActiveTarget({
    brand, profileId, metric, delta, year, month,
  });
  if (!row) return null;
  events.emit("target_progress", { brand, target_id: row.target_id, status: row.status });
  if (
    Number(row.prev_value) < Number(row.target_value) &&
    Number(row.current_value) >= Number(row.target_value)
  ) {
    events.emit("target_achieved", { brand, target_id: row.target_id });
  }
  return row;
}

/**
 * Quality-gated recompute of a staffer's service-job targets for a period.
 * Sets `styles_completed` / `services_completed` to an absolute count (of jobs
 * that passed the quality gate), so re-firing on completion or a later QC
 * rating is idempotent and only quality-passing work counts. Emits
 * target_achieved on a fresh crossing.
 */
async function recomputeServiceTargets({ brand, userId, year, month, count }) {
  if (!userId) return;
  const profileId = await repo.profileIdForUser({ brand, userId });
  if (!profileId) return;
  for (const metric of ["styles_completed", "services_completed"]) {
    const row = await repo.setActiveTargetValue({
      brand, profileId, metric, value: count, year, month,
    });
    if (!row) continue;
    events.emit("target_progress", { brand, target_id: row.target_id, status: row.status });
    if (
      Number(row.prev_value) < Number(row.target_value) &&
      Number(row.current_value) >= Number(row.target_value)
    ) {
      events.emit("target_achieved", { brand, target_id: row.target_id });
    }
  }
}

async function removeTarget({ brand, user, request_id, id }) {
  await transaction(async (client) => {
    const before = await repo.findTarget({ client, brand, id });
    if (!before) throw new NotFoundError("Target");
    await repo.deleteTarget({ client, brand, id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.delete_target",
      target_type: "performance_targets",
      target_id: id,
      before,
      request_id,
    });
  });
}

// ── Attendance reconcile (lateness engine) ─────────────────
/**
 * Reconcile one day for the brand: turn raw clock events into reconciled
 * attendance_days + a daily earnings snapshot, and auto-raise a lateness
 * query (with the at-stake deduction) for every late day (answer #3).
 *
 * Only profiles whose PRIMARY brand is this brand are reconciled — payroll
 * and attendance belong to the brand that owns the books (answer #12).
 */
async function reconcileDay({ brand, user, date }) {
  const dateStr = date || todayStr();
  const { year, month } = ym(dateStr);
  return transaction(async (client) => {
    const settings = await repo.getSettings({ client, brand });
    const allStaff = await repo.activeStaff({ client, brand });
    const staff = allStaff.filter((s) => s.business === brand); // payroll owner only
    const profileIds = staff.map((s) => s.profile_id);
    const workingDaysCount = calc.workingDaysInMonth(year, month, settings.working_days);

    const clockIns = await repo.firstClockInsForDate({ client, profileIds, dateStr });
    const clockOuts = await repo.lastClockOutsForDate({ client, profileIds, dateStr });
    const leaves = await repo.approvedLeaveForDate({ client, profileIds, dateStr });

    let records = 0;
    let lateCount = 0;
    let offsiteCount = 0;
    for (const s of staff) {
      // A day outside the employment window is treated as a non-working day so
      // it never becomes a spurious absence (payroll pro-rates the base for
      // joiners/leavers instead — §3.5).
      const employed = isEmployedOn(dateStr, s.start_date, s.end_date);
      const wdRaw = calc.resolveWorkingDay({
        dateStr,
        workSchedule: s.work_schedule,
        brandWorkingDays: settings.working_days,
      });
      const wd = employed ? wdRaw : { working: false, mode: "off" };
      const expectedStart = s.work_expected_start_time || settings.default_expected_start_time;
      const expectedEnd = s.work_expected_end_time || settings.default_expected_end_time;
      const grace = s.work_grace_minutes !== null && s.work_grace_minutes !== undefined
        ? s.work_grace_minutes
        : settings.default_grace_minutes;
      const clock = clockIns[s.profile_id];
      const clockOut = clockOuts[s.profile_id];
      const leave = leaves[s.profile_id];

      const r = calc.reconcileDay({
        dateStr,
        baseSalaryNgn: Number(s.base_salary || 0),
        workingDaysCount,
        expectedStart,
        graceMinutes: grace,
        firstClockInAt: clock ? clock.occurred_at : null,
        isOnLeave: Boolean(leave),
        isUnpaidLeave: Boolean(leave && leave.is_unpaid),
        isWorkingDay: wd.working,
        tiers: settings.lateness_enabled ? settings.lateness_tiers : [],
        tzOffsetMinutes: LAGOS_UTC_OFFSET_MIN,
      });

      // Off-site only matters on an on-site working day with a real clock-in
      // and geofencing enabled.
      const offsite =
        settings.geofence_enabled &&
        wd.working &&
        wd.mode === "on_site" &&
        clock &&
        clock.is_offsite === true;

      // Same gating for the clock-out point (captured on every punch now).
      const clockOutOffsite =
        settings.geofence_enabled &&
        wd.working &&
        wd.mode === "on_site" &&
        clockOut &&
        clockOut.is_offsite === true;

      // Early departure / last-out (audit H3): only meaningful on a worked day.
      const earlyLeaveMinutes =
        wd.working && clockOut
          ? calc.minutesEarly({
              expectedEnd,
              lastClockOutAt: clockOut.occurred_at,
              dateStr,
              tzOffsetMinutes: LAGOS_UTC_OFFSET_MIN,
            })
          : 0;

      // Supplementary hours: time worked PAST the expected close (mirror of
      // early-leave on the "stayed late" side). Tracking figure only — it does
      // not feed payroll (overtime is still a manual payslip line).
      const overtimeMinutes =
        wd.working && clockOut
          ? calc.minutesOvertime({
              expectedEnd,
              lastClockOutAt: clockOut.occurred_at,
              dateStr,
              tzOffsetMinutes: LAGOS_UTC_OFFSET_MIN,
            })
          : 0;

      const day = await repo.upsertAttendanceDay({
        client, brand,
        input: {
          profile_id: s.profile_id,
          work_date: dateStr,
          status: r.status,
          expected_start_time: expectedStart,
          first_clock_in_at: clock ? clock.occurred_at : null,
          minutes_late: r.minutes_late,
          is_late: r.status === "late",
          daily_rate_ngn: r.daily_rate_ngn,
          deduction_pct: r.deduction_pct,
          deduction_ngn: r.deduction_ngn,
          clock_event_id: clock ? clock.event_id : null,
          leave_id: leave ? leave.leave_id : null,
          reconciled_by: user ? user.user_id : null,
          is_offsite: Boolean(offsite),
          offsite_distance_m: clock ? clock.distance_m : null,
          clock_in_address: clock ? clock.formatted_address : null,
          clock_in_lat: clock ? clock.latitude : null,
          clock_in_lng: clock ? clock.longitude : null,
          last_clock_out_at: clockOut ? clockOut.occurred_at : null,
          early_leave_minutes: earlyLeaveMinutes,
          overtime_minutes: overtimeMinutes,
          clock_out_address: clockOut ? clockOut.formatted_address : null,
          clock_out_lat: clockOut ? clockOut.latitude : null,
          clock_out_lng: clockOut ? clockOut.longitude : null,
          clock_out_is_offsite: Boolean(clockOutOffsite),
          clock_out_distance_m: clockOut ? clockOut.distance_m : null,
          clock_in_ip: clock ? clock.ip_address : null,
          clock_out_ip: clockOut ? clockOut.ip_address : null,
          clock_in_device_recognized: clock ? clock.device_recognized : null,
        },
      });

      await repo.upsertEarningsDay({
        client, brand,
        input: {
          profile_id: s.profile_id,
          work_date: dateStr,
          base_salary_ngn: Number(s.base_salary || 0),
          daily_rate_ngn: r.daily_rate_ngn,
          earned_ngn: r.earned_ngn,
          deduction_ngn: day.justified ? 0 : r.deduction_ngn,
          worked: r.worked,
        },
      });

      // One auto-query per day. Off-site takes precedence (it can discard the
      // whole day), otherwise lateness.
      if (offsite && settings.offsite_auto_query && !day.justified) {
        const dist =
          clock.distance_m !== null && clock.distance_m !== undefined
            ? `${Math.round(clock.distance_m)} m from office`
            : "off-site";
        const q = await repo.upsertAutoQuery({
          client, brand,
          input: {
            profile_id: s.profile_id,
            query_type: "offsite_clockin",
            severity: "high",
            subject: `Off-site clock-in on ${dateStr}`,
            details:
              `You clocked in ${dist} on ${dateStr}, an on-site working day` +
              (clock.formatted_address ? ` (${clock.formatted_address})` : "") +
              `. Please explain. If this isn't resolved, the day may be marked absent.`,
            attendance_day_id: day.day_id,
            remind_after: addDays(dateStr, settings.lateness_query_reminder_days),
          },
        });
        await repo.linkDayQuery({ client, dayId: day.day_id, queryId: q.query_id });
        offsiteCount++;
      } else if (
        r.status === "late" &&
        settings.lateness_enabled &&
        settings.lateness_auto_query &&
        !day.justified
      ) {
        const q = await repo.upsertAutoQuery({
          client, brand,
          input: {
            profile_id: s.profile_id,
            query_type: "lateness",
            severity: r.deduction_pct >= 20 ? "high" : "normal",
            subject: `Lateness on ${dateStr} — ${r.minutes_late} min late`,
            details:
              `You clocked in ${r.minutes_late} minutes late on ${dateStr}. ` +
              `A ${r.deduction_pct}% deduction (₦${r.deduction_ngn}) applies to that ` +
              `day unless waived. Please explain.`,
            attendance_day_id: day.day_id,
            deduction_pct: r.deduction_pct,
            deduction_ngn: r.deduction_ngn,
            remind_after: addDays(dateStr, settings.lateness_query_reminder_days),
          },
        });
        await repo.linkDayQuery({ client, dayId: day.day_id, queryId: q.query_id });
        lateCount++;
      }
      records++;
    }

    events.emit("attendance_reconciled", { brand, date: dateStr, records });
    return {
      date: dateStr,
      records_created: records,
      late_count: lateCount,
      offsite_count: offsiteCount,
    };
  });
}

/**
 * Brand working days in [from, to] (never future) that have NO reconciled
 * attendance rows yet — the pre-review payroll guard (decision 2026-07-04:
 * block "Send for approval" until the period is reconciled, with a one-click
 * "reconcile all" and per-day deep links). Uses the brand working-day set as
 * the proxy for "a day attendance should exist".
 */
async function unreconciledWorkingDates({ brand, from, to }) {
  const settings = await repo.getSettings({ brand });
  const today = todayStr();
  const end = to > today ? today : to;
  if (!from || !end || from > end) return [];
  const done = await repo.reconciledDatesInRange({ brand, from, to: end });
  const workingSet = new Set((settings.working_days || []).map((d) => d.toLowerCase()));
  const out = [];
  for (let d = from; d <= end; d = addDays(d, 1)) {
    const key = calc.weekdayKey(d);
    if (workingSet.has(key) && !done.has(d)) out.push(d);
  }
  return out;
}

/** Reconcile every still-unreconciled working day in a period (guard fixer). */
async function reconcilePeriod({ brand, user, from, to }) {
  const dates = await unreconciledWorkingDates({ brand, from, to });
  let reconciled = 0;
  for (const date of dates) {
    await reconcileDay({ brand, user, date });
    reconciled++;
  }
  return { reconciled, dates };
}

/**
 * Apply the penalty for off-site queries the employee never answered before
 * the deadline: mark each linked day absent (discard presence + pay) and
 * uphold the query. HR-triggered (or a future cron). Mirrors the meeting's
 * "respond or be considered absent" rule, but only after the grace deadline.
 */
async function applyLapsedOffsite({ brand, user, request_id }) {
  return transaction(async (client) => {
    const lapsed = await repo.lapsedOffsiteQueries({ client, brand });
    let absent = 0;
    for (const q of lapsed) {
      await repo.resolveQuery({
        client, brand, id: q.query_id, resolution: "upheld",
        userId: user ? user.user_id : null,
        note: "Auto-upheld: off-site query not answered before deadline.",
      });
      if (q.attendance_day_id) {
        const day = await repo.markDayAbsent({ client, dayId: q.attendance_day_id });
        if (day) {
          await repo.upsertEarningsDay({
            client, brand,
            input: {
              profile_id: day.profile_id,
              work_date: day.work_date,
              base_salary_ngn: 0,
              daily_rate_ngn: day.daily_rate_ngn,
              earned_ngn: 0,
              deduction_ngn: day.daily_rate_ngn,
              worked: false,
            },
          });
        }
        absent++;
      }
    }
    if (user) {
      await audit({
        business: brand,
        user_id: user.user_id,
        action_key: "hr_payroll.apply_lapsed_offsite",
        target_type: "hr_queries",
        target_id: brand,
        after: { lapsed: lapsed.length, marked_absent: absent },
        request_id,
        is_sensitive: true,
      });
    }
    return { lapsed: lapsed.length, marked_absent: absent };
  });
}

/**
 * Bump reminders on open queries past their deadline (meeting §3.1: "reminds
 * after 2 days while showing the deductions"). Emits a per-query event the
 * notification layer can surface. Returns how many were reminded.
 */
async function bumpDueReminders({ brand }) {
  const due = await repo.dueReminderQueries({ brand });
  for (const q of due) {
    await repo.bumpReminder({ id: q.query_id });
    events.emit("query_reminder", {
      brand,
      query_id: q.query_id,
      profile_id: q.profile_id,
      query_type: q.query_type,
    });
  }
  return { reminded: due.length };
}

// ── Clock-out reminders (close-time nudges) ────────────────
// The three nudges, as Lagos-local minute offsets from each employee's
// closing time: 5 min before, at the time, 5 min after. GRACE is how many
// minutes past a target we still fire, so a skipped every-minute cron tick
// doesn't drop a nudge. Windows never overlap (min gap between targets is 5).
const CLOCKOUT_NUDGES = [
  { tag: "before", offset: -5 },
  { tag: "at", offset: 0 },
  { tag: "after", offset: 5 },
];
const CLOCKOUT_NUDGE_GRACE_MIN = 2;

/** Minutes-since-midnight for an 'HH:MM' / 'HH:MM:SS' string, or null. */
function parseHhMm(value) {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Build the in-app + push copy for one nudge kind. */
function clockoutNudgeCopy(tag, endLabel) {
  switch (tag) {
    case "before":
      return {
        priority: "normal",
        title: "Clock-out reminder",
        body: `Your day ends at ${endLabel} — 5 minutes to go. Remember to clock out so your hours are recorded correctly.`,
      };
    case "at":
      return {
        priority: "normal",
        title: "Time to clock out",
        body: `It's ${endLabel}, your closing time. Tap the clock in the top bar to clock out.`,
      };
    default: // "after"
      return {
        priority: "high",
        title: "You haven't clocked out",
        body: `It's past your ${endLabel} closing time and you're still clocked in. Clock out now — anything beyond this counts as supplementary hours.`,
      };
  }
}

/**
 * Send the close-time clock-out nudges for a brand (5 min before / at / 5 min
 * after each employee's expected closing time) to anyone still clocked in on a
 * working day. Runs every minute; each nudge is claimed via
 * shared.clockout_reminders so it fires AT MOST ONCE per employee/day/offset,
 * even across restarts or a second worker. Delivery is in-app + web push via
 * notify() (gated by the brand's clockout_reminder_enabled switch).
 */
async function sendClockoutReminders({ brand, now = new Date() }) {
  const settings = await repo.getSettings({ brand });
  if (!settings.clockout_reminder_enabled) return { sent: 0, candidates: 0 };

  const dateStr = todayStr(now);
  const nowMin = calc.localMinutesOfDay(now.toISOString(), LAGOS_UTC_OFFSET_MIN);
  const candidates = await repo.clockedInWithoutClockout({ brand, dateStr });

  let sent = 0;
  for (const s of candidates) {
    const wd = calc.resolveWorkingDay({
      dateStr,
      workSchedule: s.work_schedule,
      brandWorkingDays: settings.working_days,
    });
    if (!wd.working) continue;

    const expectedEnd = s.work_expected_end_time || settings.default_expected_end_time;
    const endMin = parseHhMm(expectedEnd);
    if (endMin === null) continue;
    const endLabel = String(expectedEnd).slice(0, 5); // HH:MM

    for (const nudge of CLOCKOUT_NUDGES) {
      const target = endMin + nudge.offset;
      if (nowMin < target || nowMin > target + CLOCKOUT_NUDGE_GRACE_MIN) continue;
      // The INSERT is the dedupe: only the first claim returns a row.
      const claim = await repo.claimClockoutReminder({
        brand,
        profileId: s.profile_id,
        workDate: dateStr,
        offsetTag: nudge.tag,
      });
      if (!claim) continue;
      const copy = clockoutNudgeCopy(nudge.tag, endLabel);
      await notifications.notify({
        user_id: s.user_id,
        business: brand,
        type: "clockout_reminder",
        priority: copy.priority,
        title: copy.title,
        body: copy.body,
        reference_type: "attendance",
        reference_id: s.profile_id,
        action_url: "/workspace?tab=my-hr",
      });
      sent++;
    }
  }
  return { sent, candidates: candidates.length };
}

// ── Self clock-in / today (My HR + top-bar widget) ─────────
/**
 * Resolve today's working mode for a staff profile from their schedule and
 * the brand working-days fallback.
 */
function todayMode(profile, settings) {
  return calc.resolveWorkingDay({
    dateStr: todayStr(),
    workSchedule: profile.work_schedule,
    brandWorkingDays: settings.working_days,
  });
}

/** Compact today status for the top-bar clock widget. */
async function getMyToday({ brand, user }) {
  const profile = await repo.profileForUser({ brand, userId: user.user_id });
  if (!profile) throw new NotFoundError("Staff profile");
  const settings = await repo.getSettings({ brand });
  const clockEvents = await repo.todayClockEvents({ profileId: profile.profile_id });
  const lastIn = clockEvents.find((e) => e.event_type === "clock_in" && e.accepted);
  const lastOut = clockEvents.find((e) => e.event_type === "clock_out" && e.accepted);
  const clockedIn = Boolean(lastIn) && (!lastOut || lastOut.occurred_at < lastIn.occurred_at);
  const mode = todayMode(profile, settings);
  return {
    profile_id: profile.profile_id,
    clocked_in: clockedIn,
    clocked_out: Boolean(lastOut) && !clockedIn,
    clocked_in_at: lastIn ? lastIn.occurred_at : null,
    is_offsite: lastIn ? lastIn.is_offsite : false,
    last_address: lastIn ? lastIn.formatted_address : null,
    expected_mode: mode.mode,
    expected_start_time: profile.work_expected_start_time || settings.default_expected_start_time,
    geofence_required:
      settings.geofence_enabled && settings.geofence_required_on_site && mode.mode === "on_site",
  };
}

/**
 * Self clock-in / clock-out from the top-bar widget. Records the coordinates
 * + IP as evidence; flags (does not reject) an off-site point. Location is
 * MANDATORY for both clock-in and clock-out — a punch without it is refused
 * (refusing on clock-in leaves no record, so reconcile marks the day absent).
 * Enforces one accepted clock-in + one clock-out per day (clock-out must
 * follow a clock-in), closing the double clock-in gap.
 *
 * The stored address label is derived server-side from the coordinates via
 * Geoapify (audit H7 — replaces the flaky client-side Google geocode). The
 * geocode runs BEFORE the DB transaction opens so a slow/failed lookup never
 * holds a connection and can never block clock-in (best-effort → may be null).
 * A client-supplied `address` still wins when present (offline fallback).
 */
async function selfClock({ brand, user, input, requestMeta = {} }) {
  const hasPointPre =
    input.latitude !== null && input.latitude !== undefined &&
    input.longitude !== null && input.longitude !== undefined;
  let addressLabel = input.address || null;
  if (!addressLabel && hasPointPre) {
    addressLabel = await reverseGeocode(input.latitude, input.longitude);
  }

  return transaction(async (client) => {
    const profile = await repo.profileForUser({ client, brand, userId: user.user_id });
    if (!profile) throw new NotFoundError("Staff profile");
    const settings = await repo.getSettings({ client, brand });
    const mode = todayMode(profile, settings);

    const hasPoint =
      input.latitude !== null && input.latitude !== undefined &&
      input.longitude !== null && input.longitude !== undefined;

    // Location is MANDATORY for BOTH clock-in and clock-out — a punch is never
    // recorded without it. Refusing location on a clock-in means no clock-in
    // exists, so reconcile marks the day absent (the meeting rule). The widget
    // shows the matching toast; this is the server-side hard gate.
    if (!hasPoint) {
      throw new ValidationError(
        input.event_type === "clock_out"
          ? "Confirm your location to clock out. Enable location access on your device and try again."
          : "Confirm your location to clock in. Enable location access on your device and try again — without it you can't clock in and the day will be marked absent.",
      );
    }

    // One accepted clock-in and one accepted clock-out per day, with clock-out
    // required to follow a clock-in (closes the double clock-in gap). The DB
    // partial unique index (000303) backstops the concurrent double-tap race.
    const todayEvents = await repo.todayClockEvents({
      client,
      profileId: profile.profile_id,
    });
    const transition = evaluateClockTransition({
      todayEvents,
      eventType: input.event_type,
    });
    if (!transition.allowed) {
      throw new ConflictError(transition.message);
    }

    // Device binding (000304): FLAG — never block — a punch from an
    // un-enrolled device. The CEO is exempt (recognized = null). An employee
    // who hasn't enrolled any device yet is neutral (null) so we don't
    // red-flag the whole rollout; once they have devices, a punch whose
    // fingerprint is outside that set is the buddy-punch signal (false).
    let deviceRecognized = null;
    let matchedDeviceId = null;
    if (!user.is_ceo) {
      const enrolledCount = await devicesRepo.countActive({
        client,
        profileId: profile.profile_id,
      });
      const match =
        enrolledCount > 0 && input.device_fingerprint
          ? await devicesRepo.findActiveByFingerprint({
              client,
              profileId: profile.profile_id,
              fingerprint: input.device_fingerprint,
            })
          : null;
      deviceRecognized = evaluateDeviceRecognition({
        isCeo: user.is_ceo,
        enrolledCount,
        hasMatch: Boolean(match),
      });
      matchedDeviceId = match ? match.device_id : null;
    }

    let decision = { is_offsite: false, matched_geofence_id: null, distance_m: null, reason: null };
    if (hasPoint && settings.geofence_enabled && mode.mode === "on_site") {
      const fences = await attendanceRepo.activeGeofences({ client, brand });
      decision = geo.flagOffsite({
        point: { latitude: input.latitude, longitude: input.longitude },
        accuracy_m: input.accuracy_m,
        geofences: fences,
        maxAccuracyM: settings.geofence_accuracy_max_m,
      });
    }

    let event;
    try {
      event = await attendanceRepo.insertClockEvent({
        client,
        data: {
          profile_id: profile.profile_id,
          event_type: input.event_type,
          latitude: hasPoint ? input.latitude : null,
          longitude: hasPoint ? input.longitude : null,
          accuracy_m: input.accuracy_m ?? null,
          device_fingerprint: input.device_fingerprint ?? null,
          device_user_agent: requestMeta.user_agent ?? null,
          ip_address: requestMeta.ip_address ?? null,
          matched_geofence_id: decision.matched_geofence_id,
          distance_m: decision.distance_m,
          accepted: true, // recorded; off-site is flagged, not rejected
          rejection_reason: decision.reason,
          is_offsite: decision.is_offsite,
          formatted_address: addressLabel,
          device_recognized: deviceRecognized,
          device_id: matchedDeviceId,
          occurred_at: null,
        },
      });
    } catch (err) {
      // 000303 partial unique index fired: a concurrent punch beat this one to
      // the same day + type. Present it as the same conflict the guard raises.
      if (err && err.code === "23505") {
        throw new ConflictError(
          input.event_type === "clock_out"
            ? "You've already clocked out today."
            : "You've already clocked in today.",
        );
      }
      throw err;
    }

    // Device-binding side-effects. A recognised device gets its last-seen
    // bumped; an UNKNOWN device on a clock-in raises an 'unknown_device' HR
    // query and writes the change feed so it surfaces red on attendance and
    // reaches HR & Staff. Only clock-in raises the query (one accepted
    // clock-in per day → naturally de-duped); clock-out still records the flag.
    if (deviceRecognized === true && matchedDeviceId) {
      await devicesRepo.touchDevice({
        client,
        deviceId: matchedDeviceId,
        ip: requestMeta.ip_address,
      });
    } else if (deviceRecognized === false && input.event_type === "clock_in") {
      await repo.createQuery({
        client,
        brand,
        input: {
          profile_id: profile.profile_id,
          query_type: "unknown_device",
          severity: "high",
          subject: `Clock-in from an unrecognised device on ${todayStr()}`,
          details:
            `You clocked in on ${todayStr()} from a device that isn't enrolled ` +
            `for attendance. If this was you, enrol the device in My HR → My ` +
            `devices. If it wasn't, tell HR immediately — someone may have ` +
            `clocked in as you.`,
          source: "auto",
        },
      });
      await devicesRepo.logChange({
        client,
        business: profile.business,
        profileId: profile.profile_id,
        deviceId: null,
        action: "flagged_unknown",
        label: null,
        fingerprint: input.device_fingerprint ?? null,
        actorUserId: user.user_id,
        note: `Clock-in from an unrecognised device on ${todayStr()}`,
      });
    }

    // Immediate lateness feedback on clock-in (server time is authoritative).
    let lateMinutes = 0;
    if (input.event_type === "clock_in") {
      const expectedStart =
        profile.work_expected_start_time || settings.default_expected_start_time;
      const grace =
        profile.work_grace_minutes !== null && profile.work_grace_minutes !== undefined
          ? profile.work_grace_minutes
          : settings.default_grace_minutes;
      lateMinutes = calc.minutesLate({
        expectedStart,
        firstClockInAt: event.occurred_at,
        graceMinutes: grace,
        dateStr: todayStr(),
        tzOffsetMinutes: LAGOS_UTC_OFFSET_MIN,
      });
    }

    // Real-time attendance: carry a compact, ready-to-render row so the
    // Attendance tab updates the instant someone punches — no waiting for the
    // nightly reconcile (which now only settles the books at 21:00 Lagos).
    // device_recognized === false drives the red unknown-device marker.
    events.emit("clock_event", {
      brand,
      event_id: event.event_id,
      is_offsite: decision.is_offsite,
      live_row: {
        profile_id: profile.profile_id,
        display_name: profile.display_name || null,
        event_type: event.event_type,
        occurred_at: event.occurred_at,
        is_offsite: decision.is_offsite,
        distance_m: decision.distance_m,
        address: event.formatted_address,
        device_recognized: deviceRecognized,
        late_minutes: lateMinutes,
        status: lateMinutes > 0 ? "late" : "present",
      },
    });
    return {
      event_id: event.event_id,
      event_type: event.event_type,
      occurred_at: event.occurred_at,
      is_offsite: decision.is_offsite,
      distance_m: decision.distance_m,
      address: event.formatted_address,
      device_recognized: deviceRecognized,
      late_minutes: lateMinutes,
      status: lateMinutes > 0 ? "late" : "present",
    };
  });
}

// ── Overview (HR & Staff) ──────────────────────────────────
async function getOverview({ brand }) {
  const counts = await repo.overviewCounts({ brand });
  const pending_justifications = (
    await repo.listAttendanceDays({ brand, filters: { is_late: true } })
  ).filter((d) => !d.justified).slice(0, 50);
  return { counts, pending_justifications };
}

/** Today's accepted punches, live-feed seed for the Attendance tab (000304). */
async function getLiveAttendance({ brand }) {
  return { data: await repo.liveTodayPunches({ brand }) };
}

// ── Analytics (HR dashboard) ───────────────────────────────
async function getAnalytics({ brand, year, month }) {
  const now = new Date();
  const y = Number(year) || now.getUTCFullYear();
  const m = Number(month) || now.getUTCMonth() + 1;
  const a = await repo.analytics({ brand, year: y, month: m });
  const presentDays = Number(a.present_days || 0);
  const lateDays = Number(a.late_days || 0);
  const punctuality_pct = presentDays > 0
    ? Math.round(((presentDays - lateDays) / presentDays) * 100)
    : 0;
  return {
    period: { year: y, month: m },
    headcount: Number(a.headcount || 0),
    attendance: {
      present_days: presentDays,
      late_days: lateDays,
      absent_days: Number(a.absent_days || 0),
      leave_days: Number(a.leave_days || 0),
      offsite_days: Number(a.offsite_days || 0),
      punctuality_pct,
    },
    lateness_deductions_ngn: Number(a.lateness_deductions_ngn || 0),
    open_queries: Number(a.open_queries || 0),
    pending_leave: Number(a.pending_leave || 0),
    targets: {
      active: Number(a.active_targets || 0),
      achieved: Number(a.achieved_targets || 0),
    },
    earned_mtd_ngn: Number(a.earned_mtd_ngn || 0),
  };
}

/** Month-over-month HR trends (headcount, hires, attrition, punctuality, cost). */
async function getAnalyticsTrends({ brand, months }) {
  const n = Math.min(24, Math.max(3, Number(months) || 12));
  const rows = await repo.analyticsTrends({ brand, months: n });
  return {
    months: n,
    series: rows.map((r) => ({
      year: Number(r.year),
      month: Number(r.month),
      label: `${String(r.month).padStart(2, "0")}/${String(r.year).slice(2)}`,
      headcount: Number(r.headcount || 0),
      new_hires: Number(r.new_hires || 0),
      attrition: Number(r.attrition || 0),
      punctuality_pct: Number(r.punctuality_pct || 0),
      payroll_ngn: Number(r.payroll_ngn || 0),
    })),
  };
}

/** Staff whose probation ends within `days` days — for the HR watch-list. */
async function getProbationEndingSoon({ brand, days }) {
  const d = Math.min(120, Math.max(1, Number(days) || 30));
  const rows = await repo.probationEndingSoon({ brand, days: d });
  return {
    days: d,
    items: rows.map((r) => ({
      profile_id: r.profile_id,
      user_id: r.user_id,
      display_name: r.display_name,
      job_title: r.job_title,
      probation_status: r.probation_status,
      probation_end_date: r.probation_end_date,
      days_left: Number(r.days_left),
    })),
  };
}

// ── My HR (self-service dashboard) ─────────────────────────
async function getMyHr({ brand, user }) {
  const profile = await repo.profileForUser({ brand, userId: user.user_id });
  if (!profile) throw new NotFoundError("Staff profile");

  const settings = await repo.getSettings({ brand });
  const { year, month } = ym();
  const workingDaysCount = calc.workingDaysInMonth(year, month, settings.working_days);
  const dailyRate = calc.dailyRate(Number(profile.base_salary || 0), workingDaysCount);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;

  const [
    mtd, attendance, openQueries, leaveRows, commissions, bonuses,
  ] = await Promise.all([
    repo.earningsMonthToDate({ brand, profileId: profile.profile_id, year, month }),
    // Full month, used only to compute `insights` below — the display list
    // itself is served paginated by GET /hr/me/attendance.
    repo.listAttendanceDays({
      brand, filters: { profile_id: profile.profile_id, from: monthStart },
    }),
    repo.listQueries({
      brand, filters: { profile_id: profile.profile_id, open: true },
    }),
    repo.listLeave({ brand, filters: { profile_id: profile.profile_id } }),
    // Own pay artefacts (§3.4 end product + accruals as they build — audit M3/M5).
    payrollRepo.listCommissions({ brand, filters: { user_id: user.user_id }, page: 1, page_size: 25 }),
    payrollRepo.listBonuses({ brand, filters: { user_id: user.user_id }, page: 1, page_size: 25 }),
  ]);
  // Onboarding pack (§3.7): the brand checklist ticked per employee, plus the
  // SOP articles, own documents and handy links — always available on My HR.
  const [onboardDone, helpArticles, ownDocs] = await Promise.all([
    repo.onboardingProgress({ brand, profileId: profile.profile_id }),
    repo.onboardingHelpArticles({ articleIds: settings.onboarding_help_article_ids }).catch(() => []),
    repo.ownDocumentsForProfile({ brand, profileId: profile.profile_id }).catch(() => []),
  ]);
  const checklist = Array.isArray(settings.onboarding_checklist)
    ? settings.onboarding_checklist
    : [];
  const onboarding = {
    welcome: settings.onboarding_welcome || null,
    items: checklist.map((it) => ({
      key: it.key,
      label: it.label,
      completed: onboardDone.has(it.key),
    })),
    done: checklist.filter((it) => onboardDone.has(it.key)).length,
    total: checklist.length,
    help_articles: helpArticles,
    documents: ownDocs,
    links: Array.isArray(settings.onboarding_links) ? settings.onboarding_links : [],
  };
  // Own reward grants (self-service, not permission-gated — the motivational
  // "my rewards" card, §3 reward system).
  const rewards = await rewardsRepo
    .listGrants({ brand, filters: { profile_id: profile.profile_id } })
    .catch(() => []);

  const atRisk = openQueries.reduce(
    (sum, q) => sum + Number(q.deduction_ngn || 0), 0,
  );
  const insights = calc.computeAttendanceInsights(attendance, LAGOS_UTC_OFFSET_MIN);
  const accruals = {
    commission_pending_ngn: commissions.data
      .filter((c) => ["accrued", "approved"].includes(c.status))
      .reduce((s, c) => s + Number(c.commission_amount_ngn || 0), 0),
    bonus_pending_ngn: bonuses.data
      .filter((b) => ["pending_approval", "approved"].includes(b.status))
      .reduce((s, b) => s + Number(b.amount_ngn || 0), 0),
    commissions: commissions.data.slice(0, 10),
    bonuses: bonuses.data.slice(0, 10),
  };

  // Leave taken this year, grouped by type.
  const balanceMap = {};
  for (const l of leaveRows) {
    if (l.status !== "approved") continue;
    balanceMap[l.leave_type] = (balanceMap[l.leave_type] || 0) + Number(l.days_requested || 0);
  }

  return {
    profile: {
      profile_id: profile.profile_id,
      display_name: profile.display_name,
      job_title: profile.job_title,
      employee_number: profile.employee_number,
      department: profile.department,
    },
    schedule: {
      work_schedule: profile.work_schedule || {},
      expected_start_time: profile.work_expected_start_time || settings.default_expected_start_time,
      expected_end_time: profile.work_expected_end_time || settings.default_expected_end_time,
      grace_minutes: profile.work_grace_minutes !== null && profile.work_grace_minutes !== undefined
        ? profile.work_grace_minutes
        : settings.default_grace_minutes,
    },
    earnings: {
      tracker_enabled: settings.earnings_tracker_enabled,
      base_salary_ngn: Number(profile.base_salary || 0),
      daily_rate_ngn: dailyRate,
      working_days_in_month: workingDaysCount,
      days_worked: Number(mtd.days_worked || 0),
      month_to_date_earned_ngn: Number(mtd.earned || 0),
      deductions_ngn: Number(mtd.deducted || 0),
      at_risk_ngn: atRisk,
      projected_month_ngn: calc.round2(dailyRate * workingDaysCount),
    },
    insights,
    open_queries: openQueries,
    leave_balance: Object.entries(balanceMap).map(([leave_type, days_taken]) => ({
      leave_type, days_taken,
    })),
    leave_requests: leaveRows.slice(0, 25),
    annual_leave_days_remaining: Number(profile.annual_leave_days_remaining || 0),
    accruals,
    rewards,
    onboarding,
  };
}

/** Shape a raw performance_targets row with its live countdown fields. */
function withTargetProgress(t) {
  return {
    ...t,
    remaining: Math.max(0, Number(t.target_value) - Number(t.current_value)),
    progress_pct: Number(t.target_value) > 0
      ? Math.min(100, Math.round((Number(t.current_value) / Number(t.target_value)) * 100))
      : 0,
  };
}

/**
 * Paginated self-service sections of My HR (10/page by default) — attendance
 * (scoped to one calendar month, defaulting to the current one), tasks,
 * targets, contracts/documents and payslips. Split out from getMyHr's
 * bootstrap payload so each list can page independently (audit: the bootstrap
 * previously shipped every row for the month/every task/every contract in one
 * response, which the frontend then sliced client-side — never actually
 * paginated server-side).
 */
async function myAttendance({ brand, user, year, month, page, page_size }) {
  const profile = await repo.profileForUser({ brand, userId: user.user_id });
  if (!profile) throw new NotFoundError("Staff profile");
  const now = new Date();
  const y = Number(year) || now.getUTCFullYear();
  const m = Math.min(12, Math.max(1, Number(month) || now.getUTCMonth() + 1));
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const result = await repo.listAttendanceDaysPage({
    brand,
    filters: { profile_id: profile.profile_id, from, to, page, page_size },
  });
  return { ...result, year: y, month: m };
}

async function myTasks({ brand, user, page, page_size }) {
  return repo.tasksForUserPage({ brand, userId: user.user_id, page, page_size });
}

async function myContracts({ brand, user, page, page_size }) {
  const profile = await repo.profileForUser({ brand, userId: user.user_id });
  if (!profile) throw new NotFoundError("Staff profile");
  return repo.contractsForProfilePage({ profileId: profile.profile_id, page, page_size });
}

async function myTargets({ brand, user, page, page_size }) {
  const profile = await repo.profileForUser({ brand, userId: user.user_id });
  if (!profile) throw new NotFoundError("Staff profile");
  const { year, month } = ym();
  const result = await repo.listTargetsPage({
    brand,
    filters: {
      profile_id: profile.profile_id, period_year: year, period_month: month, page, page_size,
    },
  });
  return { ...result, data: result.data.map(withTargetProgress) };
}

async function myPayslips({ brand, user, page, page_size }) {
  return payrollRepo.listPayslips({
    brand, filters: { user_id: user.user_id }, page: page || 1, page_size: page_size || 10,
  });
}

/** Tick / untick one of my onboarding checklist items (self-service). */
async function toggleOnboardingItem({ brand, user, item_key, completed }) {
  return transaction(async (client) => {
    const profile = await repo.profileForUser({ client, brand, userId: user.user_id });
    if (!profile) throw new NotFoundError("Staff profile");
    await repo.setOnboardingItem({
      client, brand, profileId: profile.profile_id, item_key,
      completed: completed !== false, userId: user.user_id,
    });
    events.emit("onboarding_item", { brand, profile_id: profile.profile_id, item_key });
    return { item_key, completed: completed !== false };
  });
}

// ── Employee 360 (HR dossier — audit H4) ───────────────────
/**
 * The everything-view of one employee: masked profile (probation, terms,
 * schedule, bank), attendance history + insights (earliest/latest arrival,
 * punctuality, days at risk), earnings/payslips, targets & bonuses, queries &
 * leave, contracts, and appraisal reviews. Permission-gated the same as the
 * employee record; PII masking is inherited from hr.service.getStaff.
 */
async function getEmployee360({ brand, user, profileId }) {
  const profile = await hrService.getStaff({ brand, user, id: profileId });
  const settings = await repo.getSettings({ brand });
  const { year, month } = ym();
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const userId = profile.user_id || null;

  const [
    mtd, attendance, targets, queries, leaveRows, contracts,
    payslips, commissions, bonuses, reviews,
  ] = await Promise.all([
    repo.earningsMonthToDate({ brand, profileId, year, month }),
    repo.listAttendanceDays({ brand, filters: { profile_id: profileId, from: monthStart } }),
    repo.listTargets({ brand, filters: { profile_id: profileId, period_year: year, period_month: month } }),
    repo.listQueries({ brand, filters: { profile_id: profileId } }),
    repo.listLeave({ brand, filters: { profile_id: profileId } }),
    repo.contractsForProfile({ profileId }),
    userId
      ? payrollRepo.listPayslips({ brand, filters: { user_id: userId }, page: 1, page_size: 12 })
      : Promise.resolve({ data: [] }),
    userId
      ? payrollRepo.listCommissions({ brand, filters: { user_id: userId }, page: 1, page_size: 25 })
      : Promise.resolve({ data: [] }),
    userId
      ? payrollRepo.listBonuses({ brand, filters: { user_id: userId }, page: 1, page_size: 25 })
      : Promise.resolve({ data: [] }),
    userId
      ? appraisalRepo.listReviews({ brand, user_id: userId })
      : Promise.resolve([]),
  ]);

  const attInsights = calc.computeAttendanceInsights(attendance, LAGOS_UTC_OFFSET_MIN);
  const activeTargets = targets.filter((t) => t.status === "active");
  const achievedTargets = targets.filter((t) => t.status === "achieved");
  const latestReview =
    (reviews || []).find(
      (r) => r.overall_weighted_score !== null && r.overall_weighted_score !== undefined,
    ) || null;
  // Quality prefers the real service-job QC average (the Ops-Manager ratings,
  // §3.3); the appraisal weighted score is the fallback (audit H1 wiring).
  let jobQuality = null;
  try {
    jobQuality = await rewardsRepo.qualityAvgForProfile({ brand, profileId });
  } catch {
    jobQuality = null;
  }
  const startDate = profile.start_date ? String(profile.start_date).slice(0, 10) : null;
  const tenureDays = startDate
    ? Math.max(0, Math.floor((Date.now() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86400000))
    : null;
  // Onboarding completion (§3.7) — how far this hire is through the checklist.
  const onboardChecklist = Array.isArray(settings.onboarding_checklist)
    ? settings.onboarding_checklist
    : [];
  const onboardDone = await repo.onboardingDoneCount({ brand, profileId }).catch(() => 0);

  return {
    profile,
    onboarding: {
      done: Math.min(onboardDone, onboardChecklist.length),
      total: onboardChecklist.length,
    },
    insights: {
      ...attInsights,
      tenure_days: tenureDays,
      target_attainment_pct: activeTargets.length || achievedTargets.length
        ? Math.round((achievedTargets.length / (activeTargets.length + achievedTargets.length)) * 100)
        : null,
      quality_score:
        jobQuality !== null && jobQuality !== undefined
          ? jobQuality
          : latestReview
            ? Number(latestReview.overall_weighted_score)
            : null,
      earned_mtd_ngn: Number(mtd.earned || 0),
      deductions_mtd_ngn: Number(mtd.deducted || 0),
    },
    schedule: {
      work_schedule: profile.work_schedule || {},
      expected_start_time: profile.work_expected_start_time || settings.default_expected_start_time,
      expected_end_time: profile.work_expected_end_time || settings.default_expected_end_time,
    },
    attendance,
    targets: targets.map((t) => ({
      ...t,
      remaining: Math.max(0, Number(t.target_value) - Number(t.current_value)),
      progress_pct: Number(t.target_value) > 0
        ? Math.min(100, Math.round((Number(t.current_value) / Number(t.target_value)) * 100))
        : 0,
    })),
    queries,
    leave_requests: leaveRows,
    contracts,
    payslips: payslips.data,
    commissions: commissions.data,
    bonuses: bonuses.data,
    reviews: reviews || [],
  };
}

module.exports = {
  getSettings,
  updateSettings,
  setPayoutPin,
  verifyPayoutPin,
  listLeave,
  requestLeave,
  decideLeave,
  listQueries,
  raiseQuery,
  respondToQuery,
  resolveQuery,
  listTargets,
  setTarget,
  updateTargetProgress,
  bumpTargetProgress,
  recomputeServiceTargets,
  removeTarget,
  reconcileDay,
  reconcilePeriod,
  unreconciledWorkingDates,
  applyLapsedOffsite,
  bumpDueReminders,
  sendClockoutReminders,
  getMyToday,
  selfClock,
  getOverview,
  getLiveAttendance,
  getAnalytics,
  getAnalyticsTrends,
  getProbationEndingSoon,
  getMyHr,
  myAttendance,
  myTasks,
  myContracts,
  myTargets,
  myPayslips,
  toggleOnboardingItem,
  getEmployee360,
};
