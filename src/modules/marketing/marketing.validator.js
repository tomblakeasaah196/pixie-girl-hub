/**
 * Marketing Campaigns & Ad Analytics (V2.2 §6.15) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const PLATFORM = ["google_ads", "meta_ads"];

const adAccountConnect = z
  .object({
    platform: z.enum(PLATFORM),
    external_account_id: z.string().min(1).max(200),
    display_name: z.string().min(1).max(160),
    currency: z.string().length(3).optional(),
    // OAuth tokens from the connect/consent flow — stored AES-encrypted.
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
  })
  .strict();

const adCampaignCreate = z
  .object({
    ad_account_id: z.string().uuid(),
    platform: z.enum(PLATFORM),
    // Optional when push:true — the platform assigns the id on create.
    external_campaign_id: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(200),
    objective: z.string().max(60).optional(),
    status: z
      .enum(["draft", "active", "paused", "ended", "removed"])
      .optional(),
    budget_amount: z.coerce.number().nonnegative().optional(),
    budget_currency: z.string().length(3).optional(),
    // Create the campaign on the ad platform (paused) instead of just recording.
    push: z.boolean().optional(),
  })
  .strict()
  .refine((d) => d.push === true || Boolean(d.external_campaign_id), {
    message: "external_campaign_id is required unless push:true",
    path: ["external_campaign_id"],
  });

const statusChange = z
  .object({ status: z.enum(["draft", "active", "paused", "ended", "removed"]) })
  .strict();

const spend = z
  .object({
    metric_date: z.string().date().optional(),
    spend_amount: z.coerce.number().nonnegative().optional(),
    spend_ngn: z.coerce.number().nonnegative().optional(),
    impressions: z.coerce.number().int().nonnegative().optional(),
    clicks: z.coerce.number().int().nonnegative().optional(),
    conversions: z.coerce.number().int().nonnegative().optional(),
    conversion_value: z.coerce.number().nonnegative().optional(),
    conversion_value_ngn: z.coerce.number().nonnegative().optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateAdAccountConnect: mk(adAccountConnect),
  validateAdCampaignCreate: mk(adCampaignCreate),
  validateStatusChange: mk(statusChange),
  validateSpend: mk(spend),
};
