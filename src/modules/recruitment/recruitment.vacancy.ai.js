/**
 * Vacancy AI — drafting, conversational intake follow-ups, screening-question
 * generation, and applicant match-scoring.
 *
 * Provider strategy (per the CEO):
 *   • Drafting (text → text): Gemini primary, DeepSeek fallback, deterministic
 *     template last so the wizard always opens with real content.
 *   • Scoring (must read CV *images* + work-sample photos): Gemini ONLY (vision),
 *     with a deterministic heuristic fallback so a vacancy is never un-scorable.
 *
 * Grounded in the same editable company-context pack the offer flow uses
 * (recruitment_context), so drafts understand both brands.
 */

"use strict";

const gemini = require("../../services/gemini.service");
const llm = require("../../services/llm.service");
const { contextText } = require("./recruitment.ai");
const { logger } = require("../../config/logger");

const DRAFT_SYSTEM = `You are the head of talent for a premium Nigerian hair & beauty group.
You write world-class, specific, results-focused Job Descriptions and Requirements that are true
to each brand, in clear British/Nigerian English, with no fluff. You ALWAYS return a single JSON
object and nothing else.`;

// ── 1) Conversational intake follow-ups (hybrid: scripted spine + AI gaps) ──
const FOLLOWUP_SCHEMA = {
  type: "object",
  properties: {
    followups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          question: { type: "string" },
        },
        required: ["key", "question"],
      },
    },
  },
  required: ["followups"],
};

/**
 * After the scripted questions are answered, ask Gemini whether anything
 * important is missing and, if so, return up to 2 short follow-up questions.
 * Never throws — returns [] when AI is unavailable (graceful degrade to the
 * pure scripted flow).
 */
async function suggestFollowups({ intake }) {
  const prompt = `A hiring manager is creating a job vacancy. Here are the details they've given so far:
${JSON.stringify(intake, null, 2)}

If something IMPORTANT for writing a strong vacancy is still missing or ambiguous (e.g. seniority,
key day-to-day responsibilities, must-have skills, whether the salary is negotiable, on-site day
split, reporting line), return up to TWO short, plain-English follow-up questions to ask them.
If you have enough to draft a great vacancy, return an empty list.

Return ONLY: { "followups": [ { "key": "<snake_case_field>", "question": "<question>" } ] }`;
  try {
    const r = await gemini.chatCompletion({
      system: DRAFT_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      maxOutputTokens: 512,
      thinkingBudget: 0,
      responseSchema: FOLLOWUP_SCHEMA,
      timeoutMs: 20000,
    });
    const parsed = parseJsonLoose(r.text);
    const arr = (parsed && Array.isArray(parsed.followups) ? parsed.followups : [])
      .filter((f) => f && f.question)
      .slice(0, 2);
    return arr;
  } catch (err) {
    logger.warn({ err: err.message }, "vacancy.ai: followup suggestion failed (skipping)");
    return [];
  }
}

// ── 2) Draft the whole vacancy from the intake ─────────────
const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    department: { type: "string" },
    seniority: { type: "string" },
    jd_markdown: { type: "string" },
    requirements_markdown: { type: "string" },
    meta: {
      type: "object",
      properties: {
        employment_type: { type: "string" }, // full_time|part_time|contract|internship
        workplace_model: { type: "string" }, // remote|hybrid|on_site
        days_on_site: { type: "integer" },
        days_off_site: { type: "integer" },
        days_off: { type: "integer" },
        working_hours: { type: "string" },
        location_city: { type: "string" },
        location_state: { type: "string" },
        location_country: { type: "string" },
        probation_months: { type: "integer" },
        salary_min: { type: "number" },
        salary_max: { type: "number" },
        target_start_date: { type: "string" },
        headcount: { type: "integer" },
      },
    },
  },
  required: ["jd_markdown", "requirements_markdown"],
};

