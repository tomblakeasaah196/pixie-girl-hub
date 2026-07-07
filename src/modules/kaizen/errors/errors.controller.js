/**
 * Kaizen errors controller — thin HTTP handlers.
 *
 * Exports two routers:
 *   - router:        operator-guarded (mounted under /api/v1/kaizen/errors,
 *                    behind kaizenAuthMiddleware). Browse / detail / resolve /
 *                    ignore / reopen / export.
 *   - ingestRouter:  PUBLIC (mounted under /api/v1/kaizen/ingest, NO operator
 *                    JWT). Guarded by a static ingest key + origin allowlist +
 *                    the shared publicWriteLimiter. Accepts structured error
 *                    text from the client apps; the payload is scrubbed
 *                    server-side before storage.
 */

"use strict";

const express = require("express");

const service = require("./errors.service");
const v = require("./errors.validator");
const { config } = require("../../../config/env");
const { AppError } = require("../../../utils/errors");
const { publicWriteLimiter } = require("../../../middleware");

// ── Operator router ──────────────────────────────────────────────────────────
const router = express.Router();

router.get("/", async (req, res) => {
  const qp = v.listQuery.parse(req.query);
  const result = await service.list({
    status: qp.status,
    severity: qp.severity,
    source: qp.source,
    q: qp.q,
    page: qp.page,
    pageSize: qp.page_size,
  });
  res.json(result);
});

// Export must be declared before '/:groupId' so 'export' isn't read as an id.
router.get("/export", async (req, res) => {
  const qp = v.listQuery.parse(req.query);
  const md = await service.exportMarkdown({
    status: qp.status,
    severity: qp.severity,
    source: qp.source,
    q: qp.q,
  });
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="kaizen-errors-${date}.md"`,
  );
  res.send(md);
});

router.get("/:groupId", async (req, res) => {
  const result = await service.getDetail({
    groupId: req.params.groupId,
    occPage: Number(req.query.occ_page) || 1,
    occPageSize: Number(req.query.occ_page_size) || 30,
  });
  res.json(result);
});

router.post("/resolve", async (req, res) => {
  const input = v.groupIds.parse(req.body);
  const rows = await service.resolve({
    groupIds: input.group_ids,
    note: input.note,
    operatorId: req.operator.operator_id,
    ip: req.ip,
  });
  res.json({ data: rows });
});

router.post("/ignore", async (req, res) => {
  const input = v.groupIds.parse(req.body);
  const rows = await service.ignore({
    groupIds: input.group_ids,
    operatorId: req.operator.operator_id,
    ip: req.ip,
  });
  res.json({ data: rows });
});

router.post("/reopen", async (req, res) => {
  const input = v.groupIds.parse(req.body);
  const rows = await service.reopen({
    groupIds: input.group_ids,
    operatorId: req.operator.operator_id,
    ip: req.ip,
  });
  res.json({ data: rows });
});

// ── Public ingest router ─────────────────────────────────────────────────────
const ingestRouter = express.Router();

function checkIngestAuth(req) {
  // Key must be configured AND match. If not configured, ingest is disabled.
  const expected = config.KAIZEN_INGEST_KEY;
  if (!expected) {
    throw new AppError("KAIZEN_INGEST_DISABLED", "Ingest not configured", 503);
  }
  const provided = req.headers["x-kaizen-ingest-key"];
  if (!provided || provided !== expected) {
    throw new AppError("KAIZEN_INGEST_FORBIDDEN", "Invalid ingest key", 403);
  }
  // Origin allowlist (when configured). Browsers always send Origin on CORS
  // POSTs; server-to-server callers without an Origin are allowed if the key
  // matches.
  const allowed = (config.KAIZEN_INGEST_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.origin;
  if (allowed.length && origin && !allowed.includes(origin)) {
    throw new AppError("KAIZEN_INGEST_ORIGIN", "Origin not allowed", 403);
  }
}

// 100 KB cap on the ingest body — plenty for an error + stack, no room for abuse.
ingestRouter.post(
  "/client-error",
  express.json({ limit: "100kb" }),
  publicWriteLimiter,
  async (req, res) => {
    checkIngestAuth(req);
    const input = v.ingestClientError.parse(req.body);
    // Fire-and-forget: acknowledge fast, persist in the background. A slow or
    // failing store must never make the client app's error handler hang.
    service
      .record({
        message: input.message,
        stack: input.stack || null,
        source: input.source,
        routePattern: input.route || null,
        severity: input.severity || "error",
        occurrence: {
          route: input.route || null,
          context: { app_version: input.app_version },
        },
      })
      .catch(() => {});
    res.status(202).json({ ok: true });
  },
);

module.exports = { router, ingestRouter };
