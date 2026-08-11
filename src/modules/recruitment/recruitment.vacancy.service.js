/**
 * Vacancy service — business logic, transactions, events, audit.
 *
 * The vacancy-first flow that precedes the offer flow:
 *   conversational AI intake → draft the whole vacancy → publish to the public
 *   Careers page → applicants apply → the team runs the pipeline (AI match
 *   score, star ratings, notes, the 5-question rubric) → "Move to Offered"
 *   spawns a recruitment_offer and the existing Offer Studio takes over.
 *
 * Controllers never touch repos directly; repos never emit events.
 */

"use strict";

const repo = require("./recruitment.vacancy.repo");
const ai = require("./recruitment.vacancy.ai");
const offersRepo = require("./recruitment.repo");
const events = require("./recruitment.events");
const storage = require("../../services/storage.service");
const { audit } = require("../../middleware/audit");
const { logger } = require("../../config/logger");
const { NotFoundError, ConflictError, AppError } = require("../../utils/errors");

// ── helpers ────────────────────────────────────────────────
const targetsFor = (brand, input) =>
  input && input.target_businesses && input.target_businesses.length
    ? input.target_businesses
    : [brand];

function slugify(title) {
  return String(title || "role")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "role";
}

/** A unique, human-readable slug (title + short random suffix on collision). */
async function uniqueSlug(title) {
  const base = slugify(title);
  if (!(await repo.slugExists({ slug: base }))) return base;
  for (let i = 0; i < 5; i++) {
    const s = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!(await repo.slugExists({ slug: s }))) return s;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// ── Conversational intake ──────────────────────────────────
/** Hybrid intake: after the scripted answers, ask AI for up to 2 gap-fillers. */
const suggestFollowups = ({ intake }) => ai.suggestFollowups({ intake: intake || {} });

// ── Vacancies: create ──────────────────────────────────────
/**
 * Create a vacancy. When use_ai !== false, Gemini drafts the whole thing (JD,
 * requirements, work model, salary band) from the intake; the caller's explicit
 * fields always win over the AI's. Lands as a `draft` for review before publish.
 */
async function createVacancy({ brand, user, request_id, input }) {
  const targets = targetsFor(brand, input);
  let drafted = null;
  if (input.use_ai !== false) {
    drafted = await ai.draftVacancy({ intake: { ...(input.intake || {}), title: input.title }, targets });
  }
  const meta = (drafted && drafted.meta) || {};

  // Explicit input beats AI beats null.
  const pick = (key) => (input[key] !== undefined && input[key] !== null && input[key] !== "" ? input[key] : meta[key]);

  const title = input.title || (drafted && drafted.title) || "New Role";
  const slug = await uniqueSlug(title);

  const vacancy = await repo.createVacancy({
    brand,
    user_id: user.user_id,
    input: {
      title,
      slug,
      org_unit_id: input.org_unit_id,
      department: input.department || (drafted && drafted.department) || null,
      role_id: input.role_id,
      employment_type: pick("employment_type") || "full_time",
      workplace_model: pick("workplace_model") || "on_site",
      days_on_site: pick("days_on_site"),
      days_off_site: pick("days_off_site"),
      days_off: pick("days_off"),
      working_hours: pick("working_hours"),
      location_city: pick("location_city"),
      location_state: pick("location_state"),
      location_country: pick("location_country"),
      probation_months: pick("probation_months"),
      salary_min: pick("salary_min"),
      salary_max: pick("salary_max"),
      salary_currency: input.salary_currency || "NGN",
      salary_period: input.salary_period || "month",
      salary_hidden: input.salary_hidden || false,
      jd_markdown: input.jd_markdown || (drafted && drafted.jd_markdown) || null,
      requirements_markdown: input.requirements_markdown || (drafted && drafted.requirements_markdown) || null,
      target_start_date: pick("target_start_date"),
      headcount: pick("headcount") || 1,
      target_businesses: targets,
      hiring_manager_position_id: input.hiring_manager_position_id,
      reviewer_position_ids: input.reviewer_position_ids || [],
      status: "draft",
      apply_config: input.apply_config || {},
      intake: input.intake || {},
      ai_provider: drafted ? drafted.provider : null,
    },
  });

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "recruitment.vacancy.create",
    target_type: "job_vacancy",
    target_id: vacancy.vacancy_id,
    request_id,
  });
  events.emit("vacancy_created", { vacancy_id: vacancy.vacancy_id, business: brand });
  return vacancy;
}