function draftPrompt({ context, intake }) {
  return `Draft a complete job VACANCY for the role below (this is a public job posting, not an
offer letter to a named person — do NOT address a candidate).

COMPANY CONTEXT (ground everything in this — understand the brands):
${context}

INTAKE (what the hiring manager told us, possibly via voice):
${JSON.stringify(intake, null, 2)}

Return ONLY a JSON object:
{
  "title": "<clean official role title>",
  "department": "<best-fit department/team>",
  "seniority": "<junior|mid|senior|lead|manager, if inferable>",
  "jd_markdown": "<full job description in markdown: overview, what success looks like, key
     responsibilities grouped by area, and brand-specific mandates where relevant. NO salary block,
     NO requirements list here (requirements go in the next field).>",
  "requirements_markdown": "<required skills, certifications and minimum years of experience, plus a
     short 'nice to have' list, in markdown>",
  "meta": {
    "employment_type": "full_time|part_time|contract|internship",
    "workplace_model": "remote|hybrid|on_site",
    "days_on_site": <int or omit>, "days_off_site": <int or omit>, "days_off": <int or omit>,
    "working_hours": "<e.g. 9am–5pm, Mon–Fri>",
    "location_city": "", "location_state": "", "location_country": "",
    "probation_months": <int>,
    "salary_min": <number in NGN, your best market estimate if not given>,
    "salary_max": <number in NGN>,
    "target_start_date": "<YYYY-MM-DD or empty>",
    "headcount": <int>
  }
}
Fill meta from the intake where given; otherwise use sensible Nigerian-market defaults. Numbers must
be plain numbers (no currency symbols, no commas). Do not wrap the JSON in prose or code fences.`;
}

function valid(d) {
  return (
    d &&
    typeof d.jd_markdown === "string" &&
    d.jd_markdown.trim().length > 40 &&
    typeof d.requirements_markdown === "string" &&
    d.requirements_markdown.trim().length > 10
  );
}

/** Draft the vacancy: Gemini → DeepSeek → deterministic template. Never throws. */
async function draftVacancy({ intake, targets }) {
  const context = await contextText({ targets });
  const prompt = draftPrompt({ context, intake });

  // 1) Gemini (primary)
  try {
    const r = await gemini.chatCompletion({
      system: DRAFT_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
      maxOutputTokens: 4096,
      thinkingBudget: 0,
      responseSchema: DRAFT_SCHEMA,
      timeoutMs: 45000,
    });
    const parsed = parseJsonLoose(r.text);
    if (valid(parsed)) return { ...normaliseDraft(parsed), provider: "gemini" };
    logger.warn("vacancy.ai: gemini returned unusable draft, falling back");
  } catch (err) {
    logger.warn({ err: err.message }, "vacancy.ai: gemini draft failed, trying deepseek");
  }

  // 2) DeepSeek (fallback, text-only)
  try {
    const vendor = (await llm.resolveVendor("deepseek")) || (await llm.resolveVendor());
    if (vendor) {
      const r = await llm.chat({
        vendor,
        messages: [
          { role: "system", content: DRAFT_SYSTEM },
          { role: "user", content: prompt },
        ],
        temperature: 0.6,
        max_tokens: 4096,
      });
      const parsed = parseJsonLoose(r.content);
      if (valid(parsed)) return { ...normaliseDraft(parsed), provider: vendor.vendor || "deepseek" };
    }
  } catch (err) {
    logger.warn({ err: err.message }, "vacancy.ai: deepseek draft failed, using template");
  }

  // 3) Deterministic template
  return { ...templateVacancy({ intake }), provider: "template" };
}

const WORKPLACE = new Set(["remote", "hybrid", "on_site"]);
const EMPLOYMENT = new Set(["full_time", "part_time", "contract", "internship"]);

