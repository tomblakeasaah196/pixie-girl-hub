/**
 * IAM & Security validators (Zod).
 *
 * Each schema validates the request body (or query) and replaces
 * req.body / req.query with the parsed (and coerced) result. On failure
 * a 400 AppError with field-level details is thrown.
 */

"use strict";

const { z } = require("zod");
const { AppError } = require("../../utils/errors");

// ── Shared helpers ──────────────────────────────────────────

function makeBody(schema) {
  return function validate(req, _res, next) {
    try {
      req.body = schema.parse(req.body || {});
      next();
    } catch (err) {
      if (err.issues) {
        throw new AppError(
          "VALIDATION_ERROR",
          err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          400,
          { fields: err.issues },
        );
      }
      throw err;
    }
  };
}

function makeQuery(schema) {
  return function validate(req, _res, next) {
    try {
      req.query = schema.parse(req.query || {});
      next();
    } catch (err) {
      if (err.issues) {
        throw new AppError(
          "VALIDATION_ERROR",
          err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          400,
          { fields: err.issues },
        );
      }
      throw err;
    }
  };
}

// ── Schemas ─────────────────────────────────────────────────

const provisionStaffLoginSchema = z.object({
  email: z.string().email(),
  default_business: z.string().min(1),
  permitted_businesses: z.array(z.string().min(1)).min(1),
});

const provisionExternalSchema = z.object({
  email: z.string().email(),
  display_name: z.string().min(2),
  external_label: z.string().optional(),
  default_business: z.string().min(1),
  permitted_businesses: z.array(z.string().min(1)).min(1),
});

const totpVerifySchema = z.object({
  code: z
    .string()
    .length(6)
    .regex(/^\d{6}$/, "Code must be 6 digits"),
});

const totpDisableSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

const createReviewSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  due_date: z.string().optional(),
});

const updateReviewSchema = z
  .object({
    status: z.enum(["in_progress", "completed", "cancelled"]).optional(),
    summary_note: z.string().max(5000).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "No fields to update");

const decideEntrySchema = z.object({
  decision: z.enum(["approved", "revoked", "flagged"]),
  reviewer_note: z.string().max(2000).optional(),
});

const auditQuerySchema = z.object({
  module: z.string().optional(),
  action: z.string().optional(),
  user_id: z.string().uuid().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  is_sensitive: z
    .string()
    .optional()
    .transform((v) => {
      if (v === "true") return true;
      if (v === "false") return false;
      return undefined;
    }),
  search: z.string().optional(),
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 200) : 50)),
});

const auditExportSchema = z.object({
  format: z.enum(["csv", "xlsx"]).default("csv"),
  module: z.string().optional(),
  action: z.string().optional(),
  user_id: z.string().uuid().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  is_sensitive: z
    .string()
    .optional()
    .transform((v) => {
      if (v === "true") return true;
      if (v === "false") return false;
      return undefined;
    }),
  search: z.string().optional(),
});

const listQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 200) : 25)),
});

const reviewListQuerySchema = z.object({
  status: z.enum(["open", "in_progress", "completed", "cancelled"]).optional(),
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 200) : 25)),
});

const sessionListQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 200) : 25)),
});

const exportReviewQuerySchema = z.object({
  format: z.enum(["csv", "xlsx"]).default("csv"),
});

const eventsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 50) : 20)),
});

// ── Exports ─────────────────────────────────────────────────

module.exports = {
  validateProvisionStaffLogin: makeBody(provisionStaffLoginSchema),
  validateProvisionExternal: makeBody(provisionExternalSchema),
  validateTotpVerify: makeBody(totpVerifySchema),
  validateTotpDisable: makeBody(totpDisableSchema),
  validateCreateReview: makeBody(createReviewSchema),
  validateUpdateReview: makeBody(updateReviewSchema),
  validateDecideEntry: makeBody(decideEntrySchema),
  validateAuditQuery: makeQuery(auditQuerySchema),
  validateAuditExport: makeQuery(auditExportSchema),
  validateListQuery: makeQuery(listQuerySchema),
  validateReviewListQuery: makeQuery(reviewListQuerySchema),
  validateSessionListQuery: makeQuery(sessionListQuerySchema),
  validateExportReviewQuery: makeQuery(exportReviewQuerySchema),
  validateEventsQuery: makeQuery(eventsQuerySchema),
};
