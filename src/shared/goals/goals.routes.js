/**
 * Goals (Chief of Staff, PR1) — routes. Mounted at /api/v1/goals.
 * Permission key: goals. Goals, milestones, stakeholders, and linking of
 * existing tasks/calendar events. Notes have their own router (notes.routes).
 */

"use strict";

const express = require("express");
const c = require("./goals.controller");
const v = require("./goals.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("goals", action);

// Goals
router.get("/", can("view"), c.listGoals);
router.post("/", can("create"), v.validateGoalCreate, c.createGoal);
router.get("/:id", can("view"), c.getGoal);
router.patch("/:id", can("edit"), v.validateGoalUpdate, c.updateGoal);
router.delete("/:id", can("delete"), c.deleteGoal);

// Milestones
router.post("/:id/milestones", can("edit"), v.validateMilestoneAdd, c.addMilestone);
router.patch("/:id/milestones/:mid", can("edit"), v.validateMilestoneUpdate, c.updateMilestone);
router.delete("/:id/milestones/:mid", can("edit"), c.deleteMilestone);

// Stakeholders
router.post("/:id/stakeholders", can("edit"), v.validateStakeholderAdd, c.addStakeholder);
router.delete("/:id/stakeholders/:sid", can("edit"), c.removeStakeholder);

// Link / unlink existing tasks & calendar events
router.post("/:id/tasks/:taskId/link", can("edit"), v.validateLink, c.linkTask);
router.delete("/:id/tasks/:taskId/link", can("edit"), c.unlinkTask);
router.post("/:id/events/:eventId/link", can("edit"), v.validateLink, c.linkEvent);
router.delete("/:id/events/:eventId/link", can("edit"), c.unlinkEvent);

module.exports = router;
