/**
 * Stylist Studio AI job summary.
 *
 * One-click "what's going on with this job" for a manager glancing at the
 * board — status, on-track vs at-risk, the one thing worth knowing. Follows
 * the same provider strategy as recruitment.ai.js: Gemini primary, an
 * OpenAI-compatible vendor via llm.service as fallback, and a deterministic
 * rule-based sentence when no AI vendor is configured or both calls fail —
 * this never hard-fails, since it's a convenience layered on data the
 * manager can already see in the drawer, not a source of truth.
 */

"use strict";

const gemini = require("../../services/gemini.service");
const llm = require("../../services/llm.service");
const { logger } = require("../../config/logger");

const SYSTEM = `You are an operations assistant for a hair styling business.
Summarize ONE styling job for a manager scanning their queue: current status, whether it's
on track or at risk (overdue, low ratings, repeated rework, a wig stuck out with a stylist too
long), and the single thing most worth their attention. 2-4 short sentences, plain language,
no markdown, no headers, no bullet points. Be direct — if everything's fine, say so briefly and
move on.`;

function facts(job) {
  const now = Date.now();
  const dueAt = job.sla_due_at || job.expected_completion_at;
  const overdue =
    dueAt && !job.completed_at && new Date(dueAt).getTime() < now;
  return {
    job_number: job.job_number,
    tag_code: job.tag_code,
    status: job.status,
    service_type: job.service_type_name,
    styled_product: job.styled_product_name,
    due_at: dueAt || null,
    overdue,
    completed_at: job.completed_at || null,
    quality_rating: job.quality_rating,
    customer_rating: job.customer_rating,
    quality_notes: job.quality_notes || null,
    rework_count: job.rework_count || 0,
    wig_currently_out: !!job.wig_out_at,
    wig_out_since: job.wig_out_at || null,
  };
}

function userPrompt(job) {
  return `Job facts (JSON):\n${JSON.stringify(facts(job), null, 2)}\n\nWrite the summary now.`;
}

/** Rule-based fallback — always available, no AI vendor required. */
function templateSummary(job) {
  const f = facts(job);
  const parts = [];
  parts.push(
    `Job ${f.job_number}${f.tag_code ? ` (tag ${f.tag_code})` : ""} is currently ${f.status.replace(/_/g, " ")}.`,
  );
  if (f.overdue) {
    parts.push(`It's overdue — due ${f.due_at}.`);
  } else if (f.due_at && !f.completed_at) {
    parts.push(`Due ${f.due_at}, on track so far.`);
  }
  if (f.rework_count > 0) {
    parts.push(
      `Has gone through rework ${f.rework_count} time${f.rework_count === 1 ? "" : "s"}${f.quality_notes ? ` — latest QC note: "${f.quality_notes}"` : ""}.`,
    );
  }
  if (f.quality_rating) parts.push(`Quality rated ${f.quality_rating}/5.`);
  if (f.customer_rating) parts.push(`Customer happiness rated ${f.customer_rating}/5.`);
  if (f.wig_currently_out) parts.push(`The wig is currently out with the stylist.`);
  return parts.join(" ");
}

/** Summarize a job via Gemini → llm.service → deterministic template. Never throws. */
async function summarizeJob(job) {
  const prompt = userPrompt(job);

  try {
    const r = await gemini.chatCompletion({
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      maxOutputTokens: 300,
      thinkingBudget: 0,
      timeoutMs: 20000,
    });
    if (r.text && r.text.trim().length > 10)
      return { summary: r.text.trim(), provider: "gemini" };
  } catch (err) {
    logger.warn({ err: err.message }, "service_jobs.ai: gemini summary failed, falling back");
  }

  try {
    const vendor = (await llm.resolveVendor("deepseek")) || (await llm.resolveVendor());
    if (vendor) {
      const r = await llm.chat({
        vendor,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 300,
      });
      if (r.content && r.content.trim().length > 10)
        return { summary: r.content.trim(), provider: vendor.vendor || "deepseek" };
    }
  } catch (err) {
    logger.warn({ err: err.message }, "service_jobs.ai: llm summary failed, using template");
  }

  return { summary: templateSummary(job), provider: "template" };
}

module.exports = { summarizeJob, templateSummary };
