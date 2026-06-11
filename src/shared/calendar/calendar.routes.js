/**
 * Calendar (V2.2 §6.18) — routes. Mounted at /api/v1/calendar.
 * Permission key: calendar. One shared calendar per business; events may
 * reference other modules' dated records.
 */

"use strict";

const express = require("express");
const c = require("./calendar.controller");
const v = require("./calendar.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("calendar", action);

router.get("/", can("view"), c.listEvents);
router.get("/by-reference", can("view"), c.listForReference);
router.post("/", can("create"), v.validateEventCreate, c.createEvent);
router.get("/:id", can("view"), c.getEvent);
router.patch("/:id", can("edit"), v.validateEventUpdate, c.updateEvent);
router.delete("/:id", can("delete"), c.deleteEvent);

router.post(
  "/:id/participants",
  can("edit"),
  v.validateParticipantAdd,
  c.addParticipant,
);
router.post(
  "/:id/participants/:participant_id/respond",
  can("edit"),
  v.validateParticipantResponse,
  c.respondParticipant,
);
router.delete(
  "/:id/participants/:participant_id",
  can("edit"),
  c.removeParticipant,
);

module.exports = router;
