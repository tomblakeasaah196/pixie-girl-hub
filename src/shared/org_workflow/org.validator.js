/**
 * Organisation & Workflow Builder (V2.2 §6.27)
 * Input validators — Zod schemas wrapped in Express middleware.
 *
 * Covers the two writable resources of the Org Builder: org_units (the tree)
 * and org_positions (the approval-authority graph). `business` is never taken
 * from the body — it comes from brand context.
 */

"use strict";

const { z } = require("zod");

const uuid = z.string().uuid();
const unitKey = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9_]+$/, "unit_key must be snake_case (a-z, 0-9, _)");
const positionKey = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9_]+$/, "position_key must be snake_case (a-z, 0-9, _)");

// ── org_units ──────────────────────────────────────────────
const unitCreateSchema = z.object({
  unit_key: unitKey,
  display_name: z.string().min(1).max(120),
  parent_unit_id: uuid.nullable().optional(),
  display_order: z.number().int().min(0).max(32767).optional(),
  is_active: z.boolean().optional(),
});
const unitUpdateSchema = unitCreateSchema.partial();

// ── org_positions ──────────────────────────────────────────
const positionCreateSchema = z.object({
  unit_id: uuid,
  position_key: positionKey,
  display_name: z.string().min(1).max(120),
  profile_id: uuid.nullable().optional(),
  // The RBAC role this position grants its holder. NULL = structure-only.
  role_id: uuid.nullable().optional(),
  reports_to_position_id: uuid.nullable().optional(),
  is_management: z.boolean().optional(),
  is_deputy: z.boolean().optional(),
  deputy_capacities: z.array(z.string().max(120)).max(100).optional(),
  approval_threshold_ngn: z.number().nonnegative().nullable().optional(),
  display_order: z.number().int().min(0).max(32767).optional(),
});
const positionUpdateSchema = positionCreateSchema.partial();

// ── org_position_dotted_lines ──────────────────────────────
// Dotted lines convey information rights only — never approval. can_approve
// must remain false (DB comment + V2.2 §6.27).
const rightsSchema = z
  .object({
    can_view_dashboards: z.boolean().optional(),
    can_view_documents: z.boolean().optional(),
    can_request_updates: z.boolean().optional(),
    receives_notifications: z.boolean().optional(),
    can_approve: z.literal(false).optional(),
  })
  .strict();

const dottedLineCreateSchema = z
  .object({
    position_id: uuid,
    dotted_to_position_id: uuid,
    rights: rightsSchema.optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .refine(
    (o) => o.position_id !== o.dotted_to_position_id,
    "A position cannot have a dotted line to itself",
  );
const dottedLineUpdateSchema = z
  .object({
    rights: rightsSchema.optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "No fields to update");

function make(schema) {
  return function validate(req, _res, next) {
    req.body = schema.parse(req.body || {});
    next();
  };
}

module.exports = {
  // units (the generic /api/v1/org CRUD)
  validateCreate: make(unitCreateSchema),
  validateUpdate: make(unitUpdateSchema),
  // positions (/api/v1/org/positions)
  validatePositionCreate: make(positionCreateSchema),
  validatePositionUpdate: make(positionUpdateSchema),
  // dotted lines (/api/v1/org/positions/:id/dotted-lines)
  validateDottedLineCreate: make(dottedLineCreateSchema),
  validateDottedLineUpdate: make(dottedLineUpdateSchema),
  unitCreateSchema,
  unitUpdateSchema,
  positionCreateSchema,
  positionUpdateSchema,
  dottedLineCreateSchema,
  dottedLineUpdateSchema,
};
