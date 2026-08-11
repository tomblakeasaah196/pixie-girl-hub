/**
 * Vacancy repository — parameterised SQL only (no business logic, no events).
 *
 * Owns the vacancy-first tables added in 000377_shared_job_vacancies:
 *   shared.job_vacancies, shared.vacancy_screening_questions,
 *   shared.job_applications, shared.job_application_media,
 *   shared.job_application_notes, shared.job_application_ratings,
 *   shared.job_application_scores.
 *
 * Everything is in the `shared` schema (cross-brand); rows carry a `business`
 * key for the issuing brand and are filtered by it, exactly like the offer flow.
 */

"use strict";

const { query, transaction } = require("../../config/database");

const jsonb = (v) => JSON.stringify(v === null || v === undefined ? {} : v);
const jsonbArr = (v) => JSON.stringify(Array.isArray(v) ? v : []);

// ── Vacancies ──────────────────────────────────────────────
const VACANCY_COLS = `vacancy_id, business, title, slug, org_unit_id, department,
  role_id, employment_type, workplace_model, days_on_site, days_off_site, days_off,
  working_hours, location_city, location_state, location_country, probation_months,
  salary_min, salary_max, salary_currency, salary_period, salary_hidden,
  jd_markdown, requirements_markdown, target_start_date, headcount, target_businesses,
  hiring_manager_position_id, reviewer_position_ids, status, apply_config, intake,
  ai_provider, published_at, closed_at, created_by, created_at, updated_at`;

