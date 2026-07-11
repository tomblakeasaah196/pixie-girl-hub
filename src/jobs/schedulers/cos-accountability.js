/**
 * Chief of Staff accountability sweep (PR4). Runs hourly, cron-locked.
 *
 * Each tick, for the CEO and every brand:
 *   1. Risk scan — cos.risk assesses every active/on-hold goal, the computed
 *      health is persisted (goals.health), and per-subject follow-up candidates
 *      (no_progress / slippage / due-today / due-tomorrow / overdue) are raised.
 *   2. Follow-ups — a candidate with no live follow-up (partial-unique guard +
 *      cooldown) becomes a cos_followups row + a 3-button notification
 *      (✅ Done / 🟡 In Progress / 🔴 Delayed) delivered in-app + push + email
 *      per the user's prefs. Logged to cos_nudges.
 *   3. Evening review — at cos_settings.evening_review_at (default 18:00) a
 *      once-a-day end-of-day summary (no separate cron), quiet-hours aware.
 *
 * Deterministic and cheap: no LLM here. Quiet hours + dedupe are respected so
 * the CEO is never pinged at night or twice for the same thing.
 *
 * cos_settings (PR6) will make timezone / quiet hours / review time
 * per-user; until then these defaults stand.
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const { BRANDS } = require("../../config/brands");
const goalsRepo = require("../../shared/goals/goals.repo");
const repo = require("../../modules/chief_of_staff/cos.accountability.repo");
const risk = require("../../modules/chief_of_staff/cos.risk");
const events = require("../../modules/chief_of_staff/cos.events");
const notifications = require("../../services/notifications.service");

// Defaults until cos_settings (PR6) makes these per-user.
const TZ = "Africa/Lagos";
const QUIET_START = 21; // 21:00 — no nudges from here…
const QUIET_END = 6; // …until 06:00
const EVENING_REVIEW_HOUR = 18;
const EVENING_DEDUPE_HOURS = 20;

/** Local wall-clock hour (0–23) in a timezone. */
function localHour(tz = TZ, at = new Date()) {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).format(at);
  return Number(h) % 24;
}

function isQuietHour(hour) {
  // Window wraps midnight (21 → 06).
  return QUIET_START > QUIET_END
    ? hour >= QUIET_START || hour < QUIET_END
    : hour >= QUIET_START && hour < QUIET_END;
}

function respondActions(followupId) {
  // Client-relative path — the admin API client prepends /api/v1.
  const endpoint = `/cos/followups/${followupId}/respond`;
  return [
    { label: "✅ Done", value: "done", endpoint },
    { label: "🟡 In Progress", value: "in_progress", endpoint },
    { label: "🔴 Delayed", value: "delayed", endpoint },
  ];
}