/**
 * Build the ABSOLUTE public Careers-page URL for a vacancy — it lives on the
 * brand's storefront (e.g. faitlynhair.com), NOT the admin host, so a relative
 * link would 404 in the admin. Null when unpublished or no storefront domain
 * is configured (the admin then hides the "Careers page" button).
 */
async function careersUrl(vacancy) {
  if (!vacancy || !vacancy.slug || vacancy.status !== "published") return null;
  const dom = await repo.storefrontDomain({ brand: vacancy.business });
  const host = dom && (dom.storefront_domain || dom.sales_subdomain);
  if (!host) return null;
  const clean = String(host).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return `https://${clean}/careers/${vacancy.slug}`;
}

async function getVacancy({ brand, id }) {
  const vacancy = await repo.getVacancy({ brand, id });
  if (!vacancy) throw new NotFoundError("Vacancy");
  vacancy.public_careers_url = await careersUrl(vacancy);
  return vacancy;
}

const listVacancies = ({ brand, status }) => repo.listVacancies({ brand, status });

const VACANCY_EDIT = [
  "title", "org_unit_id", "department", "role_id", "employment_type",
  "workplace_model", "days_on_site", "days_off_site", "days_off", "working_hours",
  "location_city", "location_state", "location_country", "probation_months",
  "salary_min", "salary_max", "salary_currency", "salary_period", "salary_hidden",
  "jd_markdown", "requirements_markdown", "target_start_date", "headcount",
  "target_businesses", "hiring_manager_position_id", "reviewer_position_ids",
  "apply_config",
];

async function updateVacancy({ brand, user, request_id, id, input }) {
  const vacancy = await repo.getVacancy({ brand, id });
  if (!vacancy) throw new NotFoundError("Vacancy");
  const fields = {};
  for (const k of VACANCY_EDIT) if (input[k] !== undefined) fields[k] = input[k];
  const updated = await repo.updateVacancy({ id, fields });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "recruitment.vacancy.update",
    target_type: "job_vacancy",
    target_id: id,
    request_id,
  });
  return updated;
}

/** Draft → published → paused → closed/filled, plus reopen. Sets timestamps. */
async function setStatus({ brand, user, request_id, id, status }) {
  const vacancy = await repo.getVacancy({ brand, id });
  if (!vacancy) throw new NotFoundError("Vacancy");
  const fields = { status };
  if (status === "published") {
    if (!vacancy.jd_markdown) throw new AppError("VACANCY_NOT_READY", "Add a job description before publishing", 422);
    if (!vacancy.slug) fields.slug = await uniqueSlug(vacancy.title);
    if (!vacancy.published_at) fields.published_at = new Date().toISOString();
    fields.closed_at = null;
  } else if (status === "closed" || status === "filled") {
    fields.closed_at = new Date().toISOString();
  }
  const updated = await repo.updateVacancy({ id, fields });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: `recruitment.vacancy.${status}`,
    target_type: "job_vacancy",
    target_id: id,
    request_id,
  });
  events.emit(status === "published" ? "vacancy_published" : "vacancy_status", {
    vacancy_id: id,
    business: brand,
    status,
  });
  return updated;
}

async function deleteVacancy({ brand, user, request_id, id }) {
  const vacancy = await repo.getVacancy({ brand, id });
  if (!vacancy) throw new NotFoundError("Vacancy");
  if (vacancy.status !== "draft")
    throw new ConflictError("Only a draft vacancy can be deleted; close it instead");
  await repo.deleteVacancy({ brand, id });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "recruitment.vacancy.delete",
    target_type: "job_vacancy",
    target_id: id,
    request_id,
  });
}

