/**
 * Employee documents validators (V2.2 §6.11).
 *
 * Zod schemas for the document-type catalogue and the multipart upload's
 * text fields. `business` is always brand context, never the body — and the
 * employee a document belongs to is always the URL's :id, never the body, so
 * a payload can't redirect a file onto someone else's profile.
 */

"use strict";

const { z } = require("zod");

const accepts = z.enum(["any", "pdf", "image"]);

const typeCreateSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  is_required: z.boolean().optional(),
  accepts: accepts.optional(),
});

const typeUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    is_required: z.boolean().optional(),
    accepts: accepts.optional(),
    sort_order: z.number().int().min(0).max(999).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Nothing to update",
  });

/**
 * The non-file half of the upload. Multer has already parsed the multipart
 * body, so these arrive as strings — `is_required`-style booleans don't
 * feature here, but the checkbox-free shape means no coercion is needed.
 */
const uploadMetaSchema = z.object({
  document_type: z.string().trim().min(1).max(60),
  title: z.string().trim().max(200).optional(),
});

function make(schema) {
  return (req, _res, next) => {
    req.body = schema.parse(req.body || {});
    next();
  };
}

module.exports = {
  typeCreate: make(typeCreateSchema),
  typeUpdate: make(typeUpdateSchema),
  uploadMeta: make(uploadMetaSchema),
};
