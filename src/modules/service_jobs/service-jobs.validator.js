/**
 * Faitlyn Service Job Tracker (V2.2 §6.24) — Zod validators.
 */

"use strict";

const { z } = require("zod");

// The full Stylist Studio lifecycle. `completed` is normally reached
// automatically via /:id/qc (QC pass), but kept accepted on /:id/advance for
// edge cases (legacy imports, one-off manual closes). Retired states
// (qc_passed, ready_for_dispatch, handed_to_sales) are DELIBERATELY absent —
// the DB CHECK still tolerates them for historical rows, but no code path
// should be writing them any more.
const JOB_STATUS = [
  "pending",
  "assigned",
  "in_progress",
  "on_hold",
  "returned_for_qc",
  "rework",
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

// Why a job has no sale behind it. Required when the job is opened by hand
// with no sales_order_id — see the refine on jobCreate below.
const REVENUE_KIND = ["customer_our_hair", "customer_own_hair", "internal"];

const jobCreate = z
  .object({
    service_type_id: z.string().uuid(),
    revenue_kind: z.enum(REVENUE_KIND).optional(),
    internal_reason: z.string().max(300).optional(),
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
    // Customer's style brief, captured at job open and locked. A note and/or
    // an inspiration link — both optional, both become locked references.
    brief: z
      .object({
        body: z.string().max(2000).optional(),
        url: z.string().url().max(2000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  // Every revenue needs a sale. A job opened BY HAND with no order behind it
  // has to say which it is, because the three cases need opposite handling and
  // the system previously could not tell them apart:
  //   customer_our_hair / customer_own_hair → a sale is OWED, chase it
  //   internal (shoot, sample, staff)       → no sale will ever exist
  // Jobs opened FROM an order skip this — they already have their sale.
  .refine((v) => Boolean(v.sales_order_id) || Boolean(v.revenue_kind), {
    message:
      "Say what this job is: customer work on our hair, customer's own hair, or internal",
    path: ["revenue_kind"],
  })
  // An internal job with no stated reason is how "no sale" quietly becomes the
  // default answer for everything. One line is enough — "July campaign shoot".
  .refine(
    (v) => v.revenue_kind !== "internal" || Boolean(v.internal_reason?.trim()),
    {
      message: "Say what the internal job is for",
      path: ["internal_reason"],
    },
  );

const jobUpdate = z
  .object({
    // Classifiable after the fact — every job that predates this field, and
    // every backfilled NULL, gets answered from the Unbilled tab rather than
    // being stuck unclassified forever.
    revenue_kind: z.enum(REVENUE_KIND).optional(),
    internal_reason: z.string().max(300).optional(),
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
  .object({
    assigned_staff_user_id: z.string().uuid(),
    // Deadline set at the assigning level. Flows onto the job's
    // expected_completion_at (+ the SLA clock) and, via the task-creation
    // trigger, onto the stylist's Workspace task due date. The frontend
    // pre-fills this to +48h; omitting it lets the service apply that default.
    expected_completion_at: z.string().datetime().optional(),
    // Set by the assign screen's warning modal when the job has no sales order
    // behind it. The service rejects an unlinked assignment without it, so the
    // acknowledgement can't be bypassed by calling the API directly.
    acknowledge_unlinked: z.boolean().optional(),
    // Assigner has confirmed moving a wig that is physically out with another
    // stylist — custody is transferred instead of refused.
    acknowledge_transfer: z.boolean().optional(),
  })
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

// Query-string variant (Express 4 lets us reassign req.query; same pattern as
// sales.validator.js and dashboards.validator.js).
const mkQuery = (schema) => (req, _res, next) => {
  req.query = schema.parse(req.query ?? {});
  next();
};

// Unbilled tab filter. 'unclassified' is not a stored revenue_kind — it is
// the NULL bucket, which is where legacy and never-asked jobs live and where
// the work of clearing this queue actually starts.
const unbilledQuery = z
  .object({
    kind: z.enum([...REVENUE_KIND, "unclassified", "all"]).optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  })
  .strict();

module.exports = {
  REVENUE_KIND,
  validateUnbilledQuery: mkQuery(unbilledQuery),
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
