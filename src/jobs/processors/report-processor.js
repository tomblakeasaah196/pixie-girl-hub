/**
 * BullMQ processor: report-generate (J-7).
 *
 * Renders a report to PDF (headless Chromium via pdf.service) and persists it
 * through the Documents gateway, linking it to the originating report_run when
 * provided. Enqueue with:
 *   enqueue("report-generate", "report.pdf", {
 *     brand, title, subtitle, sections,          // see pdf.templates.reportHtml
 *     reference_type?, reference_id?, user_id?
 *   })
 *
 * Degrades cleanly: if PDF rendering is unavailable (PDF_ENABLED=false or
 * Chromium not installed) the job throws PDF_UNAVAILABLE and BullMQ retries.
 */

"use strict";

const { logger } = require("../../config/logger");
const pdf = require("../../services/pdf.service");
const { reportHtml } = require("../../services/pdf.templates");

module.exports = async function process(job) {
  const {
    brand,
    title,
    subtitle,
    sections,
    generated_at,
    reference_type,
    reference_id,
    document_type,
    user_id,
  } = job.data || {};

  if (!brand || !title) {
    logger.warn(
      { jobId: job.id },
      "report-generate: missing brand/title — skipping",
    );
    return { skipped: true };
  }

  const html = reportHtml({
    title,
    subtitle,
    generated_at: generated_at || new Date().toISOString(),
    sections: sections || [],
  });

  const doc = await pdf.renderAndStore({
    brand,
    user_id: user_id || null,
    html,
    title,
    document_type: document_type || "report",
    reference_type: reference_type || null,
    reference_id: reference_id || null,
  });

  logger.info(
    { jobId: job.id, brand, document_id: doc.document_id },
    "report PDF generated",
  );
  return { document_id: doc.document_id };
};
