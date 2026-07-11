/**
 * Kaizen backups controller. Mounted (behind operator auth) at
 * /api/v1/kaizen/backups. Triggers/reruns enqueue to the worker and return
 * immediately; progress streams via Socket.io (Phase 5). All mutations audited
 * in the service.
 */

"use strict";

const express = require("express");
const service = require("./backups.service");
const v = require("./backups.validator");

const router = express.Router();

// Dashboard summary — last success per kind, storage free, retention, schedule.
router.get("/status", async (_req, res) => {
  res.json({ data: await service.status() });
});

router.get("/runs", async (req, res) => {
  const qp = v.runQuery.parse(req.query);
  res.json(
    await service.listRuns({
      kind: qp.kind,
      status: qp.status,
      page: qp.page,
      pageSize: qp.page_size,
    }),
  );
});

router.get("/runs/:id", async (req, res) => {
  res.json({ data: await service.getRun(req.params.id) });
});

// Manual trigger → enqueues a job.
router.post("/run", async (req, res) => {
  const input = v.triggerSchema.parse(req.body);
  const result = await service.trigger({
    kind: input.kind,
    operatorId: req.operator.operator_id,
    ip: req.ip,
  });
  res.status(202).json({ data: result });
});

// Re-run a failed backup.
router.post("/runs/:id/rerun", async (req, res) => {
  const result = await service.rerun({
    runId: req.params.id,
    operatorId: req.operator.operator_id,
    ip: req.ip,
  });
  res.status(202).json({ data: result });
});

// Restore drills — history + manual run (creates a scratch DB, never touches prod).
router.get("/drills", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Math.min(Number(req.query.page_size) || 20, 100);
  res.json(await service.listDrills({ page, pageSize }));
});

router.post("/drills/run", async (req, res) => {
  const result = await service.triggerDrill({
    operatorId: req.operator.operator_id,
    ip: req.ip,
  });
  res.status(202).json({ data: result });
});

// Destinations (no secrets ever pass through here).
router.get("/destinations", async (_req, res) => {
  res.json({ data: await service.listDestinations() });
});

router.post("/destinations", async (req, res) => {
  const input = v.destinationCreate.parse(req.body);
  const d = await service.createDestination({
    input,
    operatorId: req.operator.operator_id,
    ip: req.ip,
  });
  res.status(201).json({ data: d });
});

router.patch("/destinations/:id", async (req, res) => {
  const input = v.destinationUpdate.parse(req.body);
  const d = await service.updateDestination({
    id: req.params.id,
    input,
    operatorId: req.operator.operator_id,
    ip: req.ip,
  });
  res.json({ data: d });
});

module.exports = { router };
