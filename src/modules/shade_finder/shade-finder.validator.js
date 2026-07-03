/**
 * Shade Finder — Zod input validators.
 *
 * The photo itself arrives as multipart (multer, memory only) and is
 * validated in the route's fileFilter + service; these schemas cover the
 * text fields riding alongside it.
 */

"use strict";

const { z } = require("zod");

// Free-text message the visitor types alongside a photo or as a follow-up.
const message = z.string().trim().min(1).max(500);

const analyzeBody = z
  .object({
    // Optional caption with the photo ("I want something warmer", …).
    message: message.optional(),
    // Explicit consent checkbox from the UI — required, must be true.
    consent: z
      .preprocess((v) => v === true || v === "true", z.literal(true, {
        errorMap: () => ({
          message: "Photo analysis needs your consent.",
        }),
      })),
  })
  .passthrough(); // multipart parsers add file metadata keys — ignore them

const chatBody = z.object({ message }).strict();

const mw = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body ?? {});
  next();
};

module.exports = {
  validateAnalyze: mw(analyzeBody),
  validateChat: mw(chatBody),
};
