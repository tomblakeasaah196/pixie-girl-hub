/**
 * Goals (Chief of Staff, PR1) — cross-module event subscriber.
 *
 * A task's status can change from the Tasks board (tasks.service), which knows
 * nothing about goals. This relay listens to the tasks domain events and, when
 * the changed task is linked to a goal, refreshes that goal's cached progress.
 * Dependency direction stays correct: goals depend on tasks events, never the
 * reverse.
 *
 * Registered once during socket init (API process) and startWorkers
 * (worker / in-process dev), mirroring the *-realtime relays. Idempotent.
 */

"use strict";

const tasksEvents = require("../tasks/tasks.events");
const goalsService = require("./goals.service");

let registered = false;

function registerGoalsSubscribers() {
  if (registered) return;
  registered = true;

  const onTask = ({ brand, task_id }) => {
    // Fire-and-forget; recomputeForTask swallows its own errors.
    goalsService.recomputeForTask({ brand, task_id });
  };

  tasksEvents.on("task.status_changed", onTask);
  tasksEvents.on("task.created", onTask);
}

module.exports = { registerGoalsSubscribers };
