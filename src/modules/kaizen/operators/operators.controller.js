/**
 * Kaizen operators controller. Mounted (behind operator auth) at
 * /api/v1/kaizen/operators.
 */

"use strict";

const express = require("express");

const service = require("./operators.service");
const v = require("./operators.validator");

const router = express.Router();

router.get("/", async (_req, res) => {
  res.json({ data: await service.list() });
});

router.post("/invite", async (req, res) => {
  const input = v.inviteSchema.parse(req.body);
  const result = await service.invite({
    email: input.email,
    displayName: input.display_name,
    invitedBy: req.operator.operator_id,
    ip: req.ip,
  });
  res.status(201).json({ data: result });
});

// Destructive → guarded (requires { confirm: true }).
router.post("/:id/disable", async (req, res) => {
  v.disableSchema.parse(req.body);
  const result = await service.disable({
    operatorId: req.params.id,
    actorId: req.operator.operator_id,
    ip: req.ip,
  });
  res.json({ data: result });
});

module.exports = { router };