async function findCeo() {
  try {
    const { rows } = await query(
      `SELECT user_id FROM shared.users WHERE is_ceo = true ORDER BY created_at LIMIT 1`,
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

/** Create a follow-up + action-button notification for one candidate. */
async function raiseFollowup({ brand, ceoId, goal, cand }) {
  const blocking = await repo.findBlockingFollowup({
    subject_type: cand.subject_type,
    subject_id: cand.subject_id,
    trigger: cand.trigger,
  });
  if (blocking) return false;

  let followup;
  try {
    followup = await repo.createFollowup({
      f: {
        business: brand,
        user_id: ceoId,
        subject_type: cand.subject_type,
        subject_id: cand.subject_id,
        trigger: cand.trigger,
        state: "open",
        question: cand.question,
      },
    });
  } catch (err) {
    // Unique partial index (another tick won the race) — treat as already done.
    if (err && err.code === "23505") return false;
    throw err;
  }

  const notif = await notifications.notify({
    user_id: ceoId,
    business: brand,
    type: "cos_followup",
    title: "Chief of Staff",
    body: cand.question,
    priority: cand.priority === "high" ? "high" : "normal",
    reference_type: cand.subject_type,
    reference_id: cand.subject_id,
    action_url: `/workspace?tab=goals${goal ? `&goal=${goal.goal_id}` : ""}`,
    actions: respondActions(followup.followup_id),
    email: true,
  });

  const updated = await repo.updateFollowup({
    id: followup.followup_id,
    fields: {
      state: "asked",
      notification_id: notif ? notif.notification_id : null,
    },
  });

  for (const channel of ["in_app", "push", "email"]) {
    await repo.logNudge({
      n: {
        user_id: ceoId,
        business: brand,
        type: "followup",
        channel,
        reference_type: "cos_followup",
        reference_id: followup.followup_id,
      },
    });
  }

  events.emit("followup.created", {
    followup_id: updated.followup_id,
    user_id: ceoId,
    subject_type: cand.subject_type,
    subject_id: cand.subject_id,
    state: "asked",
  });
  return true;
}

async function scanBrandForCeo({ brand, ceoId, now, quiet }) {
  const goals = await repo.listGoalsForRisk({ brand });
  let made = 0;
  for (const goal of goals) {
    const [milestones, tasks, lastActivityAt] = await Promise.all([
      repo.allMilestones({ goal_id: goal.goal_id }),
      repo.openGoalTasks({ brand, goal_id: goal.goal_id }),
      repo.lastActivityForGoal({ goal_id: goal.goal_id }),
    ]);

    const { health, candidates } = risk.assessGoal({
      goal,
      milestones,
      tasks,
      lastActivityAt,
      now,
    });

    const changed = await goalsRepo.setHealth({
      brand,
      goal_id: goal.goal_id,
      health,
    });
    if (changed)
      events.emit("goal.health_changed", {
        goal_id: goal.goal_id,
        user_id: ceoId,
        health,
      });

    if (quiet) continue; // scan + health still update; just don't ping at night
    for (const cand of candidates) {
      try {
        if (await raiseFollowup({ brand, ceoId, goal, cand })) made += 1;
      } catch (err) {
        logger.error(
          { err: err.message, subject: cand.subject_id },
          "cos-accountability: raise follow-up failed",
        );
      }
    }
  }
  return made;
}

async function maybeEveningReview({ brand, ceoId, hour, quiet }) {
  if (hour !== EVENING_REVIEW_HOUR || quiet) return false;
  const since = new Date(
    Date.now() - EVENING_DEDUPE_HOURS * 3600 * 1000,
  ).toISOString();
  if (
    await repo.nudgeSentSince({
      user_id: ceoId,
      business: brand,
      type: "evening_review",
      since,
    })
  )
    return false;

  const s = await repo.eveningStats({ brand });
  const tail = s.overdue_open
    ? `${s.overdue_open} overdue — reschedule what's unfinished?`
    : s.due_today_open
      ? `${s.due_today_open} still due today.`
      : "You're all clear for today — nice work.";
  const body = `End of day for ${brand}: ${s.completed_today} completed, ${s.due_today_open} due today, ${tail}`;

  await notifications.notify({
    user_id: ceoId,
    business: brand,
    type: "cos_briefing",
    title: "Evening review",
    body,
    action_url: "/workspace?tab=goals",
  });
  await repo.logNudge({
    n: {
      user_id: ceoId,
      business: brand,
      type: "evening_review",
      channel: "in_app",
    },
  });
  return true;
}

async function runCosAccountabilitySweep() {
  const ceo = await findCeo();
  if (!ceo) {
    logger.info("cos-accountability: no CEO user — nothing to do");
    return { followups: 0, reviews: 0 };
  }
  const now = new Date();
  const hour = localHour();
  const quiet = isQuietHour(hour);

  let followups = 0;
  let reviews = 0;
  for (const brand of BRANDS) {
    try {
      followups += await scanBrandForCeo({
        brand,
        ceoId: ceo.user_id,
        now,
        quiet,
      });
      if (await maybeEveningReview({ brand, ceoId: ceo.user_id, hour, quiet }))
        reviews += 1;
    } catch (err) {
      logger.error({ err: err.message, brand }, "cos-accountability brand failed");
    }
  }
  logger.info({ followups, reviews, quiet, hour }, "cos accountability sweep complete");
  return { followups, reviews };
}

module.exports = {
  runCosAccountabilitySweep,
  // exposed for tests
  localHour,
  isQuietHour,
  respondActions,
};
