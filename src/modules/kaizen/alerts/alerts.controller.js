/**
 * Kaizen alerts controller. Mounted (behind operator auth) at
 * /api/v1/kaizen/alerts.
 */

"use strict";

const express = require("express");
const service = require("./alerts.service");
const v = require("./alerts.validator");

const router = express.Router();

router.get("/", async (req, res) => {
  const qp = v.listQuery.parse(req.query);
  res.json(await service.list({ status: qp.status, page: qp.page, pageSize: qp.page_size }));
});

router.post("/:id/ack", async (req, res) => {
  const row = await service.acknowledge({
    alertId: req.params.id,
    operatorId: req.operator.operator_id,
    ip: req.ip,
  });
  res.json({ data: row });
});

// Rules
router.get("/rules", async (_req, res) => {
  res.json({ data: await service.listRules() });
});

router.patch("/rules/:id", async (req, res) => {
  const input = v.ruleUpdate.parse(req.body);
  const row = await service.updateRule({
    ruleId: req.params.id,
    input,
    operatorId: req.operator.operator_id,
    ip: req.ip,
  });
  res.json({ data: row });
});

module.exports = { router };
