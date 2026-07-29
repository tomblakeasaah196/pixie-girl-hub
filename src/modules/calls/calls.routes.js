/**
 * WhatsApp Calls — routes. Mounted at /api/v1/calls.
 *
 * Gated by the `smartcomm` permission key: calls are part of the same
 * Messaging surface as the WhatsApp inbox they land in (same precedent
 * as whatsapp-templates riding messaging_accounts — no new RBAC module).
 * The finer per-user × per-platform gate (smartcomm_platform_permissions,
 * whatsapp / reply) is enforced in the service layer, so an agent who can
 * read the inbox but not reply on WhatsApp cannot answer calls either.
 */

"use strict";

const express = require("express");
const c = require("./calls.controller");
const v = require("./calls.validator");
const { requirePermission } = require("../../middleware/rbac");

// Side-effects: durable webhook.received consumer + realtime relays + the
// out-of-app ring push. Order matters only in spirit — the socket relay is
// registered first so the in-app ring is always the first thing to fire.
require("./calls.subscribers");
require("./calls.realtime");
require("./calls.push");

const router = express.Router();
const can = (action) => requirePermission("smartcomm", action);

// ── Call log / history ─────────────────────────────────────
router.get("/", can("view"), c.list);
// Live-ring reconciliation — MUST stay above /:id or "ringing" is parsed as a
// call id. Answers "what should I be ringing for?" after a socket gap.
router.get("/ringing", can("view"), c.ringing);
router.get("/:id", can("view"), c.get);

// ── Live call actions ──────────────────────────────────────
// claim → (browser builds SDP answer) → accept. Split on purpose: the
// claim must be atomic and instant so losing agents stop ringing, while
// WebRTC negotiation takes a beat longer.
router.post("/:id/claim", can("edit"), c.claim);
router.post("/:id/accept", can("edit"), v.validateAccept, c.accept);
router.post("/:id/reject", can("edit"), c.reject);
router.post("/:id/hangup", can("edit"), c.hangup);

// ── Post-call disposition (mandatory in the UI) ────────────
router.post("/:id/outcome", can("edit"), v.validateOutcome, c.outcome);

module.exports = router;
