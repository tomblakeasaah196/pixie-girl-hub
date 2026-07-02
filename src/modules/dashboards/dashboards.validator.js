/**
 * Dashboards & Reports (V2.2 §6.20 + §6.30) — input validators.
 *
 * Zod schemas wrapped in Express middleware. Each requires only the entity's
 * mandatory identity fields (the natural key + display name) and TYPES the
 * optional fields; `.passthrough()` keeps any service-injected or
 * not-yet-modelled fields, so a previously-valid body is never rejected. The
 * error handler maps ZodError → 400 with field detail.
 */

"use strict";

const { z } = require("zod");

const jsonObject = z.record(z.any());
const jsonArray = z.array(z.any());

// ── Saved reports ──────────────────────────────────────────
const savedReportCreateSchema = z
  .object({
    report_key: z.string().min(1).max(120),
    display_name: z.string().min(1).max(200),
    report_category: z.string().max(80).optional(),
    description: z.string().max(2000).optional(),
    base_query_key: z.string().max(120).optional(),
    is_shared: z.boolean().optional(),
    config: jsonObject.optional(),
    default_format: z.string().max(20).optional(),
  })
  .passthrough();

// ── Dashboard configs ──────────────────────────────────────
const dashboardConfigCreateSchema = z
  .object({
    display_name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    layout: jsonArray.optional(),
    is_default: z.boolean().optional(),
    is_shared: z.boolean().optional(),
    display_order: z.number().int().optional(),
    user_id: z.string().uuid().optional(),
  })
  .passthrough();

// ── Widgets ────────────────────────────────────────────────
const widgetCreateSchema = z
  .object({
    widget_key: z.string().min(1).max(120),
    display_name: z.string().min(1).max(200),
    widget_type: z.string().min(1).max(60),
    description: z.string().max(2000).optional(),
    query_type: z.string().max(60).optional(),
    sql_query: z.string().optional(),
    module_key: z.string().max(60).optional(),
    refresh_seconds: z.number().int().positive().optional(),
    display_config: jsonObject.optional(),
    required_permission: z.string().max(60).optional(),
  })
  .passthrough();

// ── Report templates ───────────────────────────────────────
const reportTemplateCreateSchema = z
  .object({
    template_key: z.string().min(1).max(120),
    display_name: z.string().min(1).max(200),
    cadence: z.string().min(1).max(40),
    description: z.string().max(2000).optional(),
    scheduled_day_of_week: z.number().int().min(0).max(6).nullable().optional(),
    scheduled_hour: z.number().int().min(0).max(23).nullable().optional(),
    default_recipient_role_ids: z.array(z.string()).optional(),
    sections: jsonArray.optional(),
    output_formats: z.array(z.string()).optional(),
    requires_staff_confirmation: z.boolean().optional(),
    delivery_method: z.array(z.string()).optional(),
    is_system_template: z.boolean().optional(),
  })
  .passthrough();

// ── Domain dashboards (§6.20 rebuild) ──────────────────────

const isoDate = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), {
    message: "Invalid ISO date",
  });

const periodQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .passthrough();

const detailQuerySchema = periodQuerySchema.extend({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
  status: z.string().max(60).optional(),
  sales_channel: z.string().max(60).optional(),
});

const preferencesSchema = z.object({
  hidden_tiles: z.array(z.string().min(1).max(120)).max(500),
});

/** Wrap a schema as body-validating middleware (PATCH uses .partial()). */
const body = (schema) =>
  function validate(req, _res, next) {
    req.body = schema.parse(req.body);
    next();
  };

/** Wrap a schema as query-validating middleware. */
const queryMw = (schema) =>
  function validateQuery(req, _res, next) {
    req.query = schema.parse(req.query);
    next();
  };

module.exports = {
  // domain dashboards
  validatePeriodQuery: queryMw(periodQuerySchema),
  validateDetailQuery: queryMw(detailQuerySchema),
  validatePreferences: body(preferencesSchema),
  // saved reports
  validateSavedReportCreate: body(savedReportCreateSchema),
  validateSavedReportUpdate: body(savedReportCreateSchema.partial()),
  // dashboard configs
  validateDashboardConfigCreate: body(dashboardConfigCreateSchema),
  validateDashboardConfigUpdate: body(dashboardConfigCreateSchema.partial()),
  // widgets
  validateWidgetCreate: body(widgetCreateSchema),
  validateWidgetUpdate: body(widgetCreateSchema.partial()),
  // report templates
  validateReportTemplateCreate: body(reportTemplateCreateSchema),
  validateReportTemplateUpdate: body(reportTemplateCreateSchema.partial()),
  // raw schemas (for reuse/testing)
  schemas: {
    savedReportCreateSchema,
    dashboardConfigCreateSchema,
    widgetCreateSchema,
    reportTemplateCreateSchema,
    periodQuerySchema,
    detailQuerySchema,
    preferencesSchema,
  },
};
