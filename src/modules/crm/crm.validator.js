/**
 * CRM (V2.2 §6.1) — Zod validators.
 */

"use strict";

const { z } = require("zod");
const money = z.coerce.number().nonnegative();

const pipelineCreate = z
  .object({
    pipeline_key: z.string().min(1).max(40),
    display_name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    is_default: z.boolean().optional(),
    applies_to: z
      .enum([
        "all",
        "storefront",
        "pos",
        "dispatch",
        "walk_in",
        "custom",
        "services",
        "wholesale",
      ])
      .optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const stageCreate = z
  .object({
    stage_key: z.string().min(1).max(40),
    display_name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    colour: z.string().max(20).optional(),
    is_terminal: z.boolean().optional(),
    is_won: z.boolean().optional(),
    is_lost: z.boolean().optional(),
    win_probability_pct: z.coerce.number().int().min(0).max(100).optional(),
    sla_days: z.coerce.number().int().min(0).optional(),
    workflow_trigger_key: z.string().max(80).optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const dealCreate = z
  .object({
    contact_id: z.string().uuid(),
    pipeline_id: z.string().uuid(),
    current_stage_id: z.string().uuid(),
    title: z.string().min(1).max(200),
    description: z.string().max(4000).optional(),
    expected_value_ngn: money.optional(),
    expected_close_date: z.string().date().optional(),
    source_channel: z
      .enum([
        "instagram",
        "whatsapp",
        "website",
        "walk_in",
        "referral",
        "campaign",
        "google_ads",
        "meta_ads",
        "storefront",
        "pos",
        "event",
        "other",
      ])
      .optional(),
    source_reference: z.string().max(200).optional(),
    assigned_to: z.string().uuid().optional(),
  })
  .strict();

const dealUpdate = dealCreate.partial().omit({ contact_id: true });

const moveStage = z.object({ stage_id: z.string().uuid() }).strict();
const setStatus = z
  .object({
    status: z.enum(["open", "won", "lost", "on_hold", "cancelled"]),
    lost_reason: z.string().max(500).optional(),
  })
  .strict();

const activityCreate = z
  .object({
    activity_type: z.enum([
      "call",
      "sms",
      "whatsapp_msg",
      "instagram_dm",
      "email",
      "meeting",
      "website_chat",
      "walk_in_visit",
      "quote_sent",
      "payment_received",
      "system_note",
      "status_change",
      "follow_up_scheduled",
      "task_created",
    ]),
    direction: z.enum(["inbound", "outbound", "internal"]).optional(),
    subject: z.string().max(200).optional(),
    body: z.string().max(4000).optional(),
    outcome: z
      .enum([
        "connected",
        "no_answer",
        "left_voicemail",
        "reschedule_requested",
        "interested",
        "not_interested",
        "follow_up_required",
        "converted",
      ])
      .optional(),
    external_ref: z.string().max(200).optional(),
    scheduled_at: z.string().datetime({ offset: true }).optional(),
    duration_minutes: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const dealProductBase = z
  .object({
    product_id: z.string().uuid().optional(),
    variant_id: z.string().uuid().optional(),
    custom_description: z.string().max(500).optional(),
    quantity: z.coerce.number().int().min(1).optional(),
    unit_price_ngn: money.optional(),
    display_order: z.coerce.number().int().min(0).optional(),
  })
  .strict();
const dealProductCreate = dealProductBase.refine(
  (v) => v.product_id || v.variant_id || v.custom_description,
  { message: "product_id, variant_id or custom_description is required" },
);

const noteCreate = z
  .object({
    body: z.string().min(1).max(8000),
    is_pinned: z.boolean().optional(),
    visibility: z.enum(["team", "managers_only", "author_only"]).optional(),
  })
  .strict();

const strArr = z.array(z.string());
const preferencesUpsert = z
  .object({
    preferred_textures: strArr.optional(),
    preferred_lace_types: strArr.optional(),
    preferred_lengths_in: z.array(z.coerce.number().int()).optional(),
    preferred_colours: strArr.optional(),
    preferred_densities: strArr.optional(),
    preferred_cap_sizes: strArr.optional(),
    avoid_textures: strArr.optional(),
    avoid_colours: strArr.optional(),
    use_cases: strArr.optional(),
    budget_min_ngn: money.optional(),
    budget_max_ngn: money.optional(),
    styling_sensitivities: z.string().max(2000).optional(),
    source: z.enum(["manual", "observed", "survey", "curator_pick"]).optional(),
  })
  .strict();

const measurementCreate = z
  .object({
    circumference_cm: z.coerce.number().optional(),
    ear_to_ear_cm: z.coerce.number().optional(),
    forehead_to_nape_cm: z.coerce.number().optional(),
    temple_to_temple_cm: z.coerce.number().optional(),
    nape_width_cm: z.coerce.number().optional(),
    natural_hair_type: z.string().max(20).optional(),
    scalp_notes: z.string().max(2000).optional(),
    head_shape_notes: z.string().max(2000).optional(),
    photo_document_ids: z.array(z.string().uuid()).optional(),
    measured_by_stylist_id: z.string().uuid().optional(),
    is_current: z.boolean().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const churnRecord = z
  .object({
    risk_score: z.coerce.number().int().min(0).max(100),
    risk_band: z.enum(["low", "medium", "high", "critical"]),
    reasons: strArr.optional(),
    days_since_last_order: z.coerce.number().int().optional(),
    lifetime_value_ngn: money.optional(),
    total_orders: z.coerce.number().int().optional(),
    average_days_between_orders: z.coerce.number().optional(),
  })
  .strict();

const mw = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

module.exports = {
  validatePipelineCreate: mw(pipelineCreate),
  validatePipelineUpdate: mw(pipelineCreate.partial()),
  validateStageCreate: mw(stageCreate),
  validateStageUpdate: mw(stageCreate.partial()),
  validateDealCreate: mw(dealCreate),
  validateDealUpdate: mw(dealUpdate),
  validateMoveStage: mw(moveStage),
  validateSetStatus: mw(setStatus),
  validateActivityCreate: mw(activityCreate),
  validateDealProductCreate: mw(dealProductCreate),
  validateDealProductUpdate: mw(dealProductBase.partial()),
  validateNoteCreate: mw(noteCreate),
  validatePreferencesUpsert: mw(preferencesUpsert),
  validateMeasurementCreate: mw(measurementCreate),
  validateMeasurementUpdate: mw(measurementCreate.partial()),
  validateChurnRecord: mw(churnRecord),
};
