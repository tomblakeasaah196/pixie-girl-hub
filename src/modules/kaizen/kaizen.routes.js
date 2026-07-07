/**
 * Kaizen router — mounts all Kaizen sub-routers under /api/v1/kaizen.
 *
 * Kaizen is the JBS Praxis maintenance/ops console (kaizen.pixiegirlglobal.com).
 * Auth boundary: everything except /auth (login/refresh/logout/accept-invite)
 * is behind kaizenAuthMiddleware — a platform (shared.users) token can never
 * satisfy it (separate secret + `aud: "kaizen"`).
 *
 * Phase 0 surface: auth + operators + a small system summary. Later phases add
 * errors, health, performance, backups and alerts (see the implementation
 * guide). The frontend already lays those out as "coming soon".
 */

"use strict";

const express = require("express");

const { kaizenAuthMiddleware } = require("./auth/kaizen-auth.middleware");
const authController = require("./auth/kaizen-auth.controller");
const operatorsController = require("./operators/operators.controller");

const START_TIME = Date.now();

function mountKaizen(app) {
  const r = express.Router();

  // Public (no operator JWT): login / refresh / logout / accept-invite.
  // (Note: /auth/me and /auth/change-password apply the operator middleware
  //  internally.)
  r.use("/auth", authController.router);

  // Everything below requires an active operator.
  r.use(kaizenAuthMiddleware);

  r.use("/operators", operatorsController.router);

  // Lightweight system summary for the Overview screen.
  r.get("/system/summary", async (req, res) => {
    const pkg = require("../../../package.json");
    res.json({
      data: {
        version: pkg.version,
        node: process.version,
        env: process.env.NODE_ENV || "development",
        uptime_s: Math.floor((Date.now() - START_TIME) / 1000),
        server_time: new Date().toISOString(),
        operator: req.operator,
      },
    });
  });

  app.use("/api/v1/kaizen", r);
}

module.exports = { mountKaizen };