async function slugExists({ slug }) {
  const { rows } = await query(
    `SELECT 1 FROM shared.job_vacancies WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  return rows.length > 0;
}

async function createVacancy({ brand, input, user_id, client }) {
  const q = client || { query };
  const { rows } = await q.query(
    `INSERT INTO shared.job_vacancies
       (business, title, slug, org_unit_id, department, role_id, employment_type,
        workplace_model, days_on_site, days_off_site, days_off, working_hours,
        location_city, location_state, location_country, probation_months,
        salary_min, salary_max, salary_currency, salary_period, salary_hidden,
        jd_markdown, requirements_markdown, target_start_date, headcount,
        target_businesses, hiring_manager_position_id, reviewer_position_ids,
        status, apply_config, intake, ai_provider, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26::text[],$27,$28::uuid[],$29,$30::jsonb,$31::jsonb,$32,$33)
     RETURNING ${VACANCY_COLS}`,
    [
      brand,
      input.title,
      input.slug || null,
      input.org_unit_id || null,
      input.department || null,
      input.role_id || null,
      input.employment_type || "full_time",
      input.workplace_model || "on_site",
      input.days_on_site ?? null,
      input.days_off_site ?? null,
      input.days_off ?? null,
      input.working_hours || null,
      input.location_city || null,
      input.location_state || null,
      input.location_country || null,
      input.probation_months ?? null,
      input.salary_min ?? null,
      input.salary_max ?? null,
      input.salary_currency || "NGN",
      input.salary_period || "month",
      input.salary_hidden || false,
      input.jd_markdown || null,
      input.requirements_markdown || null,
      input.target_start_date || null,
      input.headcount || 1,
      input.target_businesses || [],
      input.hiring_manager_position_id || null,
      input.reviewer_position_ids || [],
      input.status || "draft",
      jsonb(input.apply_config),
      jsonb(input.intake),
      input.ai_provider || null,
      user_id || null,
    ],
  );
  return rows[0];
}

async function getVacancy({ brand, id }) {
  const { rows } = await query(
    `SELECT ${VACANCY_COLS} FROM shared.job_vacancies
      WHERE vacancy_id = $1 ${brand ? "AND business = $2" : ""}`,
    brand ? [id, brand] : [id],
  );
  return rows[0] || null;
}

async function getVacancyBySlug({ slug, brand }) {
  const { rows } = await query(
    `SELECT ${VACANCY_COLS} FROM shared.job_vacancies
      WHERE slug = $1 ${brand ? "AND business = $2" : ""}`,
    brand ? [slug, brand] : [slug],
  );
  return rows[0] || null;
}

/**
 * Vacancy list with a per-row applicant count and a "new" (unreviewed) count so
 * the tab can show pipeline load without an N+1. Newest first.
 */
async function listVacancies({ brand, status }) {
  const params = [brand];
  let where = `v.business = $1`;
  if (status) {
    params.push(status);
    where += ` AND v.status = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT ${VACANCY_COLS.split(",").map((c) => `v.${c.trim()}`).join(", ")},
            COALESCE(a.total, 0)::int AS application_count,
            COALESCE(a.new_count, 0)::int AS new_count
       FROM shared.job_vacancies v
       LEFT JOIN (
         SELECT vacancy_id,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE stage = 'new') AS new_count
           FROM shared.job_applications GROUP BY vacancy_id
       ) a ON a.vacancy_id = v.vacancy_id
      WHERE ${where}
      ORDER BY v.created_at DESC
      LIMIT 200`,
    params,
  );
  return rows;
}

/** Public: published vacancies for a brand's Careers page (safe columns only). */
async function listPublishedVacancies({ brand }) {
  const { rows } = await query(
    `SELECT vacancy_id, title, slug, department, employment_type, workplace_model,
            location_city, location_state, location_country, salary_min, salary_max,
            salary_currency, salary_period, salary_hidden, target_start_date,
            published_at
       FROM shared.job_vacancies
      WHERE business = $1 AND status = 'published'
      ORDER BY published_at DESC NULLS LAST, created_at DESC`,
    [brand],
  );
  return rows;
}

const VACANCY_EDITABLE = [
  "title", "slug", "org_unit_id", "department", "role_id", "employment_type",
  "workplace_model", "days_on_site", "days_off_site", "days_off", "working_hours",
  "location_city", "location_state", "location_country", "probation_months",
  "salary_min", "salary_max", "salary_currency", "salary_period", "salary_hidden",
  "jd_markdown", "requirements_markdown", "target_start_date", "headcount",
  "target_businesses", "hiring_manager_position_id", "reviewer_position_ids",
  "status", "apply_config", "intake", "ai_provider", "published_at", "closed_at",
];

async function updateVacancy({ id, fields, client }) {
  const q = client || { query };
  const sets = [];
  const params = [];
  const put = (col, val, cast = "") => {
    params.push(val);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  for (const k of VACANCY_EDITABLE) {
    if (fields[k] === undefined) continue;
    if (k === "target_businesses") put(k, fields[k], "::text[]");
    else if (k === "reviewer_position_ids") put(k, fields[k], "::uuid[]");
    else if (k === "apply_config" || k === "intake") put(k, jsonb(fields[k]), "::jsonb");
    else put(k, fields[k]);
  }
  if (!sets.length) return getVacancy({ id });
  params.push(id);
  const { rows } = await q.query(
    `UPDATE shared.job_vacancies SET ${sets.join(", ")}
      WHERE vacancy_id = $${params.length} RETURNING ${VACANCY_COLS}`,
    params,
  );
  return rows[0] || null;
}

async function deleteVacancy({ brand, id }) {
  await query(
    `DELETE FROM shared.job_vacancies WHERE vacancy_id = $1 AND business = $2`,
    [id, brand],
  );
}

// ── Screening questions ────────────────────────────────────
async function replaceQuestions({ vacancy_id, questions }) {
  return transaction(async (client) => {
    await client.query(
      `DELETE FROM shared.vacancy_screening_questions WHERE vacancy_id = $1`,
      [vacancy_id],
    );
    const out = [];
    let pos = 1;
    for (const qn of questions) {
      const { rows } = await client.query(
        `INSERT INTO shared.vacancy_screening_questions
           (vacancy_id, position, question, rationale, weight)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [vacancy_id, pos++, qn.question, qn.rationale || null, qn.weight || 1],
      );
      out.push(rows[0]);
    }
    return out;
  });
}

