/**
 * Inbound webhook receivers (H-4 / R-3 / D-1).
 *
 * Each receiver:
 *   - Uses the raw body captured by the global JSON parser (req.rawBody) —
 *     required for HMAC verification over the exact bytes.
 *   - Delegates to webhooks.service.receive(): verify signature → persist to
 *     shared.webhook_log (deduped) → enqueue `webhook.received` on the outbox →
 *     respond fast (200 on accept, 401 on bad signature).
 * Actual processing happens post-commit in the outbox dispatcher (worker).
 *
 * Mounted at: /api/webhooks/*
 */

"use strict";

const express = require("express");
const router = express.Router();
const service = require("./webhooks.service");

function receiver(source) {
  return async (req, res, next) => {
    try {
      const r = await service.receive(source, {
        rawBody: req.rawBody || Buffer.from(JSON.stringify(req.body || {})),
        headers: req.headers,
        ip: req.ip,
      });
      res.status(r.status).json(r.body);
    } catch (err) {
      next(err);
    }
  };
}

// ── Payment gateways ──────────────────────────────────────
// GET probes for webhook URL validation (Nomba/Stripe/Paystack/Opay
// send a GET when you save the URL in their dashboard). Must return 200.
// NOTE: route paths must NOT contain literal \n characters — Express will
// register them as the Unicode character U+000A, not a path separator.
router.get("/paystack", (_req, res) => res.status(200).send("OK"));
router.get("/opay", (_req, res) => res.status(200).send("OK"));
router.get("/stripe", (_req, res) => res.status(200).send("OK"));
router.get("/nomba", (_req, res) => res.status(200).send("OK"));

router.post("/paystack", receiver("paystack"));
router.post("/opay", receiver("opay"));
router.post("/stripe", receiver("stripe"));
router.post("/nomba", receiver("nomba"));

// ── Meta (WhatsApp / Instagram): GET verify handshake + POST payload ──
router.get("/meta/whatsapp", async (req, res, next) => {
  try {
    const c = await service.metaChallenge("meta_whatsapp", req.query);
    if (c.ok) return res.status(200).send(String(c.challenge));
    return res.sendStatus(403);
  } catch (err) {
    next(err);
  }
});
router.post("/meta/whatsapp", receiver("meta_whatsapp"));

router.get("/meta/instagram", async (req, res, next) => {
  try {
    const c = await service.metaChallenge("meta_instagram", req.query);
    if (c.ok) return res.status(200).send(String(c.challenge));
    return res.sendStatus(403);
  } catch (err) {
    next(err);
  }
});
router.post("/meta/instagram", receiver("meta_instagram"));

// ── Inbound email (Cloudflare Email Routing → Email Worker → here) ─
// The Email Worker forwards parsed JSON: { to, from, subject, text,
// html, message_id, in_reply_to, attachments[] } signed with
// CF_EMAIL_INBOUND_SECRET (HMAC-SHA256 → x-cf-email-signature).
router.post("/email/inbound", receiver("cloudflare_email"));

// ── Logistics ─────────────────────────────────────────────
router.post("/chowdeck", receiver("chowdeck"));
router.post("/gigl", receiver("gigl"));

// ── Email delivery receipts (ESP → outbound comms ledger) ──
//
// One route per provider so each keeps its own source key in webhook_log
// (and its own row in the replay sweep). Configure the matching URL in the
// provider's dashboard — see docs/EMAIL_DELIVERY_RECEIPTS.md.
//
// Body parsing: Amazon SNS posts JSON under `Content-Type: text/plain`, which
// the global express.json() skips — so a raw parser runs first for anything it
// didn't claim. body-parser sets `req._body` when it has already parsed, so
// this is a no-op on the JSON providers and never double-reads the stream.
const rawAnyType = express.raw({ type: "*/*", limit: "5mb" });

function emailReceiptReceiver(provider) {
  const source = `email_${provider}`;
  return async (req, res, next) => {
    try {
      // Whichever parser ran, get back to the exact bytes the signature covers.
      const rawBody = Buffer.isBuffer(req.rawBody)
        ? req.rawBody
        : Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(JSON.stringify(req.body || {}));
      const r = await service.receive(source, {
        rawBody,
        headers: req.headers,
        ip: req.ip,
      });
      res.status(r.status).json(r.body);
    } catch (err) {
      next(err);
    }
  };
}

for (const provider of ["sendgrid", "mailgun", "postmark", "ses", "resend"]) {
  // GET probe: several dashboards validate the URL with a GET before saving.
  router.get(`/email/${provider}`, (_req, res) => res.status(200).send("OK"));
  router.post(`/email/${provider}`, rawAnyType, emailReceiptReceiver(provider));
}

module.exports = router;