// ── Screening questions (the rubric) ───────────────────────
async function generateQuestions({ brand, user, request_id, id }) {
  const vacancy = await repo.getVacancy({ brand, id });
  if (!vacancy) throw new NotFoundError("Vacancy");
  const { questions } = await ai.generateScreeningQuestions({
    vacancy,
    targets: vacancy.target_businesses.length ? vacancy.target_businesses : [brand],
  });
  const saved = await repo.replaceQuestions({ vacancy_id: id, questions });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "recruitment.vacancy.questions.generate",
    target_type: "job_vacancy",
    target_id: id,
    request_id,
  });
  return saved;
}

const listQuestions = ({ id }) => repo.listQuestions({ vacancy_id: id });

/** Save the hiring manager's rubric answers (array of {question_id, answer, weight}). */
async function answerQuestions({ brand, user, request_id, id, answers }) {
  const vacancy = await repo.getVacancy({ brand, id });
  if (!vacancy) throw new NotFoundError("Vacancy");
  for (const a of answers || []) {
    if (!a || !a.question_id) continue;
    await repo.answerQuestion({
      question_id: a.question_id,
      answer: a.answer,
      weight: a.weight,
      user_id: user.user_id,
    });
  }
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "recruitment.vacancy.questions.answer",
    target_type: "job_vacancy",
    target_id: id,
    request_id,
  });
  return repo.listQuestions({ vacancy_id: id });
}

// ── Applications ───────────────────────────────────────────
async function listApplications({ brand, vacancy_id, stage }) {
  const vacancy = await repo.getVacancy({ brand, id: vacancy_id });
  if (!vacancy) throw new NotFoundError("Vacancy");
  return repo.listApplications({ vacancy_id, stage });
}

/** Full applicant record for the detail view: base + media + notes + ratings + scores. */
async function getApplicationDetail({ brand, id, user }) {
  const application = await repo.getApplication({ brand, id });
  if (!application) throw new NotFoundError("Application");
  const [media, notes, scores, ratings] = await Promise.all([
    repo.listMedia({ application_id: id }),
    repo.listNotes({ application_id: id }),
    repo.listScores({ application_id: id }),
    repo.ratingSummary({ application_id: id, rater_id: user ? user.user_id : null }),
  ]);
  return { ...application, media, notes, scores, ratings };
}

/** Admin hand-adds an applicant (no file uploads) so the board is usable now. */
async function addApplicationManual({ brand, user, request_id, vacancy_id, input }) {
  const vacancy = await repo.getVacancy({ brand, id: vacancy_id });
  if (!vacancy) throw new NotFoundError("Vacancy");
  const application = await repo.upsertApplication({
    input: {
      vacancy_id,
      business: brand,
      full_name: input.full_name,
      email: input.email,
      phone: input.phone,
      address: input.address,
      cover_letter_text: input.cover_letter_text,
      cv_text: input.cv_text,
      portfolio_links: input.portfolio_links || [],
      notice_period: input.notice_period,
      desired_salary: input.desired_salary,
      desired_salary_text: input.desired_salary_text,
      skills: input.skills || [],
      source: input.source || "manual",
      stage: input.stage || "new",
    },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "recruitment.application.add",
    target_type: "job_application",
    target_id: application.application_id,
    request_id,
  });
  events.emit("application_received", {
    application_id: application.application_id,
    vacancy_id,
    business: brand,
  });
  return application;
}

async function updateStage({ brand, user, request_id, id, stage }) {
  const application = await repo.getApplication({ brand, id });
  if (!application) throw new NotFoundError("Application");
  const updated = await repo.updateApplication({ id, fields: { stage } });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "recruitment.application.stage",
    target_type: "job_application",
    target_id: id,
    after: { stage },
    request_id,
  });
  events.emit("application_stage_changed", {
    application_id: id,
    vacancy_id: application.vacancy_id,
    business: brand,
    stage,
  });
  return updated;
}

async function addNote({ brand, user, request_id, id, body }) {
  const application = await repo.getApplication({ brand, id });
  if (!application) throw new NotFoundError("Application");
  const note = await repo.addNote({ application_id: id, author_id: user.user_id, body });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "recruitment.application.note",
    target_type: "job_application",
    target_id: id,
    request_id,
  });
  return note;
}