async function listQuestions({ vacancy_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.vacancy_screening_questions
      WHERE vacancy_id = $1 ORDER BY position`,
    [vacancy_id],
  );
  return rows;
}

async function answerQuestion({ question_id, answer, weight, user_id }) {
  const { rows } = await query(
    `UPDATE shared.vacancy_screening_questions
        SET answer = $2,
            weight = COALESCE($3, weight),
            answered_by = $4,
            answered_at = now()
      WHERE question_id = $1
      RETURNING *`,
    [question_id, answer ?? null, weight ?? null, user_id || null],
  );
  return rows[0] || null;
}

// ── Applications ───────────────────────────────────────────
const APP_COLS = `application_id, vacancy_id, business, full_name, email, phone,
  address, cover_letter_text, cover_letter_key, cover_letter_filename, cover_letter_mime,
  cv_key, cv_filename, cv_mime, cv_text, headshot_key, headshot_mime, portfolio_links,
  notice_period, desired_salary, desired_salary_currency, desired_salary_text, skills,
  source, stage, match_score, match_summary, match_stage, offer_id, applied_at,
  submit_ip, submit_ua, created_at, updated_at`;

/**
 * Insert or update an application. Dedupe by (vacancy_id, email): a candidate
 * re-applying to the same vacancy UPDATES their existing row (their newest CV /
 * details win) rather than creating a duplicate. Pipeline fields (stage, scores,
 * offer link) are preserved on conflict — a re-submission never resets them.
 */
async function upsertApplication({ input, client }) {
  const q = client || { query };
  const { rows } = await q.query(
    `INSERT INTO shared.job_applications
       (vacancy_id, business, full_name, email, phone, address,
        cover_letter_text, cover_letter_key, cover_letter_filename, cover_letter_mime,
        cv_key, cv_filename, cv_mime, cv_text, headshot_key, headshot_mime,
        portfolio_links, notice_period, desired_salary, desired_salary_currency,
        desired_salary_text, skills, source, stage)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
             $17::jsonb,$18,$19,$20,$21,$22::jsonb,$23,COALESCE($24,'new'))
     ON CONFLICT (vacancy_id, email) DO UPDATE SET
        full_name              = EXCLUDED.full_name,
        phone                  = EXCLUDED.phone,
        address                = EXCLUDED.address,
        cover_letter_text      = EXCLUDED.cover_letter_text,
        cover_letter_key       = COALESCE(EXCLUDED.cover_letter_key, shared.job_applications.cover_letter_key),
        cover_letter_filename  = COALESCE(EXCLUDED.cover_letter_filename, shared.job_applications.cover_letter_filename),
        cover_letter_mime      = COALESCE(EXCLUDED.cover_letter_mime, shared.job_applications.cover_letter_mime),
        cv_key                 = COALESCE(EXCLUDED.cv_key, shared.job_applications.cv_key),
        cv_filename            = COALESCE(EXCLUDED.cv_filename, shared.job_applications.cv_filename),
        cv_mime                = COALESCE(EXCLUDED.cv_mime, shared.job_applications.cv_mime),
        cv_text                = COALESCE(EXCLUDED.cv_text, shared.job_applications.cv_text),
        headshot_key           = COALESCE(EXCLUDED.headshot_key, shared.job_applications.headshot_key),
        headshot_mime          = COALESCE(EXCLUDED.headshot_mime, shared.job_applications.headshot_mime),
        portfolio_links        = EXCLUDED.portfolio_links,
        notice_period          = EXCLUDED.notice_period,
        desired_salary         = EXCLUDED.desired_salary,
        desired_salary_currency = EXCLUDED.desired_salary_currency,
        desired_salary_text    = EXCLUDED.desired_salary_text,
        skills                 = EXCLUDED.skills,
        source                 = EXCLUDED.source,
        applied_at             = now()
     RETURNING ${APP_COLS}`,
    [
      input.vacancy_id,
      input.business,
      input.full_name,
      input.email,
      input.phone || null,
      input.address || null,
      input.cover_letter_text || null,
      input.cover_letter_key || null,
      input.cover_letter_filename || null,
      input.cover_letter_mime || null,
      input.cv_key || null,
      input.cv_filename || null,
      input.cv_mime || null,
      input.cv_text || null,
      input.headshot_key || null,
      input.headshot_mime || null,
      jsonbArr(input.portfolio_links),
      input.notice_period || null,
      input.desired_salary ?? null,
      input.desired_salary_currency || "NGN",
      input.desired_salary_text || null,
      jsonbArr(input.skills),
      input.source || null,
      input.stage || null,
    ],
  );
  return rows[0];
}

async function getApplication({ brand, id }) {
  const { rows } = await query(
    `SELECT ${APP_COLS} FROM shared.job_applications
      WHERE application_id = $1 ${brand ? "AND business = $2" : ""}`,
    brand ? [id, brand] : [id],
  );
  return rows[0] || null;
}

/**
 * Applications for a vacancy, enriched with the average star rating, rating
 * count and work-image count so the pipeline board renders in one query.
 */
async function listApplications({ vacancy_id, stage }) {
  const params = [vacancy_id];
  let where = `a.vacancy_id = $1`;
  if (stage) {
    params.push(stage);
    where += ` AND a.stage = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT ${APP_COLS.split(",").map((c) => `a.${c.trim()}`).join(", ")},
            COALESCE(r.avg_stars, 0)::float AS avg_rating,
            COALESCE(r.rating_count, 0)::int AS rating_count,
            COALESCE(m.media_count, 0)::int AS media_count,
            COALESCE(n.note_count, 0)::int AS note_count
       FROM shared.job_applications a
       LEFT JOIN (
         SELECT application_id, AVG(stars) AS avg_stars, COUNT(*) AS rating_count
           FROM shared.job_application_ratings GROUP BY application_id
       ) r ON r.application_id = a.application_id
       LEFT JOIN (
         SELECT application_id, COUNT(*) AS media_count
           FROM shared.job_application_media GROUP BY application_id
       ) m ON m.application_id = a.application_id
       LEFT JOIN (
         SELECT application_id, COUNT(*) AS note_count
           FROM shared.job_application_notes GROUP BY application_id
       ) n ON n.application_id = a.application_id
      WHERE ${where}
      ORDER BY a.match_score DESC NULLS LAST, a.applied_at DESC
      LIMIT 500`,
    params,
  );
  return rows;
}

const APP_EDITABLE = [
  "full_name", "email", "phone", "address", "cover_letter_text", "cv_text",
  "notice_period", "desired_salary", "desired_salary_text", "source", "stage",
  "match_score", "match_summary", "match_stage", "offer_id",
];

async function updateApplication({ id, fields, client }) {
  const q = client || { query };
  const sets = [];
  const params = [];
  const put = (col, val) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  for (const k of APP_EDITABLE) if (fields[k] !== undefined) put(k, fields[k]);
  if (fields.portfolio_links !== undefined) {
    params.push(jsonbArr(fields.portfolio_links));
    sets.push(`portfolio_links = $${params.length}::jsonb`);
  }
  if (fields.skills !== undefined) {
    params.push(jsonbArr(fields.skills));
    sets.push(`skills = $${params.length}::jsonb`);
  }
  if (!sets.length) return getApplication({ id });
  params.push(id);
  const { rows } = await q.query(
    `UPDATE shared.job_applications SET ${sets.join(", ")}
      WHERE application_id = $${params.length} RETURNING ${APP_COLS}`,
    params,
  );
  return rows[0] || null;
}

// ── Application media (work-sample images) ─────────────────
async function addMedia({ application_id, input, client }) {
  const q = client || { query };
  const { rows } = await q.query(
    `INSERT INTO shared.job_application_media
       (application_id, storage_key, filename, mime, size_bytes, caption, display_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      application_id,
      input.storage_key,
      input.filename || null,
      input.mime || null,
      input.size_bytes || null,
      input.caption || null,
      input.display_order || 0,
    ],
  );
  return rows[0];
}

