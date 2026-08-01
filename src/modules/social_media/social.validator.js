/**
 * Social Studio (V2.2 §6.14) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const PLATFORM = ["instagram", "facebook", "tiktok", "youtube"];
const POST_STATUS = ["draft", "assigned", "scheduled"];
const MONTH = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM")
  .transform((v) => `${v}-01`);

// Accounts can be registered on any platform in the (admin-extensible)
// shared.social_platforms registry — not just the four the Board/Calendar
// posting workflow still hardcodes below — so this isn't `z.enum(PLATFORM)`.
// social.service.js#connectAccount checks the key against the registry.
const accountConnect = z
  .object({
    platform: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,40}$/, "Unknown platform"),
    handle: z.string().min(1).max(120),
    profile_url: z.string().url().max(300).optional(),
  })
  .strict();

const planCreate = z
  .object({
    period_start: z.string().date(),
    period_end: z.string().date(),
  })
  .strict();

const postRow = z.object({
  account_id: z.string().uuid().optional(),
  platform: z.enum(PLATFORM),
  post_type: z.enum(["image", "carousel", "video", "reel", "story", "short"]),
  caption: z.string().max(4000).optional(),
  hashtags: z.array(z.string()).optional(),
  media_urls: z.array(z.string()).optional(),
  tagged_product_ids: z.array(z.string().uuid()).optional(),
  scheduled_for: z.string().datetime().optional(),
  assigned_to: z.string().uuid().optional(),
});

const planAddPosts = z
  .object({ rows: z.array(postRow).min(1).max(100) })
  .strict();

const planDecision = z
  .object({ notes: z.string().max(2000).optional() })
  .strict();

const postCreate = z
  .object({
    account_id: z.string().uuid().optional(),
    platform: z.enum(PLATFORM),
    post_type: z.enum(["image", "carousel", "video", "reel", "story", "short"]),
    caption: z.string().max(4000).optional(),
    hashtags: z.array(z.string()).optional(),
    media_urls: z.array(z.string()).optional(),
    tagged_product_ids: z.array(z.string().uuid()).optional(),
    scheduled_for: z.string().datetime().optional(),
    assigned_to: z.string().uuid().optional(),
    plan_id: z.string().uuid().optional(),
    // Explicit intent overrides inference (assigned_to -> assigned,
    // scheduled_for -> scheduled, else draft).
    status: z.enum(POST_STATUS).optional(),
  })
  .strict();

const postUpdate = z
  .object({
    account_id: z.string().uuid().optional(),
    platform: z.enum(PLATFORM).optional(),
    post_type: z
      .enum(["image", "carousel", "video", "reel", "story", "short"])
      .optional(),
    caption: z.string().max(4000).optional(),
    hashtags: z.array(z.string()).optional(),
    media_urls: z.array(z.string()).optional(),
    tagged_product_ids: z.array(z.string().uuid()).optional(),
    scheduled_for: z.string().datetime().optional(),
    assigned_to: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

const reschedule = z.object({ scheduled_for: z.string().datetime() }).strict();

const metrics = z
  .object({
    metric_date: z.string().date().optional(),
    metrics: z.record(z.coerce.number().int().nonnegative()).default({}),
  })
  .strict();

const proofSubmit = z
  .object({ external_url: z.string().url().max(500) })
  .strict();

// Quick-log (simplified Social Studio): paste a link for a day + platform and
// it lands as a proven "posted" row, oEmbed enriched, no content/screenshot.
// platform is optional — the service infers it from the URL host when omitted.
// Like accountConnect above, platform is any key from the (admin-extensible)
// shared.social_platforms registry, not just the original four — the service
// requires it to resolve to a registered account either way.
const quickLog = z
  .object({
    external_url: z.string().url().max(500),
    platform: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,40}$/, "Unknown platform")
      .optional(),
    account_id: z.string().uuid().optional(),
    // The calendar day the post belongs to (ISO). Absent -> now.
    published_at: z.string().datetime().optional(),
  })
  .strict();

const rateCreative = z
  .object({ rating: z.coerce.number().int().min(1).max(5) })
  .strict();

const targetSet = z
  .object({
    platform: z.enum(PLATFORM),
    user_id: z.string().uuid().nullable().optional(),
    period_month: MONTH,
    target_count: z.coerce.number().int().positive(),
  })
  .strict();

const dmIngest = z
  .object({
    contact_id: z.string().uuid(),
    platform: z.enum(PLATFORM).optional(),
    body: z.string().min(1).max(8000),
    external_ref: z.string().max(200).optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  PLATFORM,
  MONTH,
  validateAccountConnect: mk(accountConnect),
  validatePlanCreate: mk(planCreate),
  validatePlanAddPosts: mk(planAddPosts),
  validatePlanDecision: mk(planDecision),
  validatePostCreate: mk(postCreate),
  validatePostUpdate: mk(postUpdate),
  validateReschedule: mk(reschedule),
  validateMetrics: mk(metrics),
  validateProofSubmit: mk(proofSubmit),
  validateQuickLog: mk(quickLog),
  validateRateCreative: mk(rateCreative),
  validateTargetSet: mk(targetSet),
  validateDmIngest: mk(dmIngest),
};