async function setRating({ brand, user, id, stars }) {
  const application = await repo.getApplication({ brand, id });
  if (!application) throw new NotFoundError("Application");
  await repo.upsertRating({ application_id: id, rater_id: user.user_id, stars });
  return repo.ratingSummary({ application_id: id, rater_id: user.user_id });
}

// ── AI scoring ─────────────────────────────────────────────
const MAX_INLINE_BYTES = 6 * 1024 * 1024; // keep the multimodal payload sane

/** Load an applicant's CV + work images from storage as inline Gemini parts. */
async function loadAttachments(application) {
  const parts = [];
  let budget = MAX_INLINE_BYTES;

  const add = async (key, mime, kind) => {
    if (!key || budget <= 0) return;
    try {
      const buf = await storage.get(key);
      if (!buf || buf.length > budget) return;
      budget -= buf.length;
      const isImage = String(mime || "").startsWith("image/");
      parts.push({
        type: isImage ? "image" : "file",
        mime_type: mime || (isImage ? "image/jpeg" : "application/pdf"),
        data: buf.toString("base64"),
      });
    } catch (err) {
      logger.warn({ err: err.message, key }, "vacancy: could not load attachment for scoring");
    }
  };

  // CV first (most important), then up to 3 work images.
  await add(application.cv_key, application.cv_mime, "cv");
  const media = await repo.listMedia({ application_id: application.application_id });
  for (const m of media.slice(0, 3)) await add(m.storage_key, m.mime, "work");
  return parts;
}

/** Score one applicant, persist the score, denormalise the latest onto the row. */
async function scoreApplication({ brand, user, request_id, id }) {
  const application = await repo.getApplication({ brand, id });
  if (!application) throw new NotFoundError("Application");
  const vacancy = await repo.getVacancy({ brand, id: application.vacancy_id });
  if (!vacancy) throw new NotFoundError("Vacancy");
  const questions = await repo.listQuestions({ vacancy_id: vacancy.vacancy_id });
  const attachments = await loadAttachments(application);

  const result = await ai.scoreApplication({ vacancy, application, questions, attachments });

  await repo.insertScore({
    input: {
      application_id: id,
      vacancy_id: vacancy.vacancy_id,
      score: result.score,
      summary: result.summary,
      breakdown: result.breakdown,
      scoring_stage: result.scoring_stage,
      ai_provider: result.provider,
      model: result.model,
    },
  });
  const updated = await repo.updateApplication({
    id,
    fields: {
      match_score: result.score,
      match_summary: result.summary,
      match_stage: result.scoring_stage,
    },
  });
  if (user) {
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "recruitment.application.score",
      target_type: "job_application",
      target_id: id,
      after: { score: result.score, stage: result.scoring_stage },
      request_id,
    });
  }
  return { ...updated, score: result };
}

/**
 * Score every applicant for a vacancy against the current rubric. Sequential and
 * best-effort — a single failure never aborts the run. Returns a small summary.
 */
async function scoreAllApplicants({ brand, user, request_id, vacancy_id }) {
  const vacancy = await repo.getVacancy({ brand, id: vacancy_id });
  if (!vacancy) throw new NotFoundError("Vacancy");
  const apps = await repo.listApplications({ vacancy_id });
  let scored = 0;
  let failed = 0;
  for (const a of apps) {
    try {
      await scoreApplication({ brand, user: null, request_id, id: a.application_id });
      scored += 1;
    } catch (err) {
      failed += 1;
      logger.warn({ err: err.message, application_id: a.application_id }, "vacancy: scoreAll item failed");
    }
  }
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "recruitment.vacancy.score_all",
    target_type: "job_vacancy",
    target_id: vacancy_id,
    after: { scored, failed },
    request_id,
  });
  events.emit("applications_scored", { vacancy_id, business: brand, scored });
  return { scored, failed, total: apps.length };
}

// ── Transition: Move to Offered → spawn a recruitment_offer ─
/**
 * Hand a winning applicant to the existing offer flow: create a recruitment_offer
 * pre-filled from the vacancy + application (JD, candidate, salary band → offer
 * meta, granted role), link it back on the application and set stage=offered. The
 * vacancy stays OPEN (multi-hire) — closing is a separate, manual action.
 */
