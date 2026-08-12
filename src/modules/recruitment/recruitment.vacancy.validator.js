/**
 * Vacancy validators (Zod). Input schemas only — no business logic.
 */

"use strict";

const { z } = require("zod");

const uuid = z.string().uuid();
const brandKey = z.string().min(1).max(60);
const freeform = z.record(z.any());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const WORKPLACE = ["remote", "hybrid", "on_site"];
const EMPLOYMENT = ["full_time", "part_time", "contract", "internship"];
const PERIOD = ["hour", "day", "month", "year"];
const STAGES = ["new", "screening", "shortlisted", "interviewed", "offered", "rejected", "withdrawn"];

const skill = z.object({
  skill: z.string().max(120),
  years: z.union([z.string(), z.number()]).optional(),
});
const link = z.object({
  label: z.string().max(60).optional(),
  url: z.string().max(500),
});

// Fields shared by create + update (all optional; create adds the AI knobs).
const vacancyFields = {
  title: z.string().min(2).max(160),
  org_unit_id: uuid.nullish(),
  department: z.string().max(160).nullish(),
  role_id: uuid.nullish(),
  employment_type: z.enum(EMPLOYMENT).optional(),
  workplace_model: z.enum(WORKPLACE).optional(),
  days_on_site: z.coerce.number().int().min(0).max(7).nullish(),
  days_off_site: z.coerce.number().int().min(0).max(7).nullish(),
  days_off: z.coerce.number().int().min(0).max(7).nullish(),
  working_hours: z.string().max(200).nullish(),
  location_city: z.string().max(120).nullish(),
  location_state: z.string().max(120).nullish(),
  location_country: z.string().max(120).nullish(),
  probation_months: z.coerce.number().int().min(0).max(24).nullish(),
  salary_min: z.coerce.number().min(0).nullish(),
  salary_max: z.coerce.number().min(0).nullish(),
  salary_currency: z.string().max(8).optional(),
  salary_period: z.enum(PERIOD).optional(),
  salary_hidden: z.boolean().optional(),
  jd_markdown: z.string().max(60000).nullish(),
  requirements_markdown: z.string().max(40000).nullish(),
  target_start_date: dateStr.nullish(),
  headcount: z.coerce.number().int().min(1).max(500).optional(),
  target_businesses: z.array(brandKey).max(10).optional(),
  hiring_manager_position_id: uuid.nullish(),
  reviewer_position_ids: z.array(uuid).max(20).optional(),
  apply_config: freeform.optional(),
};

const createSchema = z
  .object({
    ...vacancyFields,
    use_ai: z.boolean().optional(),
    intake: freeform.optional(),
  })
  .strip();

const updateSchema = z
  .object({ ...vacancyFields, title: vacancyFields.title.optional() })
  .strip();

const statusSchema = z
  .object({ status: z.enum(["draft", "published", "paused", "closed", "filled"]) })
  .strip();

const followupsSchema = z.object({ intake: freeform.optional() }).strip();

const answersSchema = z
  .object({
    answers: z
      .array(
        z.object({
          question_id: uuid,
          answer: z.string().max(4000).optional(),
          weight: z.coerce.number().int().min(1).max(5).optional(),
        }),
      )
      .max(20),
  })
  .strip();

const applicationSchema = z
  .object({
    full_name: z.string().min(2).max(160),
    email: z.string().email().max(200),
    phone: z.string().max(60).optional(),
    address: z.string().max(500).optional(),
    cover_letter_text: z.string().max(20000).optional(),
    cv_text: z.string().max(60000).optional(),
    portfolio_links: z.array(link).max(10).optional(),
    notice_period: z.string().max(60).optional(),
    desired_salary: z.coerce.number().min(0).optional(),
    desired_salary_text: z.string().max(120).optional(),
    skills: z.array(skill).max(40).optional(),
    source: z.string().max(120).optional(),
    stage: z.enum(STAGES).optional(),
  })
  .strip();

const stageSchema = z.object({ stage: z.enum(STAGES) }).strip();
const noteSchema = z.object({ body: z.string().min(1).max(8000) }).strip();
const ratingSchema = z.object({ stars: z.coerce.number().int().min(1).max(5) }).strip();
const questionRatingSchema = z
  .object({
    stars: z.coerce.number().int().min(1).max(5),
    note: z.string().max(2000).optional(),
  })
  .strip();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCreate: mk(createSchema),
  validateUpdate: mk(updateSchema),
  validateStatus: mk(statusSchema),
  validateFollowups: mk(followupsSchema),
  validateAnswers: mk(answersSchema),
  validateApplication: mk(applicationSchema),
  validateStage: mk(stageSchema),
  validateNote: mk(noteSchema),
  validateRating: mk(ratingSchema),
  validateQuestionRating: mk(questionRatingSchema),
};
