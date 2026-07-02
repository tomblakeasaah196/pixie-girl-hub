/**
 * Faitlyn Service Job Tracker (V2.2 §6.24) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const JOB_STATUS = [
  "pending",
  "in_progress",
  "on_hold",
  "completed",
  "rejected",
  "cancelled",
];

const serviceTypeCreate = z
  .object({
    service_key: z.string().min(1).max(60),
    display_name: z.string().min(1).max(160),
    description: z.string().max(2000).optional(),
    standard_cost_ngn: z.coerce.number().nonnegative().optional(),
    standard_turnaround_days: z.coerce.number().int().nonnegative().optional(),
    default_account_id: z.string().uuid().optional(),
    display_order: z.coerce.number().int().optional(),
  })
  .strict();

const serviceTypeUpdate = z
  .object({
    display_name: z.string().min(1).max(160).optional(),
    description: z.string().max(2000).optional(),
    standard_cost_ngn: z.coerce.number().nonnegative().optional(),
    standard_turnaround_days: z.coerce.number().int().nonnegative().optional(),
    default_account_id: z.string().uuid().optional(),
    display_order: z.coerce.number().int().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const jobCreate = z
  .object({
    service_type_id: z.string().uuid(),
    hair_variant_id: z.string().uuid().optional(),
    hair_unit_id: z.string().uuid().optional(),
    hair_description: z.string().max(500).optional(),
    sales_order_id: z.string().uuid().optional(),
    sales_order_line_id: z.string().uuid().optional(),
    customer_contact_id: z.string().uuid().optional(),
    assigned_staff_user_id: z.string().uuid().optional(),
    assigned_stylist_id: z.string().uuid().optional(),
    is_intercompany: z.boolean().optional(),
    intercompany_transaction_id: z.string().uuid().optional(),
    specification: z.record(z.any()).optional(),
    recipe_id: z.string().uuid().optional(),
    scheduled_for: z.string().datetime().optional(),
    expected_completion_at: z.string().datetime().optional(),
    agreed_cost_ngn: z.coerce.number().nonnegative().optional(),
  })
  .strict();

const jobUpdate = z
  .object({
    hair_variant_id: z.string().uuid().optional(),
    hair_unit_id: z.string().uuid().optional(),
    hair_description: z.string().max(500).optional(),
    assigned_stylist_id: z.string().uuid().optional(),
    specification: z.record(z.any()).optional(),
    recipe_id: z.string().uuid().optional(),
    recipe_override: z.record(z.any()).optional(),
    scheduled_for: z.string().datetime().optional(),
    expected_completion_at: z.string().datetime().optional(),
    agreed_cost_ngn: z.coerce.number().nonnegative().optional(),
  })
  .strict();

const jobAdvance = z
  .object({
    status: z.enum(JOB_STATUS),
    actual_cost_ngn: z.coerce.number().nonnegative().optional(),
  })
  .strict();

const assignStaff = z
  .object({ assigned_staff_user_id: z.string().uuid() })
  .strict();

const outcome = z
  .object({
    quality_rating: z.coerce.number().int().min(1).max(5).optional(),
    quality_notes: z.string().max(2000).optional(),
    customer_rating: z.coerce.number().int().min(1).max(5).optional(),
    customer_feedback: z.string().max(2000).optional(),
  })
  .strict();

// ── Chemicals (F-7c/d) ─────────────────────────────────────
const ingredient = z
  .object({
    chemical_name: z.string().min(1).max(160),
    brand: z.string().max(120).optional(),
    sku: z.string().max(80).optional(),
    qty_ml: z.coerce.number().nonnegative().optional(),
    qty_g: z.coerce.number().nonnegative().optional(),
    role: z.string().max(80).optional(),
  })
  .passthrough();

const recipeCreate = z
  .object({
    recipe_key: z.string().min(1).max(60),
    display_name: z.string().min(1).max(160),
    ingredients: z.array(ingredient).min(1),
    instructions: z.string().max(5000).optional(),
    target_shade: z.string().max(120).optional(),
    notes: z.string().max(2000).optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const recipeUpdate = z
  .object({
    display_name: z.string().min(1).max(160).optional(),
    ingredients: z.array(ingredient).min(1).optional(),
    instructions: z.string().max(5000).optional(),
    target_shade: z.string().max(120).optional(),
    notes: z.string().max(2000).optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const chemicalRecord = z
  .object({
    chemical_name: z.string().min(1).max(160),
    chemical_brand: z.string().max(120).optional(),
    variant_id: z.string().uuid().optional(),
    qty_used: z.coerce.number().positive(),
    unit: z.string().min(1).max(20),
    cost_ngn: z.coerce.number().nonnegative().optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();

// ── Stylist Studio (PR2) ───────────────────────────────────
const materialLog = z
  .object({
    kind: z.enum(["discrete", "chemical"]),
    variant_id: z.string().uuid().optional(),
    quantity: z.coerce.number().positive().optional(),
    chemical_name: z.string().min(1).max(160).optional(),
    usage_note: z.string().max(200).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.kind === "discrete"
        ? !!v.variant_id && v.quantity !== undefined
        : !!v.chemical_name,
    {
      message:
        "discrete materials need variant_id + quantity; chemicals need chemical_name",
    },
  );

const referenceAdd = z
  .object({
    ref_type: z.enum([
      "image",
      "audio",
      "video_link",
      "text",
      "creative_freedom",
    ]),
    doc_id: z.string().uuid().optional(),
    url: z.string().url().max(2000).optional(),
    body: z.string().max(5000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.ref_type === "creative_freedom" || !!v.doc_id || !!v.url || !!v.body,
    {
      message:
        "reference needs a doc_id, url or body (unless creative_freedom)",
    },
  );

const qc = z
  .object({
    result: z.enum(["pass", "rework"]),
    quality_rating: z.coerce.number().int().min(1).max(5).optional(),
    quality_notes: z.string().max(2000).optional(),
    reassign_to: z.string().uuid().optional(),
  })
  .strict();

const writeOff = z.object({ reason: z.string().min(1).max(500) }).strict();

const intercompanyLink = z
  .object({ ic_transaction_id: z.string().uuid() })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateServiceTypeCreate: mk(serviceTypeCreate),
  validateServiceTypeUpdate: mk(serviceTypeUpdate),
  validateJobCreate: mk(jobCreate),
  validateJobUpdate: mk(jobUpdate),
  validateJobAdvance: mk(jobAdvance),
  validateAssignStaff: mk(assignStaff),
  validateOutcome: mk(outcome),
  validateRecipeCreate: mk(recipeCreate),
  validateRecipeUpdate: mk(recipeUpdate),
  validateChemicalRecord: mk(chemicalRecord),
  validateMaterialLog: mk(materialLog),
  validateReferenceAdd: mk(referenceAdd),
  validateQc: mk(qc),
  validateWriteOff: mk(writeOff),
  validateIntercompanyLink: mk(intercompanyLink),
};
