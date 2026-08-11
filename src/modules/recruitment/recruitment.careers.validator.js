/**
 * Careers apply validator (Zod). Validates the multipart TEXT fields only —
 * files are handled by multer + the service. JSON-encoded fields (skills,
 * portfolio_links) arrive as strings and are parsed in the service, so they're
 * accepted here as optional strings.
 */

"use strict";

const { z } = require("zod");

const applySchema = z
  .object({
    full_name: z.string().min(2).max(160),
    email: z.string().email().max(200),
    phone: z.string().min(3).max(60),
    address: z.string().min(2).max(500),
    cover_letter_text: z.string().max(20000).optional(),
    // JSON strings (parsed in the service).
    portfolio_links: z.string().max(4000).optional(),
    skills: z.string().max(4000).optional(),
    notice_period: z.string().max(60).optional(),
    desired_salary: z.union([z.string(), z.number()]).optional(),
    desired_salary_currency: z.string().max(8).optional(),
    desired_salary_text: z.string().max(120).optional(),
    source: z.string().max(120).optional(),
    // Anti-abuse.
    captcha_token: z.string().max(4000).optional(),
    company_website: z.string().max(200).optional(), // honeypot — must stay empty
  })
  .passthrough();

function validateApply(req, _res, next) {
  // Coerce/prune the known text fields; keep unknown multipart fields untouched
  // (multer puts everything on req.body as strings).
  req.body = { ...req.body, ...applySchema.parse(req.body || {}) };
  next();
}

module.exports = { validateApply };
