/**
 * Chief of Staff (PR5) — smart scheduling & focus protection (wow #5).
 *
 *   findFocus       — scan free/busy in work hours → propose a focus block →
 *                     book it via a workspace.create_event batch (CEO approves).
 *   load            — sum meeting hours + high-priority tasks for a day vs a
 *                     threshold → overload warning + "reschedule N?" hint.
 *   batchReschedule — resolve tasks matching a keyword → a re-plan that shifts
 *                     each due date (reuses the batch approval gate).
 *
 * The free-slot maths (findFreeSlots) and the load maths (computeLoad) are PURE
 * and unit-tested — no double-book, and every proposed slot sits inside work
 * hours and outside quiet hours. Times are handled at a fixed brand offset
 * (Africa/Lagos = UTC+1, no DST); PR6's cos_settings will make it per-user.
 */

"use strict";

const calendarRepo = require("../../shared/calendar/calendar.repo");
const tasksRepo = require("../../shared/tasks/tasks.repo");
const planBuilder = require("./cos.plan-builder");
const { AppError } = require("../../utils/errors");

// Defaults until cos_settings (PR6). Minutes since LOCAL midnight.
const DEFAULTS = {
  workStartMin: 8 * 60, // 08:00
  workEndMin: 18 * 60, // 18:00
  quietStartMin: 21 * 60, // 21:00
  quietEndMin: 6 * 60, // 06:00 (wraps midnight)
  tzOffsetMin: 60, // Africa/Lagos, UTC+1
  stepMin: 30,
};
const CONVERSATION_TITLE = "Chief of Staff · Scheduling";
const MEETING_TYPES = new Set(["meeting", "call", "review", "appointment", "training"]);

// ── Time helpers (pure) ────────────────────────────────────
function addDaysDateOnly(value, days) {
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}
/** UTC Date for a local wall-clock (dateStr + minutes-since-local-midnight). */
function localWallToUTC(dateStr, minutes, tzOffsetMin) {
  const base = Date.parse(`${String(dateStr).slice(0, 10)}T00:00:00.000Z`);
  return new Date(base + (minutes - tzOffsetMin) * 60000);
}
/** True if [aStart,aEnd) overlaps [bStart,bEnd). */
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}
/** True if a local-minutes value falls in the (possibly wrapping) quiet window. */
function inQuiet(min, quietStartMin, quietEndMin) {
  if (quietStartMin === quietEndMin) return false;
  if (quietStartMin < quietEndMin) return min >= quietStartMin && min < quietEndMin;
  return min >= quietStartMin || min < quietEndMin; // wraps midnight
}

/**
 * Free slots of `durationMin`, scanning `days` days from `fromDate`, inside work
 * hours, outside quiet hours, never overlapping a busy interval, never in the
 * past. PURE. `busy` = [{start,end}] (ISO/Date). Returns [{start_at,end_at}] ISO.
 */
function findFreeSlots({
  busy = [],
  durationMin = 120,
  fromDate,
  days = 7,
  now = new Date(),
  limit = 5,
  ...opts
}) {
  const o = { ...DEFAULTS, ...opts };
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const busyIv = busy
    .filter((b) => b && b.start && b.end)
    .map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()])
    .filter(([s, e]) => e > s);

  const slots = [];
  const start0 = String(fromDate || new Date(nowMs).toISOString()).slice(0, 10);
  for (let day = 0; day < days && slots.length < limit; day++) {
    const dateStr = addDaysDateOnly(start0, day);
    for (
      let m = o.workStartMin;
      m + durationMin <= o.workEndMin;
      m += o.stepMin
    ) {
      const s = localWallToUTC(dateStr, m, o.tzOffsetMin).getTime();
      const e = s + durationMin * 60000;
      if (s < nowMs) continue; // no past slots
      if (inQuiet(m, o.quietStartMin, o.quietEndMin)) continue;
      if (inQuiet(m + durationMin, o.quietStartMin, o.quietEndMin)) continue;
      if (busyIv.some(([bs, be]) => overlaps(s, e, bs, be))) continue;
      slots.push({ start_at: new Date(s).toISOString(), end_at: new Date(e).toISOString() });
      if (slots.length >= limit) break;
    }
  }
  return slots;
}

/**
 * Day load: meeting hours + high-priority task count vs thresholds. PURE.
 * `events`/`tasks` are raw rows; `date` is YYYY-MM-DD (local day).
 */
