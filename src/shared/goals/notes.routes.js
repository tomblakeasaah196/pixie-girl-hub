/**
 * Workspace Notes (Chief of Staff, PR1) — routes. Mounted at /api/v1/notes.
 * Permission key: goals (notes ride under the goals module). Owner-scoped.
 */

"use strict";

const express = require("express");
const c = require("./notes.controller");
const v = require("./notes.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("goals", action);

router.get("/", can("view"), c.listNotes);
router.post("/", can("create"), v.validateNoteCreate, c.createNote);
router.get("/:id", can("view"), c.getNote);
router.patch("/:id", can("edit"), v.validateNoteUpdate, c.updateNote);
router.delete("/:id", can("delete"), c.deleteNote);

module.exports = router;
