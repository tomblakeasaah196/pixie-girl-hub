/**
 * Performance appraisal review → PDF (V2.2 §6.11, F-8).
 *
 * Renders a finalised (or in-progress) review — the weighted KPI scores, the
 * overall rating, the written sections, and the employee acknowledgement — to a
 * PDF via the headless-Chromium pipeline, stores it, and links it on
 * performance_reviews.document_id. Pure HTML generation is split out so it's
 * unit-testable without a browser.
 */

"use strict";

const repo = require("./appraisal.repo");
const pdf = require("../../services/pdf.service");
const { query } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const { NotFoundError } = require("../../utils/errors");
const { formatDate } = require("../../utils/dates");

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const brandLabel = (b) =>
  b === "faitlynhair"
    ? "Faitlyn Hair"
    : b === "pixiegirl"
      ? "Pixie Girl Global"
      : "Pixie Girl Hub";

const band = (b) => String(b || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const para = (label, text) =>
  text
    ? `<div class="sec"><div class="sec-h">${esc(label)}</div><div class="sec-b">${esc(text)}</div></div>`
    : "";

/** @returns {string} full HTML document for the review PDF. */
function reviewPdfHtml({ brand, review, cycle, scores, staffName }) {
  const rows = (scores || [])
    .map(
      (s) => `<tr>
        <td>${esc(s.kpi_name)}</td>
        <td class="n">${Number(s.weight_pct_snapshot)}%</td>
        <td class="n">${Number(s.raw_score).toFixed(1)}</td>
        <td class="n">${Number(s.weighted_score).toFixed(2)}</td>
        <td class="src">${esc((s.score_source || "manual").replace(/_/g, " "))}${s.is_calibrated ? " · calibrated" : ""}</td>
      </tr>`,
    )
    .join("");

  const ack = review.acknowledged_by_employee
    ? `<div class="ack ack-ok">Acknowledged by ${esc(staffName)}${
        review.acknowledged_at ? ` on ${formatDate(review.acknowledged_at)}` : ""
      }${review.employee_response ? `<div class="ack-note">“${esc(review.employee_response)}”</div>` : ""}</div>`
    : `<div class="ack ack-pending">Awaiting employee acknowledgement.</div>`;

  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color:#1A1816; padding:4mm 2mm; font-size:12px; }
  .head { border-bottom:2px solid #690909; padding-bottom:10px; margin-bottom:16px; }
  .co { font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:#690909; }
  .h1 { font-size:20px; font-weight:700; margin-top:2px; }
  .meta { font-family:Arial, sans-serif; font-size:11px; color:#555; margin-top:6px; line-height:1.7; }
  .overall { display:flex; align-items:baseline; gap:10px; margin:14px 0; }
  .overall .score { font-size:30px; font-weight:700; color:#690909; }
  .overall .band { font-family:Arial, sans-serif; font-size:13px; font-weight:600; color:#1A1816; }
  table { width:100%; border-collapse:collapse; margin:8px 0 16px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid #E8E4E0; font-size:11px; }
  th { font-family:Arial, sans-serif; font-size:9px; letter-spacing:.08em; text-transform:uppercase; color:#9a9490; }
  td.n { text-align:right; font-variant-numeric:tabular-nums; }
  td.src { font-family:Arial, sans-serif; font-size:10px; color:#777; }
  tfoot td { font-weight:700; border-top:2px solid #690909; border-bottom:none; }
  .sec { margin:10px 0; }
  .sec-h { font-family:Arial, sans-serif; font-size:9px; letter-spacing:.08em; text-transform:uppercase; color:#9a9490; margin-bottom:3px; }
  .sec-b { font-size:12px; line-height:1.6; color:#333; white-space:pre-wrap; }
  .ack { margin-top:16px; padding:10px 12px; border-radius:6px; font-family:Arial, sans-serif; font-size:11px; }
  .ack-ok { background:#EEF5EC; color:#1B6B35; }
  .ack-pending { background:#F9F7F5; color:#9a7a1a; }
  .ack-note { margin-top:4px; color:#333; font-style:italic; }
  .foot { margin-top:20px; padding-top:10px; border-top:1px solid #E8E4E0; font-family:Arial, sans-serif; font-size:8px; color:#9a9490; }
</style></head>
<body>
  <div class="head">
    <div class="co">${esc(brandLabel(brand))}</div>
    <div class="h1">Performance Appraisal</div>
    <div class="meta">
      Employee: <b>${esc(staffName)}</b><br />
      Cycle: ${esc(cycle && cycle.cycle_name)}${cycle ? ` · ${esc(cycle.starts_on)} – ${esc(cycle.ends_on)}` : ""}<br />
      Status: ${esc(band(review.status))}
    </div>
  </div>

  <div class="overall">
    <span class="score">${Number(review.overall_weighted_score).toFixed(2)}</span>
    <span class="band">${esc(band(review.overall_rating_band))}</span>
  </div>

  <table>
    <thead><tr><th>KPI</th><th style="text-align:right">Weight</th><th style="text-align:right">Score</th><th style="text-align:right">Weighted</th><th>Source</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" style="color:#9a9490">No scores recorded.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="3">Overall weighted score</td><td class="n">${Number(review.overall_weighted_score).toFixed(2)}</td><td></td></tr></tfoot>
  </table>

  ${para("Strengths", review.strengths)}
  ${para("Areas for improvement", review.improvement_areas)}
  ${para("Development goals", review.development_goals)}
  ${para("Manager comments", review.manager_comments)}

  ${ack}

  <div class="foot">Generated ${formatDate(new Date())} · Pixie Girl Hub HR</div>
</body></html>`;
}

/** Render + store the review PDF and link it on the review. */
async function exportReviewPdf({ brand, user, request_id, id }) {
  const review = await repo.getReview({ brand, id });
  if (!review) throw new NotFoundError("Performance review");
  const cycle = await repo.getCycle({ brand, id: review.cycle_id });
  const scores = await repo.listScores({
    brand,
    cycle_id: review.cycle_id,
    user_id: review.user_id,
  });
  const { rows } = await query(
    `SELECT display_name FROM shared.users WHERE user_id = $1`,
    [review.user_id],
  );
  const staffName = (rows[0] && rows[0].display_name) || "Employee";

  const html = reviewPdfHtml({ brand, review, cycle, scores, staffName });
  const stored = await pdf.renderAndStore({
    brand,
    user_id: user ? user.user_id : null,
    html,
    title: `Appraisal — ${staffName}${cycle ? ` — ${cycle.cycle_name}` : ""}`,
    document_type: "performance_review",
    reference_type: "performance_review",
    reference_id: id,
  });
  await repo.setReviewFields({
    brand,
    id,
    fields: { document_id: stored.document_id },
  });
  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    request_id,
    action_key: "hr_payroll.appraisal.review_pdf",
    target_type: "performance_review",
    target_id: id,
  });
  return { document_id: stored.document_id, title: stored.title };
}

module.exports = { exportReviewPdf, reviewPdfHtml };
