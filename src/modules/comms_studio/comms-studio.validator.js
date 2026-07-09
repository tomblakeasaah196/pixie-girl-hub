/**
 * Zod schemas for Comms Studio input.
 *
 * The Studio is the only place these rows are edited outside the seed
 * migration, so the validator is the safety net between the operator's
 * form and the persisted template.
 */

"use strict";

const { z } = require("zod");

// Channel + trigger enums mirror the DB CHECK constraints.
const CHANNEL = z.enum([
  "email",
  "whatsapp",
  "instagram",
  "in_app_only",
  "respect_contact_pref",
  "disabled",
]);
const FALLBACK = z.enum([
  "email",
  "whatsapp",
  "instagram",
  "in_app_only",
  "disabled",
]);
const CATEGORY = z.enum([
  "transactional",
  "lifecycle",
  "marketing",
  "operational",
]);
const TRIGGER = z.enum(["event", "scheduled", "annual", "recurring"]);

// One block from the block editor. `type` is required; the rest is the
// per-type payload the compiler expects.
const BLOCK = z
  .object({
    type: z.enum([
      "eyebrow",
      "heading",
      "paragraph",
      "button",
      "divider",
      "spacer",
      "hero",
      "perk",
      "price_compare",
      "deadline",
    ]),
    text: z.string().max(500).optional(),
    html: z.string().max(20_000).optional(),
    label: z.string().max(120).optional(),
    href: z.string().max(2_000).optional(),
    accent: z.string().max(120).optional(),
    size: z.number().int().min(10).max(80).optional(),
    muted: z.boolean().optional(),
    top: z.number().int().min(0).max(200).optional(),
    h: z.number().int().min(0).max(200).optional(),
    src: z.string().max(2_000).optional(),
    alt: z.string().max(500).optional(),
    glyph: z.string().max(16).optional(),
    old: z.string().max(80).optional(),
    new: z.string().max(80).optional(),
    caption: z.string().max(200).optional(),
    line1: z.string().max(200).optional(),
    line2: z.string().max(200).optional(),
  })
  .strict();

// The cadence spec is a small JSONB doc. Discriminate on `type`, keep the
// shape loose so future cadences don't need a schema migration — the
// dispatcher / cron reads only the keys it understands.
const CADENCE = z
  .object({
    type: z.enum(["event", "scheduled", "annual", "recurring"]),
    event: z.string().max(80).optional(),
    every_min: z.number().int().min(1).max(1440).optional(),
    every_days: z.number().int().min(1).max(365).optional(),
    hour_local: z.number().int().min(0).max(23).optional(),
    quiet_hours_local: z.array(z.number().int().min(0).max(23)).length(2).optional(),
    source: z.string().max(80).optional(),
    offset_days: z.union([z.number().int(), z.array(z.number().int())]).optional(),
    after_minutes: z.number().int().min(1).max(20160).optional(),
    min_amount_paid_ngn: z.number().nonnegative().optional(),
  })
  .passthrough();

const VARIABLES_SCHEMA = z
  .array(
    z.object({
      name: z.string().min(1).max(80),
      example: z.string().max(400).optional(),
      required: z.boolean().optional(),
      description: z.string().max(400).optional(),
    }),
  )
  .max(64);

const update = z
  .object({
    event_key: z.string().min(1).max(80),
    channel_preference: CHANNEL.optional(),
    fallback_channel: FALLBACK.nullable().optional(),
    block_whatsapp: z.boolean().optional(),
    is_active: z.boolean().optional(),
    display_name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    category: CATEGORY.optional(),
    trigger_type: TRIGGER.optional(),
    cadence_config: CADENCE.optional(),
    subject_template: z.string().max(400).nullable().optional(),
    preheader_template: z.string().max(400).nullable().optional(),
    email_blocks_json: z.array(BLOCK).max(64).optional(),
    whatsapp_body_template: z.string().max(4000).nullable().optional(),
    instagram_body_template: z.string().max(4000).nullable().optional(),
    variables_schema: VARIABLES_SCHEMA.optional(),
    rationale: z.string().max(2000).nullable().optional(),
  })
  .strict();

const preview = z
  .object({
    event_key: z.string().min(1).max(80),
    channel: z.enum(["email", "whatsapp", "instagram"]).default("email"),
    // Draft overrides — the Studio POSTs the operator's unsaved edits here
    // so the preview matches what they're currently typing, not the last
    // saved row. All optional; missing fields fall back to the stored row.
    subject_template: z.string().max(400).optional(),
    preheader_template: z.string().max(400).optional(),
    email_blocks_json: z.array(BLOCK).max(64).optional(),
    whatsapp_body_template: z.string().max(4000).optional(),
    instagram_body_template: z.string().max(4000).optional(),
    variables: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
  })
  .strict();

const sendTest = z
  .object({
    event_key: z.string().min(1).max(80),
    channel: z.enum(["email", "whatsapp"]),
    to: z.string().min(3).max(400),
    variables: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
  })
  .strict();

const mk = (schema, target) => (req, _res, next) => {
  req[target] = schema.parse(req[target] || {});
  next();
};

module.exports = {
  validateUpdate: mk(update, "body"),
  validatePreview: mk(preview, "body"),
  validateSendTest: mk(sendTest, "body"),
};