/** Coerce the AI's meta into our column vocabulary + types. */
function normaliseDraft(d) {
  const m = d.meta || {};
  const num = (v) => (v === "" || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
  const int = (v) => (num(v) === null ? null : Math.round(num(v)));
  return {
    title: d.title || null,
    department: d.department || null,
    seniority: d.seniority || null,
    jd_markdown: d.jd_markdown,
    requirements_markdown: d.requirements_markdown,
    meta: {
      employment_type: EMPLOYMENT.has(m.employment_type) ? m.employment_type : "full_time",
      workplace_model: WORKPLACE.has(m.workplace_model) ? m.workplace_model : "on_site",
      days_on_site: int(m.days_on_site),
      days_off_site: int(m.days_off_site),
      days_off: int(m.days_off),
      working_hours: m.working_hours || null,
      location_city: m.location_city || null,
      location_state: m.location_state || null,
      location_country: m.location_country || null,
      probation_months: int(m.probation_months) ?? 3,
      salary_min: num(m.salary_min),
      salary_max: num(m.salary_max),
      target_start_date: /^\d{4}-\d{2}-\d{2}$/.test(m.target_start_date || "") ? m.target_start_date : null,
      headcount: int(m.headcount) || 1,
    },
  };
}

function templateVacancy({ intake }) {
  const i = intake || {};
  const title = i.title || i.role || "New Role";
  const dept = i.department || "Operations";
  const jd_markdown = `# ${title}

## Overview
We are hiring a **${title}** in our ${dept} team. This is a results-focused role: come up with
the best strategies, execute them flawlessly, and deliver measurable results.

## What success looks like
- Clear strategy, shipped and owned end to end
- Quantifiable growth against agreed targets
- Stronger brand equity and new opportunities opened

## Key responsibilities
- Own the strategy and execution for this function
- Turn market insight into decisions
- Set, track and hit clear, quantifiable targets
- Report results and learnings to leadership each month`;

  const requirements_markdown = `## Requirements
- ${i.experience_years || "3+"} years of relevant experience
- A demonstrable, quantifiable track record of results
- Strong ownership, communication and commercial instinct

## Nice to have
- Background in beauty, hair, fashion or consumer/e-commerce
- An existing relevant network`;

  return {
    title,
    department: dept,
    seniority: i.seniority || null,
    jd_markdown,
    requirements_markdown,
    meta: {
      employment_type: EMPLOYMENT.has(i.employment_type) ? i.employment_type : "full_time",
      workplace_model: WORKPLACE.has(i.workplace_model) ? i.workplace_model : "on_site",
      days_on_site: null,
      days_off_site: null,
      days_off: null,
      working_hours: i.working_hours || null,
      location_city: i.location_city || null,
      location_state: i.location_state || null,
      location_country: i.location_country || "Nigeria",
      probation_months: Number(i.probation_months) || 3,
      salary_min: Number(i.salary_min) || null,
      salary_max: Number(i.salary_max) || null,
      target_start_date: null,
      headcount: Number(i.headcount) || 1,
    },
  };
}

// ── 3) Generate the 5 strategic screening questions ────────
const QUESTIONS_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["question"],
      },
    },
  },
  required: ["questions"],
};

/**
 * Generate 5 role-specific strategic questions the hiring manager answers to
 * define the "ideal candidate" rubric. NOT shown to the candidate. Gemini →
 * template fallback. Never throws.
 */
async function generateScreeningQuestions({ vacancy, targets }) {
  const context = await contextText({ targets });
  const prompt = `You are helping a hiring manager screen applicants for this role. Read the vacancy and
propose EXACTLY 5 strategic, role-specific questions the hiring manager should answer to define what
the IDEAL candidate looks like. These become the rubric an AI uses to rank applicants — so they must
be discriminating (not generic "are they a team player" fluff), and specific to THIS role and brand.

COMPANY CONTEXT:
${context}

VACANCY:
Title: ${vacancy.title}
Department: ${vacancy.department || ""}
Job description:
${vacancy.jd_markdown || ""}
Requirements:
${vacancy.requirements_markdown || ""}

Return ONLY: { "questions": [ { "question": "...", "rationale": "why this matters for ranking" } x5 ] }`;
  try {
    const r = await gemini.chatCompletion({
      system: DRAFT_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      maxOutputTokens: 1536,
      thinkingBudget: 0,
      responseSchema: QUESTIONS_SCHEMA,
      timeoutMs: 30000,
    });
    const parsed = parseJsonLoose(r.text);
    const qs = (parsed && Array.isArray(parsed.questions) ? parsed.questions : [])
      .filter((q) => q && q.question)
      .slice(0, 5);
    if (qs.length >= 3) return { questions: qs, provider: "gemini" };
  } catch (err) {
    logger.warn({ err: err.message }, "vacancy.ai: question generation failed, using template");
  }
  return { questions: templateQuestions(vacancy), provider: "template" };
}