async function moveToOffered({ brand, user, request_id, id }) {
  const application = await repo.getApplication({ brand, id });
  if (!application) throw new NotFoundError("Application");
  if (application.offer_id) {
    return { application, offer_id: application.offer_id, already: true };
  }
  const vacancy = await repo.getVacancy({ brand, id: application.vacancy_id });
  if (!vacancy) throw new NotFoundError("Vacancy");

  const band =
    vacancy.salary_min || vacancy.salary_max
      ? `${vacancy.salary_currency || "NGN"} ${fmt(vacancy.salary_min)}–${fmt(vacancy.salary_max)} / ${vacancy.salary_period || "month"}`
      : "";

  const location = [vacancy.location_city, vacancy.location_state, vacancy.location_country]
    .filter(Boolean)
    .join(", ");

  const offer = await offersRepo.createOffer({
    brand,
    user_id: user.user_id,
    input: {
      opening_id: null,
      candidate_id: null,
      title: vacancy.title,
      candidate_name: application.full_name,
      candidate_email: application.email,
      target_businesses: vacancy.target_businesses.length ? vacancy.target_businesses : [brand],
      jd_markdown: vacancy.jd_markdown || "",
      offer_markdown: "",
      offer_meta: {
        employment_type: vacancy.employment_type,
        location,
        probation_months: vacancy.probation_months || 3,
        salary_probation: band,
        salary_post_probation: "",
        start_date: vacancy.target_start_date || "",
        reporting_to: "",
      },
      role_ids: vacancy.role_id ? [vacancy.role_id] : [],
      is_ceo: false,
      ai_provider: null,
    },
  });

  const updated = await repo.updateApplication({
    id,
    fields: { stage: "offered", offer_id: offer.offer_id },
  });

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "recruitment.application.move_to_offered",
    target_type: "job_application",
    target_id: id,
    after: { offer_id: offer.offer_id },
    request_id,
  });
  events.emit("application_offered", {
    application_id: id,
    vacancy_id: vacancy.vacancy_id,
    offer_id: offer.offer_id,
    business: brand,
  });
  return { application: updated, offer_id: offer.offer_id };
}

const fmt = (n) => (n === null || n === undefined || n === "" ? "?" : Number(n).toLocaleString("en-NG"));

// ── Media streaming (admin download of a CV / headshot / work image) ──
async function getApplicationFile({ brand, id, kind, media_id }) {
  const application = await repo.getApplication({ brand, id });
  if (!application) throw new NotFoundError("Application");
  let key, mime, filename;
  if (kind === "cv") {
    key = application.cv_key; mime = application.cv_mime; filename = application.cv_filename || "cv";
  } else if (kind === "headshot") {
    key = application.headshot_key; mime = application.headshot_mime; filename = "headshot";
  } else if (kind === "cover_letter") {
    key = application.cover_letter_key; mime = application.cover_letter_mime; filename = application.cover_letter_filename || "cover-letter";
  } else if (kind === "media" && media_id) {
    const m = await repo.getMedia({ media_id });
    if (!m || m.application_id !== id) throw new NotFoundError("File");
    key = m.storage_key; mime = m.mime; filename = m.filename || "attachment";
  }
  if (!key) throw new NotFoundError("File");
  const buffer = await storage.get(key);
  return { buffer, mime_type: mime || "application/octet-stream", filename };
}

// ── Form options (pickers for the wizard) ──────────────────
async function formOptions({ brand }) {
  const [departments, positions, roles] = await Promise.all([
    repo.listDepartments({ brand }),
    repo.listPositions({ brand }),
    repo.listRoles(),
  ]);
  return { departments, positions, roles };
}

module.exports = {
  suggestFollowups,
  createVacancy,
  getVacancy,
  listVacancies,
  updateVacancy,
  setStatus,
  deleteVacancy,
  generateQuestions,
  listQuestions,
  answerQuestions,
  listApplications,
  getApplicationDetail,
  addApplicationManual,
  updateStage,
  addNote,
  setRating,
  scoreApplication,
  scoreAllApplicants,
  moveToOffered,
  getApplicationFile,
  formOptions,
};