async function listMedia({ application_id }) {
  const { rows } = await query(
    `SELECT media_id, application_id, storage_key, filename, mime, size_bytes,
            caption, display_order, created_at
       FROM shared.job_application_media
      WHERE application_id = $1 ORDER BY display_order, created_at`,
    [application_id],
  );
  return rows;
}

async function getMedia({ media_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.job_application_media WHERE media_id = $1`,
    [media_id],
  );
  return rows[0] || null;
}

// ── Notes ──────────────────────────────────────────────────
async function addNote({ application_id, author_id, body }) {
  const { rows } = await query(
    `INSERT INTO shared.job_application_notes (application_id, author_id, body)
     VALUES ($1,$2,$3) RETURNING *`,
    [application_id, author_id || null, body],
  );
  return rows[0];
}

async function listNotes({ application_id }) {
  // shared.users has no display name of its own — resolve it through the user's
  // staff profile → contact (same path the org chart uses), falling back to the
  // login email so a note author is never blank.
  const { rows } = await query(
    `SELECT n.note_id, n.application_id, n.author_id, n.body, n.created_at,
            COALESCE(c.display_name, u.email) AS author_name
       FROM shared.job_application_notes n
       LEFT JOIN shared.users u          ON u.user_id = n.author_id
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c        ON c.contact_id = sp.contact_id
      WHERE n.application_id = $1 ORDER BY n.created_at ASC`,
    [application_id],
  );
  return rows;
}

// ── Ratings ────────────────────────────────────────────────
async function upsertRating({ application_id, rater_id, stars }) {
  const { rows } = await query(
    `INSERT INTO shared.job_application_ratings (application_id, rater_id, stars)
     VALUES ($1,$2,$3)
     ON CONFLICT (application_id, rater_id) DO UPDATE SET stars = EXCLUDED.stars, updated_at = now()
     RETURNING *`,
    [application_id, rater_id, stars],
  );
  return rows[0];
}

async function ratingSummary({ application_id, rater_id }) {
  const { rows } = await query(
    `SELECT COALESCE(AVG(stars), 0)::float AS avg_stars,
            COUNT(*)::int AS rating_count,
            MAX(stars) FILTER (WHERE rater_id = $2) AS my_stars
       FROM shared.job_application_ratings
      WHERE application_id = $1`,
    [application_id, rater_id || null],
  );
  return rows[0] || { avg_stars: 0, rating_count: 0, my_stars: null };
}

// ── Scores ─────────────────────────────────────────────────
async function insertScore({ input }) {
  const { rows } = await query(
    `INSERT INTO shared.job_application_scores
       (application_id, vacancy_id, score, summary, breakdown, scoring_stage, ai_provider, model)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`,
    [
      input.application_id,
      input.vacancy_id,
      input.score,
      input.summary || null,
      jsonb(input.breakdown),
      input.scoring_stage || "provisional",
      input.ai_provider || null,
      input.model || null,
    ],
  );
  return rows[0];
}

async function listScores({ application_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.job_application_scores
      WHERE application_id = $1 ORDER BY created_at DESC`,
    [application_id],
  );
  return rows;
}