function templateQuestions(vacancy) {
  const t = vacancy.title || "this role";
  return [
    { question: `What specific, measurable results must a great ${t} deliver in the first 6 months?`, rationale: "Sets the outcome bar to rank candidates against." },
    { question: `Which 3 hard skills or tools are non-negotiable for this role?`, rationale: "Filters on must-have capability." },
    { question: `What level and type of prior experience best predicts success here?`, rationale: "Calibrates seniority and background fit." },
    { question: `What would make you reject an otherwise strong CV for this role?`, rationale: "Captures deal-breakers." },
    { question: `What does an ideal candidate's portfolio or track record look like?`, rationale: "Defines evidence of excellence." },
  ];
}

// ── 4) Score an applicant against the vacancy (+ rubric) ───
const SCORE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    summary: { type: "string" },
    breakdown: {
      type: "object",
      properties: {
        skills_fit: { type: "number" },
        experience_fit: { type: "number" },
        salary_fit: { type: "number" },
        questionnaire_fit: { type: "number" },
        portfolio_fit: { type: "number" },
        notes: { type: "string" },
      },
    },
  },
  required: ["score"],
};

/**
 * Score one applicant 0–100 against the vacancy and (when answered) the hiring
 * manager's rubric. `attachments` is an array of already-loaded inline parts
 * ({ mime_type, data }) — the CV (image/pdf) and any work-sample images — so
 * this module stays storage-agnostic. Gemini vision only; on any failure we
 * fall back to a deterministic heuristic so every applicant still gets a score.
 *
 * @returns {{score:number, summary:string, breakdown:object, provider:string, model:string|null, scoring_stage:string}}
 */
async function scoreApplication({ vacancy, application, questions, attachments }) {
  const answered = (questions || []).filter((q) => q.answer && q.answer.trim());
  const scoring_stage = answered.length ? "rubric" : "provisional";

  const rubric = answered.length
    ? answered.map((q, i) => `Q${i + 1}: ${q.question}\nIdeal answer (rubric): ${q.answer}`).join("\n\n")
    : "The hiring manager has not yet answered the screening questions — score provisionally on JD fit alone.";

  const band =
    vacancy.salary_min || vacancy.salary_max
      ? `${vacancy.salary_currency || "NGN"} ${vacancy.salary_min || "?"}–${vacancy.salary_max || "?"} / ${vacancy.salary_period || "month"}`
      : "not specified";

  const textPrompt = `Score this job applicant against the vacancy from 0 to 100 (100 = perfect fit).
Be discriminating and honest — most applicants are NOT a 90.

VACANCY
Title: ${vacancy.title}
Job description:
${vacancy.jd_markdown || ""}
Requirements:
${vacancy.requirements_markdown || ""}
Salary band: ${band}

IDEAL-CANDIDATE RUBRIC (weigh this heavily when present):
${rubric}

APPLICANT
Name: ${application.full_name}
Stated skills (with years): ${JSON.stringify(application.skills || [])}
Desired salary: ${application.desired_salary_text || application.desired_salary || "not stated"}
Notice period: ${application.notice_period || "not stated"}
Professional links: ${JSON.stringify(application.portfolio_links || [])}
${application.cv_text ? `CV text:\n${String(application.cv_text).slice(0, 8000)}` : "CV is attached as a file/image."}
${(attachments || []).length ? "Attached: the applicant's CV and/or work-sample images — read them." : ""}

Return ONLY:
{ "score": <0-100>, "summary": "<one sentence: the single most important reason for this score>",
  "breakdown": { "skills_fit": <0-100>, "experience_fit": <0-100>, "salary_fit": <0-100>,
                 "questionnaire_fit": <0-100>, "portfolio_fit": <0-100>, "notes": "<2-3 sentence rationale>" } }`;

  const content = [{ type: "text", text: textPrompt }, ...(attachments || [])];

  // Two attempts: a CV can be a long multi-page PDF, so we give the read a
  // generous timeout and retry transient failures once before ever dropping to
  // the (much weaker) deterministic estimate. Falling back should be rare.
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await gemini.chatCompletion({
        system:
          "You are a rigorous, fair technical recruiter. You open and read the attached CV (PDF or image) in full before scoring. You ALWAYS return a single JSON object.",
        messages: [{ role: "user", content }],
        temperature: 0.2,
        maxOutputTokens: 1200,
        thinkingBudget: 0,
        responseSchema: SCORE_SCHEMA,
        timeoutMs: 120000,
      });
      const parsed = parseJsonLoose(r.text);
      if (parsed && typeof parsed.score === "number") {
        return {
          score: clamp(parsed.score),
          summary: parsed.summary || "",
          breakdown: parsed.breakdown || {},
          provider: "gemini",
          model: r.model || null,
          scoring_stage,
        };
      }
      logger.warn({ attempt }, "vacancy.ai: gemini scoring returned unusable output");
    } catch (err) {
      lastErr = err;
      logger.warn(
        { attempt, err: err.message, status: err.status, api_error: err.api_message },
        "vacancy.ai: gemini scoring attempt failed",
      );
      if (err && err.retryable === false) break;
    }
  }
  logger.warn(
    { err: lastErr && lastErr.message },
    "vacancy.ai: gemini scoring exhausted — using deterministic estimate",
  );
  return { ...heuristicScore({ vacancy, application }), scoring_stage };
}

