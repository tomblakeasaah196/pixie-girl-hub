"use strict";

const render = require("../../../src/modules/recruitment/recruitment.render");
const ai = require("../../../src/modules/recruitment/recruitment.ai");

describe("recruitment.render.markdownToHtml", () => {
  it("renders headings, bold and lists", () => {
    const html = render.markdownToHtml(
      "# Title\n\nSome **bold** text.\n\n- one\n- two",
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
  });

  it("escapes HTML so authored content can't inject markup (no raw tags)", () => {
    const html = render.markdownToHtml("Hello <script>alert(1)</script> & <b>x</b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("renders a pipe table", () => {
    const html = render.markdownToHtml("| A | B |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>1</td>");
  });
});

describe("recruitment.ai.templateDraft (deterministic fallback)", () => {
  it("produces a usable JD + offer from intake, echoing key fields", () => {
    const draft = ai.templateDraft({
      intake: {
        title: "Marketing & Business Development Officer",
        target_businesses: ["pixiegirl", "faitlynhair"],
        reporting_to: "the CEO",
        salary_probation: "₦220,000/month",
        salary_post_probation: "₦300,000/month",
      },
    });
    expect(draft.jd_markdown).toMatch(/Marketing & Business Development Officer/);
    expect(draft.offer_markdown).toMatch(/₦220,000\/month/);
    expect(draft.offer_markdown).toMatch(/₦300,000\/month/);
    expect(draft.offer_meta).toBeTruthy();
  });
});

describe("recruitment.render.offerPacketHtml", () => {
  it("includes both the JD and the offer letter, plus the company countersignature", () => {
    const offer = {
      title: "Marketing Officer",
      business: "pixiegirl",
      candidate_name: "Ada Obi",
      target_businesses: ["pixiegirl", "faitlynhair"],
      jd_markdown: "# JD\n\nDo great marketing.",
      offer_markdown: "## Offer\n\nWe are delighted to offer you the role.",
      offer_meta: {},
    };
    const company = {
      display_name: "Pixie Girl Global",
      signatory_name: "Faith",
      signatory_title: "Chief Executive Officer",
    };
    const html = render.offerPacketHtml({ offer, company });
    expect(html).toContain("Job Description");
    expect(html).toContain("Offer Letter");
    expect(html).toContain("Ada Obi");
    expect(html).toContain("Faith");
    expect(html).toContain("Do great marketing.");
  });
});
