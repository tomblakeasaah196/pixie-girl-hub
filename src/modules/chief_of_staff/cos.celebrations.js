/**
 * Chief of Staff (PR6) — win celebrations (wow #8).
 *
 * A goals-events subscriber that congratulates the CEO when a milestone is
 * completed or a goal is achieved: "🎉 3 of 6 — right on pace". Fired only
 * when the CEO has celebrate_wins on, suppressed during quiet hours, and
 * de-duplicated via a cos_nudges row per subject (type='celebration') so a
 * milestone that flips done → (edited) → done is never celebrated twice.
 *
 * The message builder is pure and unit-tested; the subscriber wrapper re-reads
 * the subject (the event payload is thin) and is best-effort — a celebration
 * miss never affects the underlying goal write.
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const goalsRepo = require("../../shared/goals/goals.repo");
const repo = require("./cos.accountability.repo");
const settingsRepo = require("./cos.settings.repo");
const goalsEvents = require("../../shared/goals/goals.events");
const { localHour, isQuietHour, parseHour } = require("./cos.time");
const notifications = require("../../services/notifications.service");

/**
 * Build the celebration copy (pure). Returns { title, body }.
 * @param {"milestone"|"goal"} subjectType
 */
function buildCelebration({
  subjectType,
  assistantName = "Chief of Staff",
  goalTitle = "",
  milestoneTitle = "",
  doneCount = 0,
  totalCount = 0,
}) {
  const title = `🎉 ${assistantName}`;
  if (subjectType === "goal") {
    return {
      title,
      body: `Goal achieved — “${goalTitle}”. That's a big one. 👏`,
    };
  }
  const pace =
    totalCount > 0 && doneCount >= totalCount
      ? "the final one — goal complete!"
      : totalCount > 0
        ? `${doneCount} of ${totalCount} — right on pace.`
        : "nicely done.";
  const label = milestoneTitle ? `“${milestoneTitle}” done` : "Milestone done";
  return { title, body: `${label} on “${goalTitle}”: ${pace}` };
}

/** The CEO user row (celebrations target). v1 is CEO-only, like accountability. */
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

/** Shared gate: resolve CEO + settings, honour celebrate_wins + quiet hours. */
async function celebrationContext() {
  const ceo = await findCeo();
  if (!ceo) return null;
  const s = (await settingsRepo.get({ user_id: ceo.user_id }).catch(() => null)) || settingsRepo.DEFAULTS;
  if (!s.celebrate_wins) return null;
  const hour = localHour(s.timezone || "Africa/Lagos");
  if (isQuietHour(hour, parseHour(s.quiet_start, 21), parseHour(s.quiet_end, 6))) return null;
  return { ceoId: ceo.user_id, settings: s };
}

async function send({ ceoId, brand, subjectType, subjectId, title, body, goalId }) {
  if (await repo.celebrationExists({ reference_type: subjectType, reference_id: subjectId }))
    return false;
  await notifications.notify({
    user_id: ceoId,
    business: brand,
    type: "cos_celebration",
    title,
    body,
    reference_type: subjectType,
    reference_id: subjectId,
    action_url: `/workspace?tab=goals${goalId ? `&goal=${goalId}` : ""}`,
  });
  await repo.logNudge({
    n: {
      user_id: ceoId,
      business: brand,
      type: "celebration",
      channel: "in_app",
      reference_type: subjectType,
      reference_id: subjectId,
    },
  });
  return true;
}

async function onMilestoneChanged({ brand, goal_id, milestone_id }) {
  try {
    if (!milestone_id) return;
    const m = await repo.findMilestoneById({ milestone_id });
    if (!m || m.status !== "done") return; // only celebrate the done transition
    const ctx = await celebrationContext();
    if (!ctx) return;
    const [goal, milestones] = await Promise.all([
      goalsRepo.findGoal({ brand, id: goal_id }),
      goalsRepo.listMilestones({ goal_id }),
    ]);
    const relevant = (milestones || []).filter((x) => x.status !== "skipped");
    const doneCount = relevant.filter((x) => x.status === "done").length;
    const { title, body } = buildCelebration({
      subjectType: "milestone",
      assistantName: ctx.settings.assistant_name,
      goalTitle: goal ? goal.title : "",
      milestoneTitle: m.title,
      doneCount,
      totalCount: relevant.length,
    });
    await send({
      ceoId: ctx.ceoId,
      brand,
      subjectType: "milestone",
      subjectId: milestone_id,
      title,
      body,
      goalId: goal_id,
    });
  } catch (err) {
    logger.warn({ err: err.message, milestone_id }, "cos celebration (milestone) failed");
  }
}

async function onGoalChanged({ brand, goal_id }) {
  try {
    if (!goal_id) return;
    const goal = await goalsRepo.findGoal({ brand, id: goal_id });
    if (!goal || goal.status !== "achieved") return;
    const ctx = await celebrationContext();
    if (!ctx) return;
    const { title, body } = buildCelebration({
      subjectType: "goal",
      assistantName: ctx.settings.assistant_name,
      goalTitle: goal.title,
    });
    await send({
      ceoId: ctx.ceoId,
      brand,
      subjectType: "goal",
      subjectId: goal_id,
      title,
      body,
      goalId: goal_id,
    });
  } catch (err) {
    logger.warn({ err: err.message, goal_id }, "cos celebration (goal) failed");
  }
}

let registered = false;
/** Subscribe to goals events (idempotent — registered in socket + worker). */
function registerCosCelebrations() {
  if (registered) return;
  registered = true;
  goalsEvents.on("milestone.updated", onMilestoneChanged);
  goalsEvents.on("goal.updated", onGoalChanged);
  logger.info("cos celebrations subscriber registered");
}

module.exports = {
  registerCosCelebrations,
  buildCelebration,
  // exposed for tests
  onMilestoneChanged,
  onGoalChanged,
};
