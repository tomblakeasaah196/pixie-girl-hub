/**
 * Tasks (V2.2 §6.19) — routes. Mounted at /api/v1/tasks.
 * Permission key: tasks. Manual + auto-raised (trigger) tasks, assignment,
 * status board, subtasks. `?assigned_to=me` scopes to the caller.
 */

"use strict";

const express = require("express");
const c = require("./tasks.controller");
const v = require("./tasks.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("tasks", action);

router.get("/", can("view"), c.listTasks);
router.get("/board", can("view"), c.getBoard);
router.post("/", can("create"), v.validateTaskCreate, c.createTask);
router.get("/:id", can("view"), c.getTask);
router.patch("/:id", can("edit"), v.validateTaskUpdate, c.updateTask);
router.post("/:id/status", can("edit"), v.validateStatusChange, c.changeStatus);
router.delete("/:id", can("delete"), c.deleteTask);

router.post("/:id/subtasks", can("edit"), v.validateSubtaskAdd, c.addSubtask);
router.post(
  "/:id/subtasks/:subtask_id/toggle",
  can("edit"),
  v.validateSubtaskToggle,
  c.setSubtaskDone,
);
router.delete("/:id/subtasks/:subtask_id", can("edit"), c.deleteSubtask);

module.exports = router;
