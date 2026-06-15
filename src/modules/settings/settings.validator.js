/**
 * Settings module — Zod validators.
 */

"use strict";

const { z } = require("zod");

const mw = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body ?? {});
  next();
};

// ── document_templates ───────────────────────────────────
const templateCreate = z
  .object({
    doc_type: z.string().min(1).max(40),
    name: z.string().min(1).max(120),
    version: z.coerce.number().int().min(1).optional(),
    status: z.enum(["draft", "published", "archived"]).optional(),
    header_html: z.string().max(20000).nullable().optional(),
    body_html: z.string().max(50000).nullable().optional(),
    footer_html: z.string().max(20000).nullable().optional(),
    css_vars: z.record(z.any()).optional(),
    is_default: z.boolean().optional(),
  })
  .strict();
const templateUpdate = templateCreate.partial().strict();

// ── notification_preferences ─────────────────────────────
const notificationPref = z
  .object({
    channel: z.enum(["email", "sms", "push", "in_app"]),
    category: z.string().min(1).max(60),
    enabled: z.boolean().optional(),
    config: z.record(z.any()).optional(),
  })
  .strict();

// ── scheduled_reports ────────────────────────────────────
const reportCreate = z
  .object({
    name: z.string().min(1).max(120),
    source_module: z.string().min(1).max(60),
    trigger_event: z.string().max(80).nullable().optional(),
    params: z.record(z.any()).optional(),
    cadence: z.enum(["daily", "weekly", "monthly", "quarterly", "on_event"]),
    recipients: z.array(z.string().email()).optional(),
    formats: z.array(z.enum(["pdf", "csv", "xlsx"])).optional(),
    is_active: z.boolean().optional(),
    next_run_at: z.string().datetime().nullable().optional(),
  })
  .strict();
const reportUpdate = reportCreate.partial().strict();

// ── integration_secrets (write-only) ─────────────────────
const secretSet = z
  .object({
    provider: z.string().min(1).max(60),
    key_name: z.string().min(1).max(60),
    // The raw secret — encrypted server-side, never stored in plain or
    // returned. Bounded so a paste error can't blow up the cipher.
    secret: z.string().min(1).max(4000),
  })
  .strict();

module.exports = {
  validateTemplateCreate: mw(templateCreate),
  validateTemplateUpdate: mw(templateUpdate),
  validateNotificationPref: mw(notificationPref),
  validateReportCreate: mw(reportCreate),
  validateReportUpdate: mw(reportUpdate),
  validateSecretSet: mw(secretSet),
};
