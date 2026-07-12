/**
 * Recruitment validators (Zod). Input schemas only — no business logic.
 */

"use strict";

const { z } = require("zod");

const uuid = z.string().uuid();
const brandKey = z.string().min(1).max(60);
const freeform = z.record(z.any());

const draftSchema = z
  .object({
    title: z.string().min(2).max(160),
    target_businesses: z.array(brandKey).max(10).optional(),
    candidate_name: z.string().max(160).optional(),
    candidate_email: z.string().email().max(200).optional(),
    opening_id: uuid.optional(),
    role_ids: z.array(uuid).max(50).optional(),
    is_ceo: z.boolean().optional(),
    use_ai: z.boolean().optional(),
    intake: freeform.optional(),
    // manual seed (when use_ai === false)
    jd_markdown: z.string().max(60000).optional(),
    offer_markdown: z.string().max(60000).optional(),
    offer_meta: freeform.optional(),
  })
  .strip();

const editSchema = z
  .object({
    title: z.string().min(2).max(160).optional(),
    candidate_name: z.string().max(160).optional(),
    candidate_email: z.string().email().max(200).optional(),
    target_businesses: z.array(brandKey).max(10).optional(),
    role_ids: z.array(uuid).max(50).optional(),
    is_ceo: z.boolean().optional(),
    jd_markdown: z.string().max(60000).optional(),
    offer_markdown: z.string().max(60000).optional(),
    offer_meta: freeform.optional(),
  })
  .strip();

const regenerateSchema = z.object({ intake: freeform.optional() }).strip();

const approveSchema = editSchema.extend({
  expires_in_days: z.coerce.number().int().min(1).max(60).optional(),
  message: z.string().max(2000).optional(),
});

const contextSchema = z
  .object({
    display_name: z.string().max(200).optional(),
    summary: z.string().max(8000).optional(),
    tone: z.string().max(4000).optional(),
    target_markets: z.string().max(4000).optional(),
    non_negotiables: z.string().max(4000).optional(),
    signatory_name: z.string().max(160).optional(),
    signatory_title: z.string().max(160).optional(),
    notes: z.string().max(8000).optional(),
  })
  .strip();

const templateSchema = z
  .object({
    business: brandKey.nullish(),
    title: z.string().min(2).max(160),
    department: z.string().max(160).optional(),
    employment_type: z.string().max(60).optional(),
    seniority: z.string().max(60).optional(),
    intake: freeform.optional(),
    content: freeform.optional(),
  })
  .strip();

// Provisioning options from the onboarding wizard. staff_profile_id links the
// new login to the HR employee profile created during onboarding; role_ids
// (when present) replace the offer's stored grants — e.g. the role of the
// organigramme position the hire was seated in.
const provisionSchema = z
  .object({
    staff_profile_id: uuid.optional(),
    role_ids: z.array(uuid).max(50).optional(),
  })
  .strip();

const signSchema = z
  .object({
    signature_data_url: z
      .string()
      .min(30)
      .max(2_000_000)
      .refine((s) => s.startsWith("data:image/"), "Must be a drawn-signature image"),
  })
  .strip();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateDraft: mk(draftSchema),
  validateEdit: mk(editSchema),
  validateRegenerate: mk(regenerateSchema),
  validateApprove: mk(approveSchema),
  validateProvision: mk(provisionSchema),
  validateContext: mk(contextSchema),
  validateTemplate: mk(templateSchema),
  validateSign: mk(signSchema),
};
