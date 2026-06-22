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

const addressSchema = z
  .object({
    line1: z.string().min(1).max(200),
    line2: z.string().max(200).optional(),
    area: z.string().max(120).optional(),
    city: z.string().max(80).optional(),
    state: z.string().max(80).optional(),
    country: z.string().max(80).optional(),
    country_code: z.string().max(4).optional(),
    postal_code: z.string().max(20).optional(),
    landmark: z.string().max(200).optional(),
    google_maps_url: z.string().url().max(2000).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .strict();

const registerSchema = z
  .object({
    brand: z.string().min(1).max(60),
    display_name: z.string().max(160).optional(),
    first_name: z.string().max(80).optional(),
    last_name: z.string().max(80).optional(),
    primary_phone: z.string().min(7).max(32).optional(),
    whatsapp_number: z.string().max(32).optional(),
    email: z.string().email().optional(),
    dob_day: z.number().int().min(1).max(31).optional(),
    dob_month: z.number().int().min(1).max(12).optional(),
    address: addressSchema.optional(),
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
