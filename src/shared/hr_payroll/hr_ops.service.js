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
const calc = require("./lateness.calc");
const events = require("./hr.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, ConflictError, ValidationError } =
  require("../../utils/errors");

function ym(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
    if (resolution === "waived" && before.attendance_day_id) {
      const day = await repo.justifyDay({ client, dayId: before.attendance_day_id });
      // Re-snapshot that day's earnings with the deduction removed.
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
  return updated;
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
    const leaves = await repo.approvedLeaveForDate({ client, profileIds, dateStr });

    let records = 0;
    let lateCount = 0;
    for (const s of staff) {
      const wd = calc.resolveWorkingDay({
        dateStr,
        workSchedule: s.work_schedule,
        brandWorkingDays: settings.working_days,
      });
      const expectedStart = s.work_expected_start_time || settings.default_expected_start_time;
      const grace = s.work_grace_minutes !== null && s.work_grace_minutes !== undefined
        ? s.work_grace_minutes
        : settings.default_grace_minutes;
      const clock = clockIns[s.profile_id];
      const leaveId = leaves[s.profile_id];

      const r = calc.reconcileDay({
        dateStr,
        baseSalaryNgn: Number(s.base_salary || 0),
        workingDaysCount,
        expectedStart,
        graceMinutes: grace,
        firstClockInAt: clock ? clock.occurred_at : null,
        isOnLeave: Boolean(leaveId),
        isWorkingDay: wd.working,
        tiers: settings.lateness_enabled ? settings.lateness_tiers : [],
      });

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
          leave_id: leaveId || null,
          reconciled_by: user ? user.user_id : null,
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

      if (
        r.status === "late" &&
        settings.lateness_enabled &&
        settings.lateness_auto_query &&
        !day.justified
      ) {
        const q = await repo.upsertAutoQuery({
          client, brand,
          input: {
            profile_id: s.profile_id,
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
    return { date: dateStr, records_created: records, late_count: lateCount };
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

// ── My HR (self-service dashboard) ─────────────────────────
async function getMyHr({ brand, user }) {
  const profile = await repo.profileForUser({ brand, userId: user.user_id });
  if (!profile) throw new NotFoundError("Staff profile");

  const settings = await repo.getSettings({ brand });
  const { year, month } = ym();
  const workingDaysCount = calc.workingDaysInMonth(year, month, settings.working_days);
  const dailyRate = calc.dailyRate(Number(profile.base_salary || 0), workingDaysCount);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;

  const [mtd, attendance, openQueries, targets, leaveRows, tasks, contracts] =
    await Promise.all([
      repo.earningsMonthToDate({ brand, profileId: profile.profile_id, year, month }),
      repo.listAttendanceDays({
        brand, filters: { profile_id: profile.profile_id, from: monthStart },
      }),
      repo.listQueries({
        brand, filters: { profile_id: profile.profile_id, open: true },
      }),
      repo.listTargets({
        brand,
        filters: { profile_id: profile.profile_id, status: "active", period_year: year, period_month: month },
      }),
      repo.listLeave({ brand, filters: { profile_id: profile.profile_id } }),
      repo.tasksForUser({ brand, userId: user.user_id }),
      repo.contractsForProfile({ profileId: profile.profile_id }),
    ]);

  const atRisk = openQueries.reduce(
    (sum, q) => sum + Number(q.deduction_ngn || 0), 0,
  );

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
    targets: targets.map((t) => ({
      ...t,
      remaining: Math.max(0, Number(t.target_value) - Number(t.current_value)),
      progress_pct: Number(t.target_value) > 0
        ? Math.min(100, Math.round((Number(t.current_value) / Number(t.target_value)) * 100))
        : 0,
    })),
    attendance,
    open_queries: openQueries,
    leave_balance: Object.entries(balanceMap).map(([leave_type, days_taken]) => ({
      leave_type, days_taken,
    })),
    leave_requests: leaveRows.slice(0, 25),
    annual_leave_days_remaining: Number(profile.annual_leave_days_remaining || 0),
    tasks,
    contracts,
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
  removeTarget,
  reconcileDay,
  getOverview,
  getMyHr,
};
