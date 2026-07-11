/**
 * Recruitment AI drafting.
 *
 * Drafts a full Job Description + Offer Letter (markdown) from a short intake,
 * grounded in the editable company-context pack so the copy actually understands
 * both brands. Provider strategy (per the CEO): Gemini primary, DeepSeek
 * fallback, and — so the feature never hard-fails — a deterministic template
 * fallback when no AI vendor is configured or both calls fail.
 *
 * A future PR wires the same draft() as a Praxis action (conversational "draft a
 * JD for X"); keeping the drafting logic here, provider-agnostic, makes that a
 * thin wrapper rather than a rewrite.
 */

"use strict";

const gemini = require("../../services/gemini.service");
const llm = require("../../services/llm.service");
const repo = require("./recruitment.repo");
const { logger } = require("../../config/logger");

const SYSTEM = `You are the head of talent for a premium Nigerian hair & beauty group.
You write world-class Job Descriptions and Offer Letters that are specific, results-focused,
and true to each brand. You avoid fluff and vanity language. You write in clear British/Nigerian
English. You ALWAYS return a single JSON object and nothing else.`;

/** Compose a grounding block from the company-context rows for the target brands. */
async function contextText({ targets }) {
  const rows = await repo.getContext({ businesses: targets || [] });
  if (!rows.length) return "No extra company context on file.";
  return rows
    .map((r) => {
      const lines = [
        `## ${r.display_name || r.business} (${r.business})`,
        r.summary && `Summary: ${r.summary}`,
        r.tone && `Brand voice: ${r.tone}`,
        r.target_markets && `Target markets: ${r.target_markets}`,
        r.non_negotiables && `Non-negotiables: ${r.non_negotiables}`,
        r.notes && `Notes: ${r.notes}`,
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n");
}

function userPrompt({ context, intake }) {
  return `Draft a Job Description and an Offer Letter for the role below.

COMPANY CONTEXT (ground everything in this — understand the brands):
${context}

ROLE INTAKE (from the CEO):
${JSON.stringify(intake, null, 2)}

Return ONLY a JSON object with these keys:
{
  "jd_markdown": "<the full job description in markdown: overview, what success looks like, key responsibilities grouped by area, brand-specific mandates where relevant, KPIs, requirements, nice-to-haves>",
  "offer_markdown": "<the full offer letter body in markdown, addressed to the candidate, covering position, reporting line, start, remuneration incl. probation vs post-probation, probation terms, and confidentiality — use bracketed [placeholders] only for details not provided in the intake. DO NOT append an acceptance or signature block at the end of the letter (no 'Accepted and Agreed:', no ruled '____________ [Candidate Name]' / 'Date' placeholders, no 'Signed by the Candidate'). The system appends its own formal execution block with real e-signature slots for both the candidate and the countersignatory — anything you add here would produce a duplicate signature area. End with the sign-off only (e.g. 'Warm regards,\\n\\n{signatory_name}\\n{signatory_title}').>",
  "offer_meta": {
    "reporting_to": "", "employment_type": "", "location": "",
    "probation_months": 3, "review_days": 60,
    "salary_probation": "", "salary_post_probation": "", "variable_pay": "",
    "start_date": "", "additional_terms": ""
  }
}
Fill offer_meta from the intake where given; leave unknown strings empty. Do not wrap the JSON in prose or code fences.`;
}

const GEMINI_SCHEMA = {
  type: "object",
  properties: {
    jd_markdown: { type: "string" },
    offer_markdown: { type: "string" },
    offer_meta: {
      type: "object",
      properties: {
        reporting_to: { type: "string" },
        employment_type: { type: "string" },
        location: { type: "string" },
        probation_months: { type: "integer" },
        review_days: { type: "integer" },
        salary_probation: { type: "string" },
        salary_post_probation: { type: "string" },
        variable_pay: { type: "string" },
        start_date: { type: "string" },
        additional_terms: { type: "string" },
      },
    },
  },
  required: ["jd_markdown", "offer_markdown"],
};

/** Pull the first balanced {...} JSON object out of a text blob and parse it. */
function parseJsonLoose(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* fall through to extraction */
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

function valid(d) {
  return (
    d &&
    typeof d.jd_markdown === "string" &&
    d.jd_markdown.trim().length > 40 &&
    typeof d.offer_markdown === "string" &&
    d.offer_markdown.trim().length > 40
  );
}

/** Draft via Gemini → DeepSeek → deterministic template. Never throws. */
async function draft({ intake, targets }) {
  const context = await contextText({ targets });
  const prompt = userPrompt({ context, intake });

  // 1) Gemini (primary)
  try {
    const r = await gemini.chatCompletion({
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
      maxOutputTokens: 4096,
      thinkingBudget: 0, // deterministic JSON — don't let thinking eat the budget
      responseSchema: GEMINI_SCHEMA,
      timeoutMs: 45000,
    });
    const parsed = parseJsonLoose(r.text);
    if (valid(parsed)) return { ...parsed, provider: "gemini" };
    logger.warn("recruitment.ai: gemini returned unusable draft, falling back");
  } catch (err) {
    logger.warn({ err: err.message }, "recruitment.ai: gemini draft failed, falling back to deepseek");
  }

  // 2) DeepSeek (fallback) — OpenAI-compatible via llm.service
  try {
    const vendor = (await llm.resolveVendor("deepseek")) || (await llm.resolveVendor());
    if (vendor) {
      const r = await llm.chat({
        vendor,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
        temperature: 0.6,
        max_tokens: 4096,
      });
      const parsed = parseJsonLoose(r.content);
      if (valid(parsed)) return { ...parsed, provider: vendor.vendor || "deepseek" };
      logger.warn("recruitment.ai: deepseek returned unusable draft, using template");
    }
  } catch (err) {
    logger.warn({ err: err.message }, "recruitment.ai: deepseek draft failed, using template");
  }

  // 3) Deterministic template (always works)
  return { ...templateDraft({ intake }), provider: "template" };
}

/** A solid, editable fallback so the studio always opens with real content. */
function templateDraft({ intake }) {
  const i = intake || {};
  const title = i.title || "New Role";
  const brands = (i.target_businesses || []).join(" and ") || "the company";
  const reporting = i.reporting_to || "the CEO";
  const employment = (i.employment_type || "full_time").replace(/_/g, " ");
  const location = i.location || "[Location]";
  const resp = Array.isArray(i.responsibilities) && i.responsibilities.length
    ? i.responsibilities
    : [
        "Own the strategy and execution for this function across the brands",
        "Research the market and turn insight into decisions",
        "Set, track and hit clear, quantifiable targets",
        "Report results and learnings to leadership each month",
      ];
  const reqs = Array.isArray(i.requirements) && i.requirements.length
    ? i.requirements
    : [
        `${i.experience_years || "5–7"}+ years of relevant experience`,
        "A demonstrable, quantifiable track record of results",
        "Strong ownership, communication and commercial instinct",
      ];

  const jd_markdown = `# ${title}

## Overview
We are hiring a **${title}** to serve **${brands}**, reporting to ${reporting}. This is a
${employment} role based in ${location}. The mission: come up with the best strategies, execute
them flawlessly, and deliver measurable results.

## What success looks like
- Clear strategy, shipped and owned end to end
- Quantifiable growth against agreed targets
- Stronger brand equity and new opportunities opened

## Key responsibilities
${resp.map((r) => `- ${r}`).join("\n")}

## Requirements
${reqs.map((r) => `- ${r}`).join("\n")}

## Nice to have
- Background in beauty, hair, fashion or consumer/e-commerce
- An existing relevant network`;

  const salaryProb = i.salary_probation || "[probation salary]";
  const salaryPost = i.salary_post_probation || "[post-probation salary]";
  const offer_markdown = `## Re: Offer of Employment — ${title}

Dear [Candidate First Name],

We are delighted to offer you the position of **${title}**, serving ${brands} and reporting to
${reporting}.

**Position & reporting.** You will own this function end to end, as set out in the accompanying
Job Description.

**Start date.** [Start Date], or another date agreed in writing.

**Location & type.** ${location}, ${employment}.

**Remuneration.** During your probationary period your salary is **${salaryProb}**. On successful
completion of probation this rises to **${salaryPost}**${
    i.variable_pay ? `, plus ${i.variable_pay}` : ""
  }. All pay is subject to statutory deductions.

**Probation.** ${i.probation_months || 3} month(s), with a formal review at day ${
    i.review_days || 60
  }. This is a results-focused role.

**Confidentiality.** Your employment is subject to confidentiality, data-protection and IP terms
in your full contract.

To accept, please sign electronically at the bottom of this page.

Warm regards,
${i.signatory_name || "Faith"}
${i.signatory_title || "Chief Executive Officer"}`;

  return {
    jd_markdown,
    offer_markdown,
    offer_meta: {
      reporting_to: i.reporting_to || "",
      employment_type: i.employment_type || "full_time",
      location: i.location || "",
      probation_months: i.probation_months || 3,
      review_days: i.review_days || 60,
      salary_probation: i.salary_probation || "",
      salary_post_probation: i.salary_post_probation || "",
      variable_pay: i.variable_pay || "",
      start_date: i.start_date || "",
      additional_terms: i.additional_terms || "",
    },
  };
}

module.exports = { draft, templateDraft, contextText };
