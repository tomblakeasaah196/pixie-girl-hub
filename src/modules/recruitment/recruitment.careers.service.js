/**
 * Careers (public, no-login) service — the candidate-facing half of the
 * vacancy flow. Powers the storefront Careers page + application form:
 *
 *   GET  /api/public/careers            → published vacancies for the brand
 *   GET  /api/public/careers/:slug      → one vacancy (JD/requirements as HTML)
 *   POST /api/public/careers/:slug/apply→ submit an application (+ uploads)
 *
 * Brand comes from the host resolver (req.brand). No permission gate — a
 * published vacancy is public by definition; the apply endpoint is rate-limited
 * and honeypot-guarded, and a re-application by the same email updates the
 * existing row (dedupe by update).
 */

"use strict";

const crypto = require("crypto");
const axios = require("axios");
const repo = require("./recruitment.vacancy.repo");
const offersRepo = require("./recruitment.repo");
const vacancyService = require("./recruitment.vacancy.service");
const events = require("./recruitment.events");
const render = require("./recruitment.render");
const storage = require("../../services/storage.service");
const { sendTransactionalEmail } = require("../../services/transactional-email");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { NotFoundError, AppError } = require("../../utils/errors");

const escHtml = (s) =>
  String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// ── Public reads ───────────────────────────────────────────
function toPublicList(v) {
  return {
    title: v.title,
    slug: v.slug,
    department: v.department,
    employment_type: v.employment_type,
    workplace_model: v.workplace_model,
    location_city: v.location_city,
    location_state: v.location_state,
    location_country: v.location_country,
    salary_min: v.salary_hidden ? null : v.salary_min,
    salary_max: v.salary_hidden ? null : v.salary_max,
    salary_currency: v.salary_currency,
    salary_period: v.salary_period,
    salary_hidden: v.salary_hidden,
    target_start_date: v.target_start_date,
    published_at: v.published_at,
  };
}

const listVacancies = async ({ brand }) => {
  const rows = await repo.listPublishedVacancies({ brand });
  return rows.map(toPublicList);
};

async function getVacancy({ brand, slug }) {
  const v = await repo.getVacancyBySlug({ slug, brand });
  if (!v || v.status !== "published") throw new NotFoundError("Vacancy");
  const cfg = v.apply_config || {};
  return {
    ...toPublicList(v),
    // Server-rendered, XSS-safe HTML (same renderer the offer packet uses).
    jd_html: render.markdownToHtml(v.jd_markdown || ""),
    requirements_html: render.markdownToHtml(v.requirements_markdown || ""),
    workplace_model: v.workplace_model,
    days_on_site: v.days_on_site,
    days_off_site: v.days_off_site,
    days_off: v.days_off,
    working_hours: v.working_hours,
    probation_months: v.probation_months,
    headcount: v.headcount,
    apply_config: {
      request_headshot: !!cfg.request_headshot,
      request_work_images: !!cfg.request_work_images,
      max_work_images: Math.min(Number(cfg.max_work_images) || 3, 3),
      require_cover_letter: !!cfg.require_cover_letter,
      require_portfolio_links: !!cfg.require_portfolio_links,
    },
  };
}

// ── Anti-abuse ─────────────────────────────────────────────
/**
 * Cloudflare Turnstile verification — only enforced when TURNSTILE_SECRET_KEY
 * is configured, so the form works out of the box in dev and turns into a real
 * captcha the moment a key is added (frontend renders the widget on the same
 * condition via VITE_TURNSTILE_SITE_KEY). Never throws on a network hiccup —
 * it fails open rather than blocking a genuine applicant on our outage.
 */
async function verifyCaptcha({ token, ip }) {
  const secret = config.TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // captcha not configured — skip
  if (!token) return false;
  try {
    const params = new URLSearchParams({ secret, response: token });
    if (ip) params.append("remoteip", ip);
    const { data } = await axios.post(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      params.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 8000 },
    );
    return !!(data && data.success);
  } catch (err) {
    logger.warn({ err: err.message }, "careers: turnstile verify errored — failing open");
    return true;
  }
}

// ── File storage ───────────────────────────────────────────
const CV_MIMES = /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|image\/(jpeg|jpg|png|webp|heic|heif))$/i;
const IMG_MIMES = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i;

function extFor(mime, fallback) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("pdf")) return "pdf";
  if (m.includes("wordprocessingml")) return "docx";
  if (m.includes("msword")) return "doc";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("heic") || m.includes("heif")) return "heic";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  return fallback || "bin";
}

async function storeFile(file, prefix) {
  const key = `recruitment/applications/${prefix}/${crypto.randomBytes(8).toString("hex")}.${extFor(file.mimetype)}`;
  await storage.put(file.buffer, { key, contentType: file.mimetype });
  return key;
}

