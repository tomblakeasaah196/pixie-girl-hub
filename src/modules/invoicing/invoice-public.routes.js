/**
 * Public invoice/receipt document surface (V2.2 §6.5). No auth — the links
 * are embedded in the customer's invoice email / WhatsApp / DM. The invoice
 * id is a UUIDv4, so the URL is unguessable; opening it stamps first_viewed
 * ("she received it") and serves the branded PDF.
 *
 *   Canonical (what customers actually open):
 *     GET /api/public/documents/invoice/:id → the invoice PDF (inline; phone
 *                                             browsers open their PDF viewer)
 *     GET /api/public/documents/receipt/:id → the receipt PDF
 *
 *   The `/api/` prefix is deliberate and load-bearing: every deployment in
 *   this repo proxies `/api/*` (and `/media/*`) to this Node app, while the
 *   rest of the host is served by nginx/SPA. A prettier `/i/<uuid>` root
 *   path would be swallowed by the SPA fallback on those hosts and show a
 *   customer a login page — which is the bug class this whole change fixes.
 *
 *   Short aliases (same handlers) for hosts that proxy everything to Node —
 *   Docker, local, and any vhost that adds the `ops/hub/nginx-document-links`
 *   snippet. The SPA also bounces /i|/r/<uuid> here, so a short link opened
 *   through an SPA-serving host still reaches the PDF.
 *     GET /i/:id   → the invoice PDF
 *     GET /r/:id   → the receipt PDF
 *
 *   Legacy (everything already emailed/DM'd before this change):
 *     GET /api/public/invoices/:brand/:id/view  → 301 the canonical URL
 *     GET /api/public/receipts/:brand/:id/view  → 301 the canonical URL
 */

"use strict";

const express = require("express");
const controller = require("./invoicing.controller");

// ── Canonical document links (inside the /api proxy every host forwards) ──
const documentRouter = express.Router();
documentRouter.get("/invoice/:id", controller.viewPublicInvoicePdf);
documentRouter.get("/receipt/:id", controller.viewPublicReceiptPdf);

// ── Short root aliases (Node-served hosts; see note above) ──
const shortDocumentRouter = express.Router();
shortDocumentRouter.get("/i/:id", controller.viewPublicInvoicePdf);
shortDocumentRouter.get("/r/:id", controller.viewPublicReceiptPdf);

// ── Legacy JSON view paths — now permanent redirects to the canonical
//    document links so nothing already in a customer's inbox or DM breaks.
const router = express.Router();

router.get("/:brand/:id/view", controller.viewPublicInvoice);

const receiptRouter = express.Router();
receiptRouter.get("/:brand/:id/view", controller.viewPublicReceipt);

module.exports = router;
module.exports.receiptRouter = receiptRouter;
module.exports.documentRouter = documentRouter;
module.exports.shortDocumentRouter = shortDocumentRouter;
