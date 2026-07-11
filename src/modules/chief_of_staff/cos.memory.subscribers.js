/**
 * Chief of Staff (PR5) — RAG memory subscribers.
 *
 * Listens to the goals/notes domain events and keeps the CoS semantic memory in
 * step: (re)index a goal when it or a milestone changes, re-index a note when it
 * changes, forget on delete. Registered once during socket init (API) and
 * startWorkers (worker / in-process dev), mirroring goals.subscribers. Idempotent.
 *
 * Gated on an embeddings provider being configured — with RAG dormant (the
 * default) there is nothing to search, so we skip the writes entirely; the CoS
 * memory-query path falls back to live goal data regardless.
 */

"use strict";

const goalsEvents = require("../../shared/goals/goals.events");
const goalsRepo = require("../../shared/goals/goals.repo");
const notesRepo = require("../../shared/goals/notes.repo");
const memory = require("./cos.memory");
const { logger } = require("../../config/logger");

let registered = false;

async function reindexGoal({ brand, goal_id }) {
  if (!memory.isEnabled()) return;
  try {
    const goal = await goalsRepo.findGoal({ brand, id: goal_id });
    if (!goal) return;
    const milestones = await goalsRepo.listMilestones({ goal_id });
    await memory.indexGoal({ goal, milestones, brand });
  } catch (err) {
    logger.debug({ err: err.message, goal_id }, "cos memory: goal reindex skipped");
  }
}

async function reindexNote({ brand, note_id, user_id }) {
  if (!memory.isEnabled() || !user_id) return;
  try {
    const note = await notesRepo.findNote({ brand, user_id, id: note_id });
    if (!note || note.is_deleted) {
      await memory.forgetNote({ note_id });
      return;
    }
    let goalTitle;
    if (note.goal_id) {
      const g = await goalsRepo.findGoal({ brand, id: note.goal_id });
      goalTitle = g && g.title;
    }
    await memory.indexNote({ note, goalTitle, brand });
  } catch (err) {
    logger.debug({ err: err.message, note_id }, "cos memory: note reindex skipped");
  }
}

function registerCosMemorySubscribers() {
  if (registered) return;
  registered = true;

  const onGoal = (p) => reindexGoal(p);
  goalsEvents.on("goal.created", onGoal);
  goalsEvents.on("goal.updated", onGoal);
  goalsEvents.on("milestone.created", onGoal);
  goalsEvents.on("milestone.updated", onGoal);
  goalsEvents.on("goal.deleted", ({ goal_id }) => memory.forgetGoal({ goal_id }));
  goalsEvents.on("note.created", (p) => reindexNote(p));
  goalsEvents.on("note.updated", (p) => reindexNote(p));

  logger.info("cos memory subscribers registered");
}

module.exports = { registerCosMemorySubscribers };