/**
 * Deterministic fallback so a vacancy is never un-scorable when the AI read is
 * unavailable. It does NOT open the CV file — it estimates from the structured
 * application (declared skills + years, salary vs band, portfolio links). It
 * deliberately does NOT keyword-match skills against the JD text: a strong CV
 * whose wording differs from the posting would score near zero, which is
 * exactly the wrong signal. Clearly labelled provider=heuristic so the UI can
 * say "AI read pending".
 */
function heuristicScore({ vacancy, application }) {
  const skills = Array.isArray(application.skills) ? application.skills : [];
  const yearsOf = (s) => {
    const raw = String((s && (s.years ?? s.year)) ?? "").replace(/[^\d.]/g, "");
    const y = Number(raw);
    return isNaN(y) ? 0 : y;
  };
  const yearsList = skills.map(yearsOf);
  const maxYears = yearsList.length ? Math.max(...yearsList) : 0;
  const totalYears = yearsList.reduce((a, b) => a + b, 0);

  // Breadth (how many skills) + depth (accumulated years), capped.
  const skills_fit = skills.length ? clamp(40 + skills.length * 7 + Math.min(totalYears, 30)) : 30;
  // Seniority proxy from the deepest single skill.
  const experience_fit = clamp(maxYears ? 30 + maxYears * 7 : 45);

  // Desired salary vs the band.
  let salary_fit = 65;
  const desired = Number(application.desired_salary);
  const lo = Number(vacancy.salary_min);
  const hi = Number(vacancy.salary_max);
  if (desired && (lo || hi)) {
    if ((!lo || desired >= lo) && (!hi || desired <= hi)) salary_fit = 100;
    else if (hi && desired > hi) salary_fit = clamp(100 - ((desired - hi) / hi) * 100);
    else if (lo && desired < lo) salary_fit = 85; // under budget — fine
  }

  const links = Array.isArray(application.portfolio_links)
    ? application.portfolio_links.filter((l) => l && l.url)
    : [];
  const portfolio_fit = links.length ? clamp(55 + links.length * 12) : null;

  const dims = [
    [skills_fit, 0.35],
    [experience_fit, 0.35],
    [salary_fit, 0.2],
    [portfolio_fit, 0.1],
  ].filter(([v]) => v !== null && v !== undefined);
  const wsum = dims.reduce((a, [, w]) => a + w, 0) || 1;
  const score = clamp(dims.reduce((a, [v, w]) => a + v * w, 0) / wsum);

  return {
    score,
    summary:
      "Estimate from stated skills, experience and salary — a full AI read of the CV is still pending (tap Score to run it).",
    breakdown: {
      skills_fit,
      experience_fit,
      salary_fit,
      questionnaire_fit: null,
      portfolio_fit,
      notes:
        "Interim estimate only — it does NOT open the CV file. Tap “Score” to run the full AI assessment that reads the résumé.",
    },
    provider: "heuristic",
    model: null,
  };
}

const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

// ── shared JSON helper ─────────────────────────────────────
function parseJsonLoose(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

module.exports = {
  suggestFollowups,
  draftVacancy,
  generateScreeningQuestions,
  scoreApplication,
};
