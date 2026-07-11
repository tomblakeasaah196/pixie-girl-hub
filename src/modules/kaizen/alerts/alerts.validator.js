"use strict";

const { z } = require("zod");

const listQuery = z.object({
  status: z.enum(["active", "acknowledged", "resolved"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(30),
});

const ruleUpdate = z.object({
  enabled: z.boolean().optional(),
  threshold: z.record(z.any()).optional(),
  channels: z.array(z.enum(["email", "in_dash"])).min(1).optional(),
});

module.exports = { listQuery, ruleUpdate };
