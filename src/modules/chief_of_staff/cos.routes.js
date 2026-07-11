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

module.exports = router;
