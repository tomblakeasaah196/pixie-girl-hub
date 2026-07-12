/**
 * Praxis AI Agent (V2.2 §6.29) — routes. Mounted at /api/v1/praxis.
 * Permission key: praxis_ai. Conversations + messages, the human-in-the-loop
 * pending-action confirm gate, run-step trace, and the (ai_enabled) action
 * allowlist. AI Governance gates each turn; live LLM orchestration is the
 * agent runtime's job (src/ai).
 */

"use strict";

const express = require("express");
const multer = require("multer");
const c = require("./praxis.controller");
const v = require("./praxis.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("praxis_ai", action);

// In-memory upload for training material (extracted + embedded, not served).
// 25 MB cap covers docs/PDFs/images; larger media should be linked, not uploaded.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// ── Action catalogue (literal before /:id) ─────────────────
router.get("/actions", can("view"), c.listActions);

// ── Voice transcription (§6.29) ────────────────────────────
// Whisper via the AI Control groq vendor (.env fallback). The composer checks
// /status to pick its mic mode; 503 on POST tells it to fall back to the
// browser recognizer. 15 MB ≈ well past the 5-minute recording cap at opus
// bitrates. CoS reuses this endpoint (CEO bypasses permission checks).
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});
router.get("/transcribe/status", can("view"), c.transcribeStatus);
router.post(
  "/transcribe",
  can("edit"),
  audioUpload.single("audio"),
  c.transcribeAudio,
);

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

// ── Self-learning (§8.5) ───────────────────────────────────
// Teach a durable fact/rule; rate an answer (a 👎 + correction from a trusted
// user becomes knowledge). CEO-gating for what actually enters the corpus is
// enforced in learning.service.
router.post("/teach", can("edit"), v.validateTeach, c.teach);
router.post(
  "/messages/:id/feedback",
  can("edit"),
  v.validateFeedback,
  c.recordFeedback,
);

// ── Training material (upload any media to teach Praxis) ────
// CEO-gating for what actually enters the corpus is enforced in learning.service.
router.get("/train/sources", can("view"), c.listTraining);
router.post(
  "/train/upload",
  can("edit"),
  upload.single("file"),
  c.uploadTraining,
);
router.delete("/train/sources/:id", can("edit"), c.deleteTraining);

module.exports = router;
