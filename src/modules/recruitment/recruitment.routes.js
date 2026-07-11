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
adminRouter.post("/offers/:id/provision", P("approve"), controller.provision);

// ── Public (no auth) ───────────────────────────────────────
const publicRouter = express.Router();
publicRouter.get("/:token", controller.publicGet);
publicRouter.post("/:token/sign", validate.validateSign, controller.publicSign);

module.exports = { adminRouter, publicRouter };
