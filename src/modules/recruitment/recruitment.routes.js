/**
 * Recruitment routes.
 *
 * adminRouter  — mounted under the protected API at /api/v1/recruitment
 *                (auth + brand context applied upstream); gated on the
 *                `recruitment` permission module.
 * publicRouter — mounted at /api/public/offer (no auth). The candidate reaches
 *                it via the tokenised link emailed to them; the unguessable
 *                :token identifies the offer + e-sign signer.
 */

"use strict";

const express = require("express");
const controller = require("./recruitment.controller");
const validate = require("./recruitment.validator");
const vacancyController = require("./recruitment.vacancy.controller");
const vacancyValidate = require("./recruitment.vacancy.validator");
const { requirePermission } = require("../../middleware/rbac");

// Side-effect: register the sign→contract listener.
require("./recruitment.subscribers");

// ── Admin ──────────────────────────────────────────────────
const adminRouter = express.Router();
const P = (action) => requirePermission("recruitment", action);

// Company context pack (what the AI is grounded in).
adminRouter.get("/context", P("view"), controller.getContext);
adminRouter.put("/context/:business", P("edit"), validate.validateContext, controller.updateContext);

// Reusable role templates.
adminRouter.get("/templates", P("view"), controller.listTemplates);
adminRouter.post("/templates", P("create"), validate.validateTemplate, controller.createTemplate);
adminRouter.delete("/templates/:id", P("edit"), controller.deleteTemplate);

// Offers.
adminRouter.get("/offers", P("view"), controller.list);
adminRouter.post("/offers", P("create"), validate.validateDraft, controller.draft);
adminRouter.get("/offers/:id", P("view"), controller.get);
adminRouter.get("/offers/:id/rendered", P("view"), controller.rendered);
// Live-edit preview — accepts in-flight jd_markdown / offer_markdown drafts
// from the studio and returns the same packet HTML the PDF exporter uses,
// so the studio iframe is WYSIWYG. Never persists.
adminRouter.post("/offers/:id/preview", P("view"), controller.preview);
// Branded, page-numbered PDF (?doc=packet|jd|offer, ?download=1 to force save).
adminRouter.get("/offers/:id/pdf", P("export"), controller.exportPdf);
adminRouter.patch("/offers/:id", P("edit"), validate.validateEdit, controller.edit);
adminRouter.post("/offers/:id/regenerate", P("edit"), validate.validateRegenerate, controller.regenerate);
adminRouter.post("/offers/:id/send", P("approve"), validate.validateApprove, controller.approve);
adminRouter.post("/offers/:id/provision", P("approve"), validate.validateProvision, controller.provision);

// ── Vacancies (vacancy-first hiring) ───────────────────────
// Pickers for the create wizard (departments, positions, permission roles).
adminRouter.get("/vacancy-options", P("view"), vacancyController.options);
// Conversational intake — AI gap-filling follow-ups (hybrid scripted + AI).
adminRouter.post("/vacancies/intake/followups", P("create"), vacancyValidate.validateFollowups, vacancyController.followups);

adminRouter.get("/vacancies", P("view"), vacancyController.list);
adminRouter.post("/vacancies", P("create"), vacancyValidate.validateCreate, vacancyController.create);
adminRouter.get("/vacancies/:id", P("view"), vacancyController.get);
adminRouter.patch("/vacancies/:id", P("edit"), vacancyValidate.validateUpdate, vacancyController.update);
adminRouter.post("/vacancies/:id/status", P("approve"), vacancyValidate.validateStatus, vacancyController.setStatus);
adminRouter.delete("/vacancies/:id", P("edit"), vacancyController.remove);

// Screening questions (the AI rubric — internal only).
adminRouter.post("/vacancies/:id/questions/generate", P("edit"), vacancyController.generateQuestions);
adminRouter.get("/vacancies/:id/questions", P("view"), vacancyController.listQuestions);
adminRouter.put("/vacancies/:id/questions", P("edit"), vacancyValidate.validateAnswers, vacancyController.answerQuestions);

// Applications + pipeline.
adminRouter.get("/vacancies/:id/applications", P("view"), vacancyController.listApplications);
adminRouter.post("/vacancies/:id/applications", P("create"), vacancyValidate.validateApplication, vacancyController.addApplication);
adminRouter.post("/vacancies/:id/score-all", P("edit"), vacancyController.scoreAll);

adminRouter.get("/applications/:appId", P("view"), vacancyController.getApplication);
adminRouter.post("/applications/:appId/stage", P("edit"), vacancyValidate.validateStage, vacancyController.updateStage);
adminRouter.post("/applications/:appId/notes", P("edit"), vacancyValidate.validateNote, vacancyController.addNote);
adminRouter.put("/applications/:appId/rating", P("edit"), vacancyValidate.validateRating, vacancyController.setRating);
// Interview scorecard — rate a candidate on one screening question (1–5 stars).
adminRouter.put("/applications/:appId/questions/:questionId/rating", P("edit"), vacancyValidate.validateQuestionRating, vacancyController.setQuestionRating);
adminRouter.post("/applications/:appId/score", P("edit"), vacancyController.scoreApplication);
adminRouter.post("/applications/:appId/offer", P("approve"), vacancyController.moveToOffered);
// Stream a stored file (CV / headshot / cover letter / work image) to the admin.
adminRouter.get("/applications/:appId/file/:kind", P("view"), vacancyController.downloadFile);

// ── Public (no auth) ───────────────────────────────────────
const publicRouter = express.Router();
publicRouter.get("/:token", controller.publicGet);
// Candidate PDF download (?doc=packet|jd|offer, ?download=1 to force save) —
// available before and after signing; the signed packet carries their signature.
publicRouter.get("/:token/pdf", controller.publicExportPdf);
publicRouter.post("/:token/sign", validate.validateSign, controller.publicSign);

module.exports = { adminRouter, publicRouter };