function computeLoad({
  events = [],
  tasks = [],
  date,
  meetingHoursThreshold = 5,
  highTaskThreshold = 5,
  tzOffsetMin = DEFAULTS.tzOffsetMin,
}) {
  const day = String(date || new Date().toISOString()).slice(0, 10);
  const sameLocalDay = (iso) => {
    if (!iso) return false;
    const local = new Date(new Date(iso).getTime() + tzOffsetMin * 60000);
    return local.toISOString().slice(0, 10) === day;
  };

  let meetingHours = 0;
  let meetings = 0;
  for (const ev of events) {
    if (ev.is_deleted) continue;
    if (!MEETING_TYPES.has(ev.event_type)) continue;
    if (!sameLocalDay(ev.start_at)) continue;
    const dur = (new Date(ev.end_at).getTime() - new Date(ev.start_at).getTime()) / 3600000;
    if (dur > 0) {
      meetingHours += dur;
      meetings += 1;
    }
  }

  const highTasks = tasks.filter(
    (t) =>
      !t.is_deleted &&
      ["high", "urgent"].includes(t.priority) &&
      !["done", "cancelled"].includes(t.status) &&
      sameLocalDay(t.due_at),
  );

  const overloaded = meetingHours >= meetingHoursThreshold || highTasks.length >= highTaskThreshold;
  return {
    date: day,
    meeting_hours: Math.round(meetingHours * 10) / 10,
    meetings,
    high_priority_tasks: highTasks.length,
    overloaded,
    thresholds: { meeting_hours: meetingHoursThreshold, high_priority_tasks: highTaskThreshold },
  };
}

// ── Service wrappers ───────────────────────────────────────
async function findFocus({ user, brand, duration = 120, within = 7 }) {
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = addDaysDateOnly(from, within);
  const events = await calendarRepo.listEvents({
    brand,
    from: `${from}T00:00:00.000Z`,
    to: `${to}T23:59:59.999Z`,
  });
  const busy = events.map((e) => ({ start: e.start_at, end: e.end_at }));
  const slots = findFreeSlots({ busy, durationMin: duration, fromDate: from, days: within, now });

  let plan = null;
  if (slots.length) {
    const first = slots[0];
    const built = await planBuilder.buildProposedPlan({
      user,
      brand,
      title: `Focus block · ${duration} min`,
      summary: `Protect ${duration} minutes of focus time on ${first.start_at.slice(0, 16).replace("T", " ")}.`,
      steps: [
        {
          action_key: "workspace.create_event",
          payload: {
            title: "Focus time",
            event_type: "reminder",
            start_at: first.start_at,
            end_at: first.end_at,
          },
          summary: "Book the focus block",
        },
      ],
      conversationTitle: CONVERSATION_TITLE,
    });
    plan = { ...built.plan, steps: built.steps };
  }
  return { slots, plan };
}

async function load({ brand, date }) {
  const day = String(date || new Date().toISOString()).slice(0, 10);
  const [events, taskPage] = await Promise.all([
    calendarRepo.listEvents({ brand, from: `${day}T00:00:00.000Z`, to: `${day}T23:59:59.999Z` }),
    tasksRepo.listTasks({ brand, page: 1, page_size: 200 }),
  ]);
  const summary = computeLoad({ events, tasks: taskPage.data || [], date: day });
  return summary;
}

/**
 * Shift the due date of every open task whose title matches `match` by `days`.
 * Returns a PROPOSED plan (approve once to apply). Throws if nothing matches.
 */
async function batchReschedule({ user, brand, match, days = 7 }) {
  if (!match || !String(match).trim())
    throw new AppError("VALIDATION", "Say which tasks to move (a keyword).", 422);
  const page = await tasksRepo.listTasks({
    brand,
    search: String(match).trim(),
    page: 1,
    page_size: 100,
  });
  const movable = (page.data || []).filter(
    (t) => t.due_at && !["done", "cancelled"].includes(t.status),
  );
  if (!movable.length)
    throw new AppError("COS_NOTHING_TO_MOVE", `No open tasks match “${match}”.`, 422);

  const steps = movable.map((t) => ({
    action_key: "workspace.update_task",
    payload: { id: t.task_id, due_at: shiftIso(t.due_at, days) },
    summary: `Move “${String(t.title).slice(0, 60)}” +${days}d`,
  }));
  const built = await planBuilder.buildProposedPlan({
    user,
    brand,
    title: `Reschedule ${steps.length} “${match}” task(s) +${days}d`,
    summary: `Shift ${steps.length} task(s) matching “${match}” by ${days} day(s).`,
    steps,
    conversationTitle: CONVERSATION_TITLE,
  });
  return { ...built.plan, steps: built.steps };
}

function shiftIso(value, days) {
  const d = new Date(value);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString();
}

module.exports = {
  findFocus,
  load,
  batchReschedule,
  // pure helpers (exposed for tests)
  findFreeSlots,
  computeLoad,
  localWallToUTC,
  inQuiet,
  addDaysDateOnly,
  DEFAULTS,
};
