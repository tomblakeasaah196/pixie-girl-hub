"use strict";

const { z } = require("zod");

const runQuery = z.object({
  kind: z.enum(["logical_db", "logical_bundle", "full_volume"]).optional(),
  status: z.enum(["running", "success", "failed", "canceled"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(30),
});

const triggerSchema = z.object({
  kind: z.enum(["logical_bundle", "full_volume"]),
});

const destinationCreate = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["rclone", "local"]),
  rclone_remote: z.string().max(200).optional(),
  path_prefix: z.string().max(300).optional(),
  is_default: z.boolean().optional(),
});

const destinationUpdate = z.object({
  name: z.string().min(1).max(120).optional(),
  rclone_remote: z.string().max(200).optional(),
  path_prefix: z.string().max(300).optional(),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

module.exports = { runQuery, triggerSchema, destinationCreate, destinationUpdate };
