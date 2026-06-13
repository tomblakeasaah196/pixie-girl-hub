/**
 * Walk-in self-registration routes (F-16).
 *
 * publicRouter — mounted at /api/public/walk-in (no auth) with the public write
 *                throttle; the scanned QR opens a form that POSTs here.
 * adminRouter  — mounted under the protected API; generates the per-brand QR.
 */

"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./walkin.service");
const { requirePermission } = require("../../middleware/rbac");

const registerSchema = z
  .object({
    brand: z.string().min(1).max(60),
    display_name: z.string().max(160).optional(),
    first_name: z.string().max(80).optional(),
    last_name: z.string().max(80).optional(),
    primary_phone: z.string().min(7).max(32).optional(),
    email: z.string().email().optional(),
  })
  .strict();

// ── Public registration ───────────────────────────────────
const publicRouter = express.Router();
publicRouter.post("/", async (req, res) => {
  const input = registerSchema.parse(req.body || {});
  const result = await service.registerWalkIn({
    brand: input.brand,
    input,
  });
  res.status(201).json({ data: result });
});

// ── Admin QR generation ────────────────────────────────────
const adminRouter = express.Router();
adminRouter.get("/qr", requirePermission("crm", "view"), async (req, res) => {
  const result = await service.generateQr({
    brand: req.brand,
    location: req.query.location,
  });
  res.json({ data: result });
});

module.exports = { publicRouter, adminRouter };
