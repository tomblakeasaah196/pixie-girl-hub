/**
 * Workspace reminder sweep (V2.2 §6.18/§6.19).
 *
 * Fires task and calendar-event reminders: any armed reminder whose
 * remind_at has passed (reminder_sent_at IS NULL) raises an in-app
 * notification and is stamped so it never double-fires. Editing a
 * reminder clears the stamp (tasks.repo / calendar.repo), re-arming it.
 *
 * Tasks notify the assignee (falling back to the creator); events notify
 * the creator plus every user participant. Non-fatal — a bad row or a
 * failed notification never stops the sweep.
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const notifications = require("../../services/notifications.service");

const BATCH = 200;

function fmtWhen(at) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Lagos",
    }).format(new Date(at));
  } catch {
    return String(at);
  }
}

async function sweepTaskReminders() {
  const { rows } = await query(
    `SELECT task_id, business, title, due_at, assigned_to, created_by, priority
       FROM shared.tasks
      WHERE remind_at IS NOT NULL AND remind_at <= now()
        AND reminder_sent_at IS NULL
        AND is_deleted = false AND status NOT IN ('done','cancelled')
      ORDER BY remind_at
      LIMIT $1`,
    [BATCH],
  );
  let sent = 0;
  for (const t of rows) {
    try {
      await notifications.notify({
        user_id: t.assigned_to || t.created_by,
        business: t.business,
        type: "task_reminder",
        priority: t.priority === "urgent" ? "high" : "normal",
        title: "Task reminder",
        body: t.due_at
          ? `“${t.title}” is due ${fmtWhen(t.due_at)}.`
          : `Reminder: “${t.title}”.`,
        reference_type: "task",
        reference_id: t.task_id,
      });
      sent++;
    } catch (err) {
      logger.error(
        { err: err.message, task_id: t.task_id },
        "workspace reminders: task notification failed",
      );
    }
    // Stamp even when the notification failed-soft (user opted out) so a
    // permanently-failing row can't wedge the sweep at the batch head.
    await query(
      `UPDATE shared.tasks SET reminder_sent_at = now() WHERE task_id = $1`,
      [t.task_id],
    );
  }
  return { candidates: rows.length, sent };
}

async function sweepEventReminders() {
  const { rows } = await query(
    `SELECT e.event_id, e.business, e.title, e.start_at, e.location, e.created_by,
            COALESCE(
              (SELECT array_agg(DISTINCT ep.user_id)
                 FROM shared.event_participants ep
                WHERE ep.event_id = e.event_id AND ep.user_id IS NOT NULL),
              '{}'
            ) AS participant_user_ids
       FROM shared.calendar_events e
      WHERE e.remind_at IS NOT NULL AND e.remind_at <= now()
        AND e.reminder_sent_at IS NULL
        AND e.is_deleted = false
      ORDER BY e.remind_at
      LIMIT $1`,
    [BATCH],
  );
  let sent = 0;
  for (const e of rows) {
    const recipients = new Set(
      [e.created_by, ...(e.participant_user_ids || [])].filter(Boolean),
    );
    for (const user_id of recipients) {
      try {
        await notifications.notify({
          user_id,
          business: e.business,
          type: "event_reminder",
          priority: "normal",
          title: "Event reminder",
          body:
            `“${e.title}” starts ${fmtWhen(e.start_at)}` +
            (e.location ? ` · ${e.location}` : "") +
            ".",
          reference_type: "calendar_event",
          reference_id: e.event_id,
        });
        sent++;
      } catch (err) {
        logger.error(
          { err: err.message, event_id: e.event_id, user_id },
          "workspace reminders: event notification failed",
        );
      }
    }
    await query(
      `UPDATE shared.calendar_events SET reminder_sent_at = now() WHERE event_id = $1`,
      [e.event_id],
    );
  }
  return { candidates: rows.length, sent };
}

async function runWorkspaceReminderSweep() {
  let tasks = { candidates: 0, sent: 0 };
  let events = { candidates: 0, sent: 0 };
  try {
    tasks = await sweepTaskReminders();
  } catch (err) {
    logger.error({ err: err.message }, "workspace task-reminder sweep failed");
  }
  try {
    events = await sweepEventReminders();
  } catch (err) {
    logger.error({ err: err.message }, "workspace event-reminder sweep failed");
  }
  if (tasks.candidates || events.candidates) {
    logger.info(
      { task_reminders: tasks.sent, event_reminders: events.sent },
      "workspace reminder sweep done",
    );
  }
  return { tasks, events };
}

module.exports = { runWorkspaceReminderSweep };
