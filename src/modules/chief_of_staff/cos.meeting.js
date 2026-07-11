/**
 * Chief of Staff (PR5) — meeting intelligence (wow #4).
 *
 *   prep(eventId)   — assemble a MEETING PREP BRIEF for a calendar event: the
 *                     linked goal's status, its open milestones, recent linked
 *                     notes, the participants (users + contacts), and a short
 *                     list of "open questions" worth raising. Deterministic —
 *                     it reads real Workspace data, so it renders even with no
 *                     AI vendor configured.
 *
 * Voice brain-dump → goal and decision capture reuse the EXISTING turn:
 * transcription.service already runs at the top of cos.service.postMessage, so a
 * voice note flows through the same planner into a batch plan; notes/decisions
 * the plan creates are indexed into memory by the goals→memory subscriber. No
 * new transport here.
 */

"use strict";

const calendarRepo = require("../../shared/calendar/calendar.repo");
const goalsRepo = require("../../shared/goals/goals.repo");
const notesRepo = require("../../shared/goals/notes.repo");
const accountabilityRepo = require("./cos.accountability.repo");
const { NotFoundError } = require("../../utils/errors");

const todayIso = () => new Date().toISOString().slice(0, 10);
const excerpt = (s, n = 180) =>
  s === null || s === undefined ? "" : String(s).replace(/\s+/g, " ").slice(0, n);

/** Deterministic "things worth raising" derived from the goal's real state. */
function deriveOpenQuestions({ goal, milestones, followups }) {
  const q = [];
  if (!goal) {
    q.push("This meeting isn't linked to a goal yet — attach one to track outcomes.");
    return q;
  }
  if (goal.health === "at_risk" || goal.health === "behind") {
    q.push(`Goal “${goal.title}” is ${goal.health} at ${goal.progress_pct ?? 0}% — agree a recovery step.`);
  }
  const today = todayIso();
  for (const m of milestones) {
    if (["done", "skipped"].includes(m.status)) continue;
    if (m.target_date && String(m.target_date).slice(0, 10) < today) {
      q.push(`Milestone “${m.title}” was due ${String(m.target_date).slice(0, 10)} and is still ${m.status}.`);
    }
  }
  for (const f of followups || []) {
    if (f.question) q.push(f.question);
  }
  if (!q.length) q.push(`Confirm next steps toward “${goal.title}” (${goal.progress_pct ?? 0}% done).`);
  return q.slice(0, 6);
}

async function prep({ user, brand, event_id }) {
  const event = await calendarRepo.findEvent({ brand, id: event_id });
  if (!event) throw new NotFoundError("Event");

  const participantsRaw = await calendarRepo.listParticipants({ event_id });
  const participants = participantsRaw.map((p) => ({
    participant_id: p.participant_id,
    name: p.user_name || p.contact_name || "Guest",
    email: p.user_email || null,
    is_organiser: !!p.is_organiser,
    status: p.status,
    kind: p.user_id ? "user" : "contact",
  }));

  let goal = null;
  let milestones = [];
  let notes = [];
  let followups = [];
  if (event.goal_id) {
    goal = await goalsRepo.findGoal({ brand, id: event.goal_id });
    if (goal) {
      const pct = await goalsRepo.recomputeProgress({ goal_id: event.goal_id });
      if (pct !== null) goal.progress_pct = pct;
      const [ms, notePage, fups] = await Promise.all([
        goalsRepo.listMilestones({ goal_id: event.goal_id }),
        notesRepo.listNotes({ brand, user_id: user.user_id, goal_id: event.goal_id, page: 1, page_size: 5 }),
        accountabilityRepo.listOpenFollowups({ user_id: user.user_id, subject_type: "goal", subject_id: event.goal_id }),
      ]);
      milestones = ms;
      notes = (notePage.data || []).map((n) => ({
        note_id: n.note_id,
        title: n.title,
        excerpt: excerpt(n.body),
        created_at: n.created_at,
      }));
      followups = fups || [];
    }
  }

  return {
    event: {
      event_id: event.event_id,
      title: event.title,
      event_type: event.event_type,
      start_at: event.start_at,
      end_at: event.end_at,
      location: event.location,
    },
    goal: goal
      ? {
          goal_id: goal.goal_id,
          title: goal.title,
          status: goal.status,
          health: goal.health,
          progress_pct: goal.progress_pct ?? 0,
          target_date: goal.target_date,
        }
      : null,
    open_milestones: milestones
      .filter((m) => !["done", "skipped"].includes(m.status))
      .map((m) => ({ milestone_id: m.milestone_id, title: m.title, status: m.status, target_date: m.target_date })),
    recent_notes: notes,
    participants,
    open_questions: deriveOpenQuestions({ goal, milestones, followups }),
  };
}

module.exports = { prep, deriveOpenQuestions };
