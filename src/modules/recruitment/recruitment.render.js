/**
 * Recruitment rendering helpers.
 *
 * ONE safe markdown→HTML renderer is the single source of truth for both the
 * generated PDFs (offer packet + contract) and the candidate-facing offer page,
 * so what the candidate reads on the web matches the signed PDF. The JD and
 * Offer Letter are authored as markdown in the Offer Studio; this module turns
 * that markdown into escaped, whitelisted HTML (no raw tags survive), then wraps
 * it in the shared print shell for PDFs.
 */

"use strict";

const templates = require("../../services/pdf.templates");

const esc = (s) =>
  String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Inline formatting on ALREADY-escaped text: **bold**, *italic*, `code`. */
function inline(escaped) {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * Minimal, safe markdown → HTML. Everything is HTML-escaped first, then a small
 * whitelist of block/inline forms is applied. Supports: #/##/### headings,
 * - / * bullet lists, 1. ordered lists, --- rules, | pipe tables |, and
 * blank-line-separated paragraphs.
 */
function markdownToHtml(md) {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  const flushPara = (buf) => {
    if (buf.length) out.push(`<p>${inline(esc(buf.join(" ")))}</p>`);
    buf.length = 0;
  };

  const paraBuf = [];
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Blank line → paragraph break
    if (!line.trim()) {
      flushPara(paraBuf);
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      flushPara(paraBuf);
      out.push("<hr />");
      i += 1;
      continue;
    }

    // Headings
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(paraBuf);
      const level = h[1].length;
      out.push(`<h${level}>${inline(esc(h[2].trim()))}</h${level}>`);
      i += 1;
      continue;
    }

    // Pipe table (header row + separator + body)
    if (/^\|(.+)\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test((lines[i + 1] || "").trim())) {
      flushPara(paraBuf);
      const cells = (r) =>
        r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const header = cells(line);
      i += 2; // skip header + separator
      const body = [];
      while (i < lines.length && /^\|(.+)\|\s*$/.test(lines[i].trim())) {
        body.push(cells(lines[i].trim()));
        i += 1;
      }
      const thead = `<tr>${header.map((c) => `<th>${inline(esc(c))}</th>`).join("")}</tr>`;
      const tbody = body
        .map((r) => `<tr>${r.map((c) => `<td>${inline(esc(c))}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara(paraBuf);
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(esc(lines[i].replace(/^\s*[-*]\s+/, "").trim()))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara(paraBuf);
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(esc(lines[i].replace(/^\s*\d+\.\s+/, "").trim()))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Plain text → accumulate into a paragraph
    paraBuf.push(line.trim());
    i += 1;
  }
  flushPara(paraBuf);
  return out.join("\n");
}

/** Safe HTML for the two documents, for the candidate web page. */
function renderForWeb(offer) {
  return {
    jd_html: markdownToHtml(offer.jd_markdown || ""),
    offer_letter_html: markdownToHtml(offer.offer_markdown || ""),
  };
}

/** Company countersignature block — the offer is executed on the Company's behalf. */
function countersignBlock(company) {
  const name = esc(company.signatory_name || "For the Company");
  const title = esc(company.signatory_title || "");
  const today = new Date().toISOString().slice(0, 10);
  return `
    <div class="sig-company">
      <p class="muted">Executed on behalf of ${esc(company.display_name || "the Company")}:</p>
      <p><strong>${name}</strong>${title ? `<br/>${title}` : ""}<br/>
         <span class="muted">Signed electronically · ${esc(today)}</span></p>
    </div>`;
}

/**
 * Full offer packet PDF (JD + Offer Letter). The candidate signature area is a
 * placeholder in the PDF — the actual e-signature is captured on the offer page
 * and stamped by the e-sign engine's signature certificate on completion.
 */
function offerPacketHtml({ offer, company }) {
  const { jd_html, offer_letter_html } = renderForWeb(offer);
  const body = `
    <h1>Offer Packet — ${esc(offer.title || "Role")}</h1>
    <div class="meta">${esc(company.display_name || offer.business)} · Prepared for ${esc(
      offer.candidate_name || "the Candidate",
    )} · ${esc(new Date().toISOString().slice(0, 10))}</div>

    <h2>Part A — Job Description</h2>
    <div class="doc-body">${jd_html}</div>

    <div style="page-break-before: always;"></div>
    <h2>Part B — Offer Letter</h2>
    <div class="doc-body">${offer_letter_html}</div>

    ${countersignBlock(company)}

    <h2>Candidate acceptance</h2>
    <p>By signing electronically on the offer page, the Candidate accepts this offer on the
       terms set out above. A signature certificate with a tamper-evident verification code is
       appended on completion.</p>
    <table>
      <tr><td>Candidate: ____________________</td><td>Date: __________</td></tr>
    </table>`;
  return templates.shell(`Offer — ${offer.title || "Role"}`, body);
}

/** Employment contract PDF, generated on full signature. */
function contractHtml({ offer, company }) {
  const m = offer.offer_meta || {};
  const brandName = company.display_name || offer.business;
  const targets = (offer.target_businesses || []).join(", ");
  const body = `
    <h1>Employment Contract</h1>
    <div class="meta">${esc(brandName)} · ${esc(offer.title || "")}${
      targets ? ` · brands: ${esc(targets)}` : ""
    }</div>
    <p>This agreement is made between <strong>${esc(brandName)}</strong> ("the Company")
       and <strong>${esc(offer.candidate_name || "the Employee")}</strong> ("the Employee").</p>

    <h2>1. Position</h2>
    <p>The Employee is engaged as <strong>${esc(offer.title || "-")}</strong>${
      m.reporting_to ? `, reporting to ${esc(m.reporting_to)}` : ""
    }${m.location ? `, based in ${esc(m.location)}` : ""}. Employment type:
       ${esc(String(m.employment_type || "full_time").replace(/_/g, " "))}${
      m.start_date ? `, commencing ${esc(m.start_date)}` : ""
    }.</p>

    <h2>2. Remuneration</h2>
    <p>${
      m.salary_probation
        ? `During the probationary period the Employee's salary is <strong>${esc(m.salary_probation)}</strong>. `
        : ""
    }${
      m.salary_post_probation
        ? `On successful completion of probation the salary rises to <strong>${esc(m.salary_post_probation)}</strong>. `
        : ""
    }${
      m.variable_pay
        ? `In addition, ${esc(m.variable_pay)}. `
        : ""
    }All pay is subject to statutory deductions (PAYE, pension, NHF) per Nigerian law.</p>

    <h2>3. Probation</h2>
    <p>${
      m.probation_months
        ? `The first ${esc(String(m.probation_months))} month(s) are probationary`
        : "The role is subject to a probationary period"
    }${m.review_days ? `, with a formal review at day ${esc(String(m.review_days))}` : ""}.
       This is a results-focused role; clear, measurable performance is expected.</p>

    <h2>4. Duties</h2>
    <p>The Employee's duties are as set out in the Job Description accompanying the offer, as
       amended from time to time by the Company.</p>

    <h2>5. Confidentiality &amp; brand protection</h2>
    <p>The Employee will hold Company information, customer data and both brands' plans in
       confidence, and assign all work product and intellectual property to the Company.</p>

    ${m.additional_terms ? `<h2>6. Additional terms</h2><p>${esc(m.additional_terms)}</p>` : ""}

    <h2>Signatures</h2>
    <p class="muted">This contract is generated from the offer the Employee signed electronically on
       ${esc((offer.signed_at || "").toString().slice(0, 10))}. The Employee's e-signature and its
       verification code are recorded on the signed offer packet.</p>
    ${countersignBlock(company)}
    <table>
      <tr><td>Employee: ____________________</td><td>Date: __________</td></tr>
    </table>`;
  return templates.shell("Employment Contract", body);
}

module.exports = {
  markdownToHtml,
  renderForWeb,
  offerPacketHtml,
  contractHtml,
};
