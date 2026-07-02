/**
 * Stylist Partner Programme (V2.2 §6.26) — ADMIN routes. Mounted at
 * /api/v1/stylists under staff auth + brand context. Permission key:
 * stylist_programme.
 *
 * Requiring the subscribers here registers the production → assignment
 * routing connection once at boot (side-effect import).
 */

"use strict";

const express = require("express");
const c = require("./stylist.controller");
const v = require("./stylist.validator");
const { requirePermission } = require("../../middleware/rbac");
require("./stylist.subscribers");

const router = express.Router();
const can = (action) => requirePermission("stylist_programme", action);

// ── Applications & vetting (Q5–Q8) — literal segments before /:id ───
router.get("/applications/all", can("view"), c.listApplications);
router.get("/applications/:id", can("view"), c.getApplication);
router.post(
  "/applications/:id/review",
  can("edit"),
  v.validateVettingReview,
  c.addVettingReview,
);
router.post(
  "/applications/:id/decision",
  can("approve"),
  v.validateApplicationDecision,
  c.decideApplication,
);

// ── Programme configuration (tiers D-2, questionnaire Q6, knobs) ───
router.get("/config/programme", can("view"), c.getConfig);
router.patch(
  "/config/programme",
  can("approve"),
  v.validateConfigPatch,
  c.updateConfig,
);
router.get("/config/tiers", can("view"), c.listTiers);
router.patch(
  "/config/tiers/:tier_key",
  can("approve"),
  v.validateTierPatch,
  c.updateTier,
);
router.get("/config/questions", can("view"), c.listQuestions);
router.post(
  "/config/questions",
  can("edit"),
  v.validateQuestionCreate,
  c.createQuestion,
);
router.patch(
  "/config/questions/:question_id",
  can("edit"),
  v.validateQuestionPatch,
  c.updateQuestion,
);

// ── Smart routing (Q13) ────────────────────────────────────
router.get("/routing/suggest", can("view"), c.routingSuggest);

// ── Verified reviews (Q15) + referrals ledger (Q17) ────────
router.get("/reviews/all", can("view"), c.listReviews);
router.post(
  "/reviews/:assignment_id/visibility",
  can("edit"),
  v.validateReviewVisibility,
  c.setReviewVisibility,
);
router.get("/referrals/all", can("view"), c.listReferralAttributions);

// ── Assignments (routing) — literal segments before /:id ───
router.get("/assignments/all", can("view"), c.listAssignments);
router.post(
  "/assignments",
  can("create"),
  v.validateAssignmentOpen,
  c.openAssignment,
);
router.get("/assignments/:id", can("view"), c.getAssignment);
router.post(
  "/assignments/:id/cancel",
  can("edit"),
  v.validateReason,
  c.cancelAssignment,
);
router.post(
  "/assignments/:id/rate",
  can("edit"),
  v.validateRating,
  c.rateAssignment,
);
router.post(
  "/assignments/:id/offers",
  can("edit"),
  v.validateAddOffers,
  c.addOffers,
);
router.post(
  "/assignments/:id/dispute",
  can("edit"),
  v.validateDispute,
  c.disputeAssignment,
);

// ── Payouts ────────────────────────────────────────────────
router.get("/payouts/all", can("view"), c.listPayouts);
router.post(
  "/payouts",
  can("create"),
  v.validatePayoutGenerate,
  c.generatePayout,
);
router.get("/payouts/:id", can("view"), c.getPayout);
router.post("/payouts/:id/submit", can("edit"), c.submitPayout);
router.post("/payouts/:id/approve", can("approve"), c.approvePayout);
router.post(
  "/payouts/:id/paid",
  can("approve"),
  v.validatePaid,
  c.markPayoutPaid,
);

// ── Partners ───────────────────────────────────────────────
router.get("/", can("view"), c.listPartners);
router.post("/", can("create"), v.validatePartnerCreate, c.createPartner);
router.get("/:id", can("view"), c.getPartner);
router.patch("/:id", can("edit"), v.validatePartnerUpdate, c.updatePartner);
router.post("/:id/status", can("edit"), v.validateStatusChange, c.setStatus);
router.post("/:id/badge", can("edit"), c.issueBadge);
router.delete("/:id/badge", can("edit"), c.revokeBadge);
router.post("/:id/invite", can("edit"), c.invitePartner);
router.post("/:id/contract", can("edit"), c.sendContract);

// ── Specialities ───────────────────────────────────────────
router.get("/:id/specialities", can("view"), c.listSpecialities);
router.post(
  "/:id/specialities",
  can("edit"),
  v.validateSpecialitySet,
  c.setSpeciality,
);
router.delete(
  "/:id/specialities/:speciality_id",
  can("edit"),
  c.removeSpeciality,
);

// ── Certifications ─────────────────────────────────────────
router.get("/:id/certifications", can("view"), c.listCertifications);
router.post(
  "/:id/certifications",
  can("approve"),
  v.validateCertAward,
  c.awardCertification,
);
router.delete(
  "/:id/certifications/:certification_id",
  can("approve"),
  v.validateReason,
  c.revokeCertification,
);

module.exports = router;
