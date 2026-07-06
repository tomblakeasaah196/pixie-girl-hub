/**
 * Search — validators.
 *
 * The command palette (⌘K) hits GET /api/v1/search with:
 *   q       required, 1..120 chars    the user's typed query
 *   types   optional, csv             restrict to these entity keys
 *   limit   optional, 1..10           results per entity type (default 5)
 *   scope   optional, all|brand       CEO cross-brand toggle (default brand)
 */

"use strict";

const { z } = require("zod");

const querySchema = z.object({
  q: z.string().trim().min(1).max(120),
  types: z
    .string()
    .trim()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
        : null,
    ),
  limit: z.coerce.number().int().min(1).max(10).optional().default(5),
  scope: z.enum(["brand", "all"]).optional().default("brand"),
});

module.exports = { querySchema };
