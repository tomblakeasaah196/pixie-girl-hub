/**
 * Kaizen errors input schemas (Zod). ZodErrors → 400 with field detail via the
 * central error-handler.
 */

"use strict";

const { z } = require("zod");

const uuid = z.string().uuid();

const listQuery = z.object({
  status: z.enum(["open", "resolved", "ignored"]).optional(),
  severity: z.enum(["info", "warning", "error", "critical"]).optional(),
  source: z
    .enum([
      "backend",
      "worker",
      "admin",
      "storefront",
      "stylist",
      "landing",
      "kaizen",
      "unknown",
    ])
    .optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(30),
});

const groupIds = z.object({
  group_ids: z.array(uuid).min(1).max(500),
  note: z.string().max(2000).optional(),
});

// Frontend error ingest. Deliberately permissive on text (it's scrubbed
// server-side) but bounded in size, and the source is constrained.
const ingestClientError = z.object({
  source: z.enum(["admin", "storefront", "stylist", "landing", "kaizen"]),
  message: z.string().min(1).max(4000),
  stack: z.string().max(20000).optional(),
  route: z.string().max(500).optional(),
  app_version: z.string().max(80).optional(),
  severity: z.enum(["info", "warning", "error", "critical"]).optional(),
});

module.exports = { listQuery, groupIds, ingestClientError };
