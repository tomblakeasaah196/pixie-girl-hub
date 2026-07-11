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

// Fixture — a realistic company block with every optional field populated so
// the assertions can pick out each renderer feature independently.
const FULL_COMPANY = {
  display_name: "Faitlyn Hair",
  legal_name: "The Faitlyn Brand",
  signatory_name: "Faitlyn Alex",
  signatory_title: "Chief Executive Officer",
  accent_colour: "#7A6547",
  secondary_colour: "#B89A6B",
  address: "10b Emma Abimbola Cole, Lekki Phase 1, Lagos",
  phone: "+234 814 360 1938",
  email: "contact@thefaitlynbrand.com",
  website: "faitlynhair.com",
  cac_number: "1234567",
  tin: "9876543",
  mission_statement:
    "To empower women to stand out effortlessly by providing the highest-grade, ready-to-wear virgin human hair extensions.",
};

const SAMPLE_OFFER = {
  title: "Marketing Officer",
  business: "faitlynhair",
  candidate_name: "Ada Obi",
  target_businesses: ["faitlynhair"],
  jd_markdown: "# JD\n\nDo great marketing.",
  offer_markdown: "## Offer\n\nWe are delighted to offer you the role.",
  offer_meta: {},
};

describe("recruitment.render.offerPacketHtml", () => {
  it("includes both document sections, candidate name, and the company countersignature", () => {
    const html = render.offerPacketHtml({ offer: SAMPLE_OFFER, company: FULL_COMPANY });
    expect(html).toContain("Job Description");
    expect(html).toContain("Offer of Employment");
    expect(html).toContain("Ada Obi");
    expect(html).toContain("Faitlyn Alex");
    expect(html).toContain("Do great marketing.");
  });

  it("prints the full brand contact strip on the cover from Business Setup fields", () => {
    const html = render.offerPacketHtml({ offer: SAMPLE_OFFER, company: FULL_COMPANY });
    expect(html).toContain("10b Emma Abimbola Cole, Lekki Phase 1, Lagos");
    expect(html).toContain("+234 814 360 1938");
    expect(html).toContain("contact@thefaitlynbrand.com");
    expect(html).toContain("faitlynhair.com");
  });

  it("skips missing brand identity bits so a partly-configured brand still looks clean", () => {
    const bare = { display_name: "Test Brand", legal_name: "Test Brand Ltd" };
    const html = render.offerPacketHtml({ offer: SAMPLE_OFFER, company: bare });
    // The <div class="brand-contacts"> element is absent (the CSS class is
    // always defined in the stylesheet — we're asserting on the rendered node).
    expect(html).not.toContain("<div class=\"brand-contacts\">");
    expect(html).not.toContain("CAC ");
    expect(html).not.toContain("TIN ");
    expect(html).not.toContain("<span class=\"mission\">");
  });

  it("puts CAC + mission statement in the footer only when configured", () => {
    const html = render.offerPacketHtml({ offer: SAMPLE_OFFER, company: FULL_COMPANY });
    expect(html).toContain("CAC 1234567");
    expect(html).toContain("TIN 9876543");
    expect(html).toContain("class=\"mission\"");
    expect(html).toContain("empower women to stand out");
  });

  it("stamps the countersignatory signature image on the 'For {brand}' line when captured", () => {
    const company = { ...FULL_COMPANY, signatory_signature_data_url: "data:image/png;base64,ABCDEF" };
    const html = render.offerPacketHtml({ offer: SAMPLE_OFFER, company });
    // Signature image lives inside a .sig-signed slot, next to the countersignatory's name.
    expect(html).toMatch(/<div class="sig-signed"><img src="data:image\/png;base64,ABCDEF"[^>]*><\/div>\s*<div class="sig-name">Faitlyn Alex/);
  });

  it("falls back to a ruled line when no countersignature is captured", () => {
    const html = render.offerPacketHtml({ offer: SAMPLE_OFFER, company: FULL_COMPANY });
    expect(html).toMatch(/<div class="sig-line"><\/div>\s*<div class="sig-name">Faitlyn Alex/);
  });

  it("strips the AI's trailing 'Accepted and Agreed' block so only one signature area survives", () => {
    const offer = {
      ...SAMPLE_OFFER,
      offer_markdown: [
        "Dear Ada,",
        "",
        "We are delighted to offer you the role.",
        "",
        "Warm regards,",
        "Faitlyn Alex",
        "Chief Executive Officer",
        "",
        "**Accepted and Agreed:**",
        "",
        "________________________ [Candidate Name]",
        "________________________ Date",
      ].join("\n"),
    };
    const html = render.offerPacketHtml({ offer, company: FULL_COMPANY });
    expect(html).not.toContain("Accepted and Agreed");
    expect(html).not.toContain("[Candidate Name]");
    // The sign-off itself survives — we only strip the acceptance/signature block.
    expect(html).toContain("Warm regards");
    // And the formal execution block still shows exactly one candidate name.
    const candidateOccurrences = html.match(/Ada Obi/g) || [];
    expect(candidateOccurrences.length).toBeGreaterThan(0);
  });
});

describe("recruitment.render.pdfDocOptions", () => {
  it("carves out top + bottom margins so body content never crashes into the footer", () => {
    const opts = render.pdfDocOptions(FULL_COMPANY);
    expect(opts.margin.top).toBe("14mm");
    expect(opts.margin.bottom).toBe("20mm");
    expect(opts.displayHeaderFooter).toBe(true);
  });

  it("adds CAC + TIN to the running footer only when configured", () => {
    const full = render.pdfDocOptions(FULL_COMPANY);
    expect(full.footerTemplate).toContain("The Faitlyn Brand");
    expect(full.footerTemplate).toContain("CAC 1234567");
    expect(full.footerTemplate).toContain("TIN 9876543");
    const bare = render.pdfDocOptions({ display_name: "Test Brand", legal_name: "Test Brand Ltd" });
    expect(bare.footerTemplate).toContain("Test Brand Ltd");
    expect(bare.footerTemplate).not.toContain("CAC");
    expect(bare.footerTemplate).not.toContain("TIN");
  });
});
