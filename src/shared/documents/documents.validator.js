/**
 * Documents (V2.2 §6.13) — validators for the multipart upload metadata.
 */

"use strict";

const { z } = require("zod");

const uploadMeta = z
  .object({
    document_type: z.string().min(1).max(60).optional(),
    title: z.string().max(300).optional(),
    reference_type: z.string().max(60).optional(),
    reference_id: z.string().uuid().optional(),
    // Multipart sends tags as a comma-separated string; coerce to an array so
    // downstream always receives string[]. (Also accepts a real array.)
    tags: z
      .preprocess(
        (v) =>
          typeof v === "string"
            ? v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : v,
        z.array(z.string().min(1).max(40)).max(20),
      )
      .optional(),
  })
  .strict();

function validateUploadMeta(req, _res, next) {
  req.body = uploadMeta.parse(req.body ?? {});
  next();
}

module.exports = { validateUploadMeta, uploadMeta };