const parseJson = (s, fallback) => {
  if (s === undefined || s === null || s === "") return fallback;
  if (typeof s !== "string") return s;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

// ── Submit an application ──────────────────────────────────
async function submitApplication({ brand, slug, body, files, ip, ua }) {
  // Honeypot: real users never fill a hidden field. Silently accept (so a bot
  // gets no signal) but do nothing.
  if (body.company_website) {
    return { ok: true };
  }

  const vacancy = await repo.getVacancyBySlug({ slug, brand });
  if (!vacancy || vacancy.status !== "published")
    throw new NotFoundError("Vacancy");

  const ok = await verifyCaptcha({ token: body.captcha_token, ip });
  if (!ok)
    throw new AppError("CAPTCHA_FAILED", "captcha verification failed", 400, {
      user_message: "We couldn't verify you're human — please retry the check.",
    });

  const f = files || {};
  const cv = f.cv && f.cv[0];
  if (!cv)
    throw new AppError("CV_REQUIRED", "cv is required", 422, {
      user_message: "Please attach your CV / résumé.",
    });
  if (!CV_MIMES.test(cv.mimetype))
    throw new AppError("CV_BAD_TYPE", "unsupported cv type", 415, {
      user_message: "Your CV must be a PDF, Word document, or a clear image (JPG/PNG).",
    });

  const prefix = `${vacancy.vacancy_id}/${crypto.randomBytes(4).toString("hex")}`;
  const cvKey = await storeFile(cv, prefix);

  let headshotKey = null;
  let headshotMime = null;
  if (f.headshot && f.headshot[0] && IMG_MIMES.test(f.headshot[0].mimetype)) {
    headshotKey = await storeFile(f.headshot[0], prefix);
    headshotMime = f.headshot[0].mimetype;
  }

  let coverKey = null;
  let coverName = null;
  let coverMime = null;
  if (f.cover_letter_file && f.cover_letter_file[0]) {
    const cl = f.cover_letter_file[0];
    coverKey = await storeFile(cl, prefix);
    coverName = cl.originalname || "cover-letter";
    coverMime = cl.mimetype;
  }

  const application = await repo.upsertApplication({
    input: {
      vacancy_id: vacancy.vacancy_id,
      business: brand,
      full_name: body.full_name,
      email: body.email,
      phone: body.phone || null,
      address: body.address || null,
      cover_letter_text: body.cover_letter_text || null,
      cover_letter_key: coverKey,
      cover_letter_filename: coverName,
      cover_letter_mime: coverMime,
      cv_key: cvKey,
      cv_filename: cv.originalname || `cv.${extFor(cv.mimetype)}`,
      cv_mime: cv.mimetype,
      headshot_key: headshotKey,
      headshot_mime: headshotMime,
      portfolio_links: parseJson(body.portfolio_links, []),
      notice_period: body.notice_period || null,
      desired_salary: body.desired_salary ? Number(body.desired_salary) : null,
      desired_salary_currency: body.desired_salary_currency || "NGN",
      desired_salary_text: body.desired_salary_text || body.desired_salary || null,
      skills: parseJson(body.skills, []),
      source: body.source || null,
      stage: "new",
    },
  });

  // Work-sample images (up to 3). A re-application replaces the set.
  const workFiles = (f.work_images || []).filter((x) => IMG_MIMES.test(x.mimetype)).slice(0, 3);
  if (workFiles.length) {
    let order = 0;
    for (const wf of workFiles) {
      const key = await storeFile(wf, prefix);
      await repo.addMedia({
        application_id: application.application_id,
        input: {
          storage_key: key,
          filename: wf.originalname || null,
          mime: wf.mimetype,
          size_bytes: wf.size || null,
          display_order: order++,
        },
      });
    }
  }

  events.emit("application_received", {
    application_id: application.application_id,
    vacancy_id: vacancy.vacancy_id,
    business: brand,
  });

  // Provisional AI score — fire-and-forget so the applicant isn't kept waiting
  // on a model call. The pipeline shows the score moments later.
  vacancyService
    .scoreApplication({ brand, user: null, request_id: null, id: application.application_id })
    .catch((err) =>
      logger.warn({ err: err.message, application_id: application.application_id }, "careers: provisional score failed"),
    );

  // "Application received" confirmation email (best-effort, branded).
  sendReceivedEmail({ brand, application, vacancy }).catch((err) =>
    logger.warn({ err: err.message }, "careers: received-email failed"),
  );

  return { ok: true, application_id: application.application_id };
}

async function sendReceivedEmail({ brand, application, vacancy }) {
  const branding = await offersRepo.businessBranding({ brand });
  const name = branding?.display_name || brand;
  await sendTransactionalEmail({
    brand,
    to: application.email,
    subject: `We've received your application — ${vacancy.title}`,
    preheader: `Thanks for applying to ${name}. We'll be in touch.`,
    eyebrow: "Application received",
    heading: `Thank you, ${escHtml(application.full_name.split(" ")[0] || "there")}`,
    intro: `We've received your application for <b>${escHtml(vacancy.title)}</b> at ${escHtml(name)}.`,
    body: [
      {
        html: "Our team will review it carefully. If your experience matches what we're looking for, we'll reach out about next steps. Thank you for your interest.",
        muted: true,
      },
    ],
    signoff: `Warm regards,<br/>The ${escHtml(name)} team`,
  });
}

module.exports = {
  listVacancies,
  getVacancy,
  submitApplication,
};
