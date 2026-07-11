/**
 * Chief of Staff (PR3) — routes. Mounted at /api/v1/cos.
 *
 * CEO-only for v1 (requireCeo). The scoped catalogue (surface='workspace') and
 * the 'cos_chat' governance feature are the runtime gates; the plan executor
 * re-enters the real endpoints over loopback AS the CEO, so RBAC re-applies on
 * every write. Praxis is untouched — CoS is a separate persona on /cos.
 */

"use strict";

const express = require("express");
const c = require("./cos.controller");
const v = require("./cos.validator");
const { AppError } = require("../../utils/errors");

const router = express.Router();

// v1 audience gate: CoS is the CEO's assistant only. The `goals` permission
// module exists so this can open to execs later without a rework (§Appendix C).
function requireCeo(req, _res, next) {
  if (req.user && req.user.is_ceo) return next();
  next(
    new AppError("FORBIDDEN", "The Chief of Staff is available to the CEO only.", 403, {
      user_message: "The Chief of Staff isn't available for your role yet.",
    }),
  );
}
router.use(requireCeo);

// ── Conversations ──────────────────────────────────────────
router.get("/conversations", c.listConversations);
router.post("/conversations", v.validateConversationCreate, c.createConversation);
router.get("/conversations/:id", c.getConversation);
router.delete("/conversations/:id", c.archiveConversation);
router.post("/conversations/:id/messages", v.validateMessagePost, c.postMessage);

// ── Plans (batch-plan approval) ────────────────────────────
router.get("/plans/:planId", c.getPlan);
router.post("/plans/:planId/confirm", c.confirmPlan);
router.post("/plans/:planId/reject", v.validateReason, c.rejectPlan);

// ── Follow-ups (accountability state machine, PR4) ─────────
router.get("/followups", c.listFollowups);
router.post("/followups/:id/respond", v.validateFollowupRespond, c.respondFollowup);
router.post("/followups/:id/reason", v.validateReason, c.reasonFollowup);
router.post("/followups/:id/act", v.validateFollowupAct, c.actFollowup);
router.post("/followups/:id/snooze", v.validateFollowupSnooze, c.snoozeFollowup);
router.post("/followups/:id/dismiss", c.dismissFollowup);

// ── Intelligence (PR5) ─────────────────────────────────────
// Meeting prep brief for a calendar event.
router.get("/prep/:eventId", c.getPrep);

// Smart scheduling & focus protection.
router.post("/schedule/focus", v.validateScheduleFocus, c.findFocus);
router.get("/schedule/load", c.scheduleLoad);
router.post("/schedule/reschedule", v.validateScheduleReschedule, c.batchReschedule);

// Cross-brand command (already behind requireCeo above).
router.get("/cross-brand/overview", c.crossBrandOverview);

// Playbook templates.
router.get("/templates", c.listTemplates);
router.post("/templates", v.validateTemplateSave, c.saveTemplate);
router.post("/templates/:id/instantiate", v.validateTemplateInstantiate, c.instantiateTemplate);

module.exports = router;