// ── Pickers (org tree + permission roles) ──────────────────
async function listDepartments({ brand }) {
  const { rows } = await query(
    `SELECT unit_id, display_name
       FROM shared.org_units
      WHERE business = $1 AND is_active = true
      ORDER BY display_order NULLS LAST, display_name`,
    [brand],
  );
  return rows;
}

async function listPositions({ brand }) {
  const { rows } = await query(
    `SELECT p.position_id, p.display_name, p.role_id,
            u.display_name AS unit_name, r.role_name
       FROM shared.org_positions p
       JOIN shared.org_units u ON u.unit_id = p.unit_id
       LEFT JOIN shared.roles r ON r.role_id = p.role_id
      WHERE u.business = $1
      ORDER BY u.display_name, p.display_order NULLS LAST, p.display_name`,
    [brand],
  );
  return rows;
}

async function listRoles() {
  const { rows } = await query(
    `SELECT role_id, role_name FROM shared.roles ORDER BY role_name`,
  );
  return rows;
}

/** The brand's public storefront host (drives the absolute Careers-page URL). */
async function storefrontDomain({ brand }) {
  const { rows } = await query(
    `SELECT storefront_domain, sales_subdomain
       FROM shared.business_config WHERE business_key = $1`,
    [brand],
  );
  return rows[0] || null;
}

module.exports = {
  transaction,
  // vacancies
  slugExists,
  createVacancy,
  getVacancy,
  getVacancyBySlug,
  listVacancies,
  listPublishedVacancies,
  updateVacancy,
  deleteVacancy,
  // questions
  replaceQuestions,
  listQuestions,
  answerQuestion,
  // applications
  upsertApplication,
  getApplication,
  listApplications,
  updateApplication,
  // media
  addMedia,
  listMedia,
  getMedia,
  // notes
  addNote,
  listNotes,
  // ratings
  upsertRating,
  ratingSummary,
  // scores
  insertScore,
  listScores,
  // pickers
  listDepartments,
  listPositions,
  listRoles,
  storefrontDomain,
};
