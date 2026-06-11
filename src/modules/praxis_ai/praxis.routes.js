/**
 * Praxis AI Agent (V2.2 §6.29) — routes. Mounted at /api/v1/praxis.
 * Permission key: praxis_ai. Conversations + messages, the human-in-the-loop
 * pending-action confirm gate, run-step trace, and the (ai_enabled) action
 * allowlist. AI Governance gates each turn; live LLM orchestration is the
 * agent runtime's job (src/ai).
 */

"use strict";

const express = require("express");
const c = require("./praxis.controller");
const v = require("./praxis.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("praxis_ai", action);

// ── Action catalogue (literal before /:id) ─────────────────
router.get("/actions", can("view"), c.listActions);

// ── Pending actions (confirm gate) ─────────────────────────
router.get("/pending-actions", can("view"), c.listPendingActions);
router.get("/pending-actions/:id", can("view"), c.getPendingAction);
router.post("/pending-actions/:id/confirm", can("approve"), c.confirmAction);
router.post(
  "/pending-actions/:id/reject",
  can("approve"),
  v.validateReason,
  c.rejectAction,
);

// ── Conversations ──────────────────────────────────────────
router.get("/conversations", can("view"), c.listConversations);
router.post(
  "/conversations",
  can("create"),
  v.validateConversationCreate,
  c.createConversation,
);
router.get("/conversations/:id", can("view"), c.getConversation);
router.delete("/conversations/:id", can("delete"), c.archiveConversation);
router.get("/conversations/:id/steps", can("view"), c.listRunSteps);
router.post(
  "/conversations/:id/messages",
  can("edit"),
  v.validateMessagePost,
  c.postMessage,
);

module.exports = router;
