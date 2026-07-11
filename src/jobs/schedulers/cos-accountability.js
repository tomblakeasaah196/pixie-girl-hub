/**
 * Chief of Staff accountability sweep (PR4, personalised in PR6). Runs hourly,
 * cron-locked.
 *
 * Each tick, for the CEO and every brand:
 *   1. Risk scan — cos.risk assesses every active/on-hold goal, the computed
 *      health is persisted (goals.health), and per-subject follow-up candidates
 *      (no_progress / slippage / due-today / due-tomorrow / overdue) are raised.
 *   2. Follow-ups — a candidate with no live follow-up (partial-unique guard +
 *      cooldown) becomes a cos_followups row + a 3-button notification
 *      (✅ Done / 🟡 In Progress / 🔴 Delayed) delivered in-app + push + email
 *      per the user's prefs. Logged to cos_nudges. The notification is titled
 *      with the CEO's chosen assistant name (PR6).
 *   3. Evening review — a once-a-day end-of-day summary (no separate cron),
 *      fired at the CEO's evening_review_at, or — when adaptive_timing is on —
 *      nudged toward the hour she actually engages (bounded to work hours).
 *
 * PR6: timezone, quiet hours, review time, assistant name and adaptive timing
 * now come from shared.cos_settings (falling back to sensible defaults when the
 * CEO hasn't saved any). Deterministic and cheap: no LLM here. Quiet hours +
 * dedupe are respected so the CEO is never pinged at night or twice for the
 * same thing.
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const { BRANDS } = require("../../config/brands");
const goalsRepo = require("../../shared/goals/goals.repo");
const repo = require("../../modules/chief_of_staff/cos.accountability.repo");
const settingsRepo = require("../../modules/chief_of_staff/cos.settings.repo");
const adaptive = require("../../modules/chief_of_staff/cos.adaptive");
const { parseHour, localHour, isQuietHour } = require("../../modules/chief_of_staff/cos.time");
const risk = require("../../modules/chief_of_staff/cos.risk");
const events = require("../../modules/chief_of_staff/cos.events");
const notifications = require("../../services/notifications.service");

const EVENING_DEDUPE_HOURS = 20;

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

/**
 * The hour the evening review should fire for this CEO. With adaptive_timing on
 * and enough engagement evidence, it drifts toward when she actually acts in
 * the afternoon/evening; otherwise it's her configured evening_review_at.
 */
async function eveningReviewHour({ ceoId, settings }) {
  const configured = parseHour(settings.evening_review_at, 18);
  if (!settings.adaptive_timing) return configured;
  try {
    const stamps = await repo.recentEngagedNudges({ user_id: ceoId });
    const hours = stamps.map((ts) => localHour(settings.timezone, new Date(ts)));
    return adaptive.preferredHour(hours, {
      defaultHour: configured,
      workStart: parseHour(settings.work_start, 8),
      workEnd: parseHour(settings.work_end, 18),
      floorHour: 12, // an "evening" review only drifts within the afternoon+
    });
  } catch {
    return configured;
  }
}

/** Create a follow-up + action-button notification for one candidate. */
async function raiseFollowup({ brand, ceoId, goal, cand, assistantName }) {
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
    title: assistantName,
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

async function scanBrandForCeo({ brand, ceoId, now, quiet, assistantName }) {
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
        if (await raiseFollowup({ brand, ceoId, goal, cand, assistantName })) made += 1;
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

async function maybeEveningReview({ brand, ceoId, hour, quiet, reviewHour, assistantName }) {
  if (hour !== reviewHour || quiet) return false;
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
    title: `${assistantName} — evening review`,
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

  // PR6: per-user personalisation (name, timezone, quiet/work/review hours,
  // adaptive timing). A missing row resolves to defaults, so this is safe on a
  // fresh deploy before the CEO opens Settings.
  const settings = await settingsRepo.get({ user_id: ceo.user_id }).catch(() => null);
  const s = settings || settingsRepo.DEFAULTS;
  const tz = s.timezone || "Africa/Lagos";
  const assistantName = s.assistant_name || "Chief of Staff";
  const quietStart = parseHour(s.quiet_start, 21);
  const quietEnd = parseHour(s.quiet_end, 6);

  const now = new Date();
  const hour = localHour(tz);
  const quiet = isQuietHour(hour, quietStart, quietEnd);
  const reviewHour = await eveningReviewHour({ ceoId: ceo.user_id, settings: s });

  let followups = 0;
  let reviews = 0;
  for (const brand of BRANDS) {
    try {
      followups += await scanBrandForCeo({
        brand,
        ceoId: ceo.user_id,
        now,
        quiet,
        assistantName,
      });
      if (
        await maybeEveningReview({
          brand,
          ceoId: ceo.user_id,
          hour,
          quiet,
          reviewHour,
          assistantName,
        })
      )
        reviews += 1;
    } catch (err) {
      logger.error({ err: err.message, brand }, "cos-accountability brand failed");
    }
  }
  logger.info(
    { followups, reviews, quiet, hour, reviewHour },
    "cos accountability sweep complete",
  );
  return { followups, reviews };
}

module.exports = {
  runCosAccountabilitySweep,
  // exposed for tests
  localHour,
  isQuietHour,
  parseHour,
  respondActions,
  eveningReviewHour,
};
