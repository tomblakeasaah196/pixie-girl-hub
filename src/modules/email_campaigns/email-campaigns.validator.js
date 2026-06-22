/**
 * Email Campaigns (V2.2 §6.16) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const templateCreate = z
  .object({
    template_key: z.string().min(1).max(80),
    display_name: z.string().min(1).max(160),
    subject_line: z.string().min(1).max(300),
    html_body: z.string().min(1),
    available_variables: z.array(z.string()).optional(),
    from_name: z.string().max(120).optional(),
    from_email: z.string().email().optional(),
    reply_to_email: z.string().email().optional(),
    status: z.enum(["draft", "review", "approved", "archived"]).optional(),
  })
  .strict();

const templateUpdate = z
  .object({
    display_name: z.string().min(1).max(160).optional(),
    subject_line: z.string().min(1).max(300).optional(),
    html_body: z.string().min(1).optional(),
    from_name: z.string().max(120).optional(),
    from_email: z.string().email().optional(),
    reply_to_email: z.string().email().optional(),
    status: z.enum(["draft", "review", "approved", "archived"]).optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

// Campaign-level merge variables (e.g. the sale's discount, link and end
// date). Scalar values only; the render pipeline turns sale_ends_at into the
// countdown tokens. Permissive on keys so a campaign can carry custom tokens.
const mergeData = z.record(
  z.string().max(80),
  z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
);

const campaignCreate = z
  .object({
    campaign_name: z.string().min(1).max(200),
    campaign_type: z
      .enum(["one_off", "recurring", "triggered", "milestone", "ab_test"])
      .optional(),
    segment_id: z.string().uuid().optional(),
    default_template_id: z.string().uuid().optional(),
    from_name: z.string().max(120).optional(),
    from_email: z.string().email().optional(),
    reply_to_email: z.string().email().optional(),
    scheduled_for: z.string().datetime().optional(),
    merge_data: mergeData.optional(),
  })
  .strict();

const campaignUpdate = z
  .object({
    campaign_name: z.string().min(1).max(200).optional(),
    campaign_type: z
      .enum(["one_off", "recurring", "triggered", "milestone", "ab_test"])
      .optional(),
    segment_id: z.string().uuid().nullable().optional(),
    default_template_id: z.string().uuid().nullable().optional(),
    from_name: z.string().max(120).nullable().optional(),
    from_email: z.string().email().nullable().optional(),
    reply_to_email: z.string().email().nullable().optional(),
    scheduled_for: z.string().datetime().nullable().optional(),
    merge_data: mergeData.optional(),
  })
  .strict();

const buildRecipients = z
  .object({ contact_ids: z.array(z.string().uuid()).optional() })
  .strict();

const eventIngest = z
  .object({
    email: z.string().email(),
    event_type: z.enum([
      "delivered",
      "opened",
      "clicked",
      "bounced",
      "unsubscribed",
      "complained",
    ]),
  })
  .strict();

const newsletter = z
  .object({
    email: z.string().email(),
    phone: z.string().min(4).max(40).optional(),
    first_name: z.string().max(120).optional(),
    last_name: z.string().max(120).optional(),
    notify_via: z.enum(["email", "whatsapp", "both"]).optional(),
  })
  .strict();

const variantCreate = z
  .object({
    variant_label: z.string().min(1).max(40),
    template_id: z.string().uuid().optional(),
    subject_line: z.string().max(300).optional(),
    from_name: z.string().max(120).optional(),
    preheader_text: z.string().max(300).optional(),
    allocation_pct: z.coerce.number().gt(0).max(100),
  })
  .strict();

const declareWinner = z.object({ variant_id: z.string().uuid() }).strict();
const scheduleBody = z
  .object({ scheduled_for: z.string().datetime() })
  .strict();

const segmentSave = z
  .object({
    name: z.string().min(1).max(160),
    description: z.string().max(2000).optional(),
    filter: z.record(z.any()).optional(),
  })
  .strict();

const audienceFromSegment = z
  .object({ segment_id: z.string().uuid() })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateTemplateCreate: mk(templateCreate),
  validateTemplateUpdate: mk(templateUpdate),
  validateCampaignCreate: mk(campaignCreate),
  validateCampaignUpdate: mk(campaignUpdate),
  validateBuildRecipients: mk(buildRecipients),
  validateEventIngest: mk(eventIngest),
  validateNewsletter: mk(newsletter),
  validateVariantCreate: mk(variantCreate),
  validateDeclareWinner: mk(declareWinner),
  validateSchedule: mk(scheduleBody),
  validateSegmentSave: mk(segmentSave),
  validateAudienceFromSegment: mk(audienceFromSegment),
};
