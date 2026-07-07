"use strict";

/**
 * Appraisal review PDF — the HTML the browser turns into the stored PDF.
 * Pure render: asserts the scores table, overall rating, written sections,
 * acknowledgement state, and HTML-escaping.
 */

const {
  reviewPdfHtml,
} = require("../../../src/shared/hr_payroll/appraisal.review-pdf");

const base = {
  brand: "pixiegirl",
  cycle: { cycle_name: "Q3 2026", starts_on: "2026-07-01", ends_on: "2026-09-30" },
  review: {
    overall_weighted_score: 4.12,
    overall_rating_band: "exceeds",
    status: "finalised",
    strengths: "Consistently punctual",
    improvement_areas: "",
    development_goals: "Lead a training",
    manager_comments: "Strong quarter",
    acknowledged_by_employee: true,
    acknowledged_at: "2026-10-02T09:00:00Z",
    employee_response: "Thank you",
  },
  scores: [
    { kpi_name: "Punctuality", weight_pct_snapshot: 20, raw_score: 5, weighted_score: 1.0, score_source: "clock_in_data", is_calibrated: false },
    { kpi_name: "Quality", weight_pct_snapshot: 30, raw_score: 4.2, weighted_score: 1.26, score_source: "service_job_ratings", is_calibrated: true },
  ],
  staffName: "Amara Obi",
};

describe("reviewPdfHtml", () => {
  it("renders the employee, cycle, overall score and rating band", () => {
    const html = reviewPdfHtml(base);
    expect(html).toContain("Amara Obi");
    expect(html).toContain("Q3 2026");
    expect(html).toContain("4.12");
    expect(html).toContain("Exceeds");
  });

  it("renders a row per KPI with the source and calibration marker", () => {
    const html = reviewPdfHtml(base);
    expect(html).toContain("Punctuality");
    expect(html).toContain("Quality");
    expect(html).toContain("clock in data");
    expect(html).toContain("calibrated");
  });

  it("includes non-empty written sections and omits empty ones", () => {
    const html = reviewPdfHtml(base);
    expect(html).toContain("Strengths");
    expect(html).toContain("Consistently punctual");
    expect(html).toContain("Development goals");
    expect(html).not.toContain("Areas for improvement"); // empty → omitted
  });

  it("shows the acknowledgement when the employee has acknowledged", () => {
    const html = reviewPdfHtml(base);
    expect(html).toContain("Acknowledged by Amara Obi");
    expect(html).toContain("Thank you");
  });

  it("shows a pending state when not acknowledged", () => {
    const html = reviewPdfHtml({
      ...base,
      review: { ...base.review, acknowledged_by_employee: false },
    });
    expect(html).toContain("Awaiting employee acknowledgement");
  });

  it("escapes untrusted names (no injection)", () => {
    const html = reviewPdfHtml({ ...base, staffName: "<script>x</script>" });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
