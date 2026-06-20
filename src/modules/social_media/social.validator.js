/**
 * Social Media Management (V2.2 §6.14) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const PLATFORM = ["instagram", "facebook", "tiktok", "youtube"];

const accountConnect = z
  .object({
    platform: z.enum(PLATFORM),
    handle: z.string().min(1).max(120),
    external_account_id: z.string().min(1).max(200),
    scopes: z.array(z.string()).optional(),
  })
  .strict();

const postCreate = z
  .object({
    account_id: z.string().uuid(),
    platform: z.enum(PLATFORM),
    post_type: z.enum(["image", "carousel", "video", "reel", "story", "short"]),
    caption: z.string().max(4000).optional(),
    hashtags: z.array(z.string()).optional(),
    media_urls: z.array(z.string()).optional(),
    tagged_product_ids: z.array(z.string().uuid()).optional(),
    scheduled_for: z.string().datetime().optional(),
    // Optional explicit intent. A "planned draft" sends status:"draft" together
    // with scheduled_for (its calendar date) so it shows on the day but stays a
    // draft; omit to infer (scheduled_for ⇒ scheduled, else draft).
    status: z.enum(["draft", "scheduled"]).optional(),
  })
  .strict();

const reschedule = z
  .object({ scheduled_for: z.string().datetime() })
  .strict();

const metrics = z
  .object({
    metric_date: z.string().date().optional(),
    metrics: z.record(z.coerce.number().int().nonnegative()).default({}),
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

const publish = z
  .object({ external_post_id: z.string().max(200).optional() })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateAccountConnect: mk(accountConnect),
  validatePostCreate: mk(postCreate),
  validateReschedule: mk(reschedule),
  validateMetrics: mk(metrics),
  validateDmIngest: mk(dmIngest),
  validatePublish: mk(publish),
};
