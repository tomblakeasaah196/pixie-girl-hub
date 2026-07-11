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
 *
 * Self-contained HTML (bypasses the generic _shell) so the offer carries the
 * issuing brand's logo, accent colour, and premium styling.
 */
function offerPacketHtml({ offer, company }) {
  const { jd_html, offer_letter_html } = renderForWeb(offer);
  const accent = esc(company.accent_colour || "#690909");
  const secondary = esc(company.secondary_colour || accent);
  const brandName = esc(company.display_name || offer.business || "");
  const legalName = esc(company.legal_name || brandName);
  const candidateName = esc(offer.candidate_name || "the Candidate");
  const roleTitle = esc(offer.title || "Role");
  const today = new Date().toISOString().slice(0, 10);
  const logo = company.logo_base64 || "";

  const logoBlock = logo
    ? `<img src="${logo}" alt="${brandName}" class="brand-logo" />`
    : `<div class="brand-logo-text">${brandName}</div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Offer — ${roleTitle}</title>
<style>
  @page {
    size: A4;
    margin: 0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: #1a1a1a;
    font-size: 11.5px;
    line-height: 1.65;
    background: #fff;
  }

  /* ── Brand header ─────────────────────────────────── */
  .brand-header {
    padding: 32px 48px 24px;
    text-align: center;
    border-bottom: 3px solid ${accent};
    position: relative;
  }
  .brand-header::after {
    content: '';
    position: absolute;
    bottom: -6px;
    left: 48px;
    right: 48px;
    height: 1px;
    background: ${secondary};
  }
  .brand-logo {
    max-height: 56px;
    max-width: 200px;
    margin-bottom: 12px;
    display: block;
    margin-left: auto;
    margin-right: auto;
  }
  .brand-logo-text {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: ${accent};
    margin-bottom: 12px;
  }
  .brand-tagline {
    font-size: 9px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #888;
    margin-top: 4px;
  }

  /* ── Cover block ──────────────────────────────────── */
  .cover-block {
    padding: 40px 48px 32px;
    text-align: center;
  }
  .cover-title {
    font-size: 24px;
    font-weight: 700;
    color: ${accent};
    margin-bottom: 6px;
    letter-spacing: 0.5px;
  }
  .cover-role {
    font-size: 15px;
    font-weight: 400;
    color: #333;
    margin-bottom: 16px;
    font-style: italic;
  }
  .cover-meta {
    font-size: 10px;
    color: #777;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .cover-divider {
    width: 60px;
    height: 2px;
    background: ${accent};
    margin: 20px auto 0;
  }

  /* ── Content area ─────────────────────────────────── */
  .content {
    padding: 0 48px;
  }

  /* ── Section header ───────────────────────────────── */
  .section-banner {
    background: ${accent};
    color: #fff;
    padding: 14px 48px;
    margin: 0 -48px 24px;
    position: relative;
  }
  .section-banner h2 {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin: 0;
    border: none;
    padding: 0;
    color: #fff;
  }
  .section-banner .section-sub {
    font-size: 9px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    opacity: 0.8;
    margin-top: 2px;
  }
  .section-banner::after {
    content: '';
    position: absolute;
    bottom: -4px;
    left: 48px;
    right: 48px;
    height: 2px;
    background: ${secondary};
  }

  /* ── Document body (rendered markdown) ────────────── */
  .doc-body { margin-bottom: 24px; }
  .doc-body h1 {
    font-size: 18px;
    color: ${accent};
    margin: 20px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid #e0e0e0;
  }
  .doc-body h2 {
    font-size: 14px;
    color: ${accent};
    margin: 18px 0 6px;
    padding-bottom: 3px;
    border-bottom: 1px solid #eee;
  }
  .doc-body h3 {
    font-size: 12.5px;
    color: #333;
    margin: 14px 0 4px;
    font-style: italic;
  }
  .doc-body h4 {
    font-size: 11.5px;
    color: #555;
    margin: 12px 0 4px;
  }
  .doc-body p {
    margin: 6px 0;
    text-align: justify;
  }
  .doc-body ul, .doc-body ol {
    margin: 6px 0 6px 20px;
    padding: 0;
  }
  .doc-body li {
    margin-bottom: 3px;
  }
  .doc-body li::marker {
    color: ${accent};
  }
  .doc-body strong { color: #111; }
  .doc-body hr {
    border: none;
    height: 1px;
    background: linear-gradient(to right, transparent, ${accent}44, transparent);
    margin: 16px 0;
  }
  .doc-body table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0;
    font-size: 10.5px;
  }
  .doc-body th {
    background: ${accent}11;
    color: ${accent};
    font-weight: 600;
    text-align: left;
    padding: 6px 10px;
    border-bottom: 2px solid ${accent}33;
    font-size: 10px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .doc-body td {
    padding: 5px 10px;
    border-bottom: 1px solid #f0f0f0;
  }
  .doc-body code {
    font-family: 'Courier New', monospace;
    background: #f5f5f5;
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 10px;
  }

  /* ── Signature blocks ─────────────────────────────── */
  .signatures {
    margin-top: 32px;
    padding-top: 20px;
    border-top: 2px solid ${accent};
  }
  .sig-section-title {
    font-size: 13px;
    font-weight: 700;
    color: ${accent};
    letter-spacing: 1px;
    text-transform: uppercase;
    margin-bottom: 20px;
  }
  .sig-grid {
    display: flex;
    gap: 40px;
    margin-bottom: 20px;
  }
  .sig-block {
    flex: 1;
  }
  .sig-label {
    font-size: 9px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #999;
    margin-bottom: 4px;
  }
  .sig-line {
    border-bottom: 1px solid #ccc;
    height: 32px;
    margin-bottom: 4px;
  }
  .sig-name {
    font-weight: 700;
    color: #333;
  }
  .sig-title-text {
    font-size: 10px;
    color: #777;
    font-style: italic;
  }
  .sig-date {
    font-size: 9px;
    color: #999;
    margin-top: 2px;
  }

  /* ── Footer ───────────────────────────────────────── */
  .doc-footer {
    margin-top: 32px;
    padding: 16px 0;
    border-top: 1px solid #e0e0e0;
    text-align: center;
  }
  .doc-footer p {
    font-size: 8px;
    color: #999;
    letter-spacing: 0.5px;
    line-height: 1.5;
  }

  /* ── Page break ───────────────────────────────────── */
  .page-break { page-break-before: always; }

  /* ── Acceptance notice ────────────────────────────── */
  .acceptance-notice {
    background: ${accent}08;
    border: 1px solid ${accent}22;
    border-radius: 4px;
    padding: 14px 18px;
    margin: 20px 0;
    font-size: 10px;
    color: #555;
    line-height: 1.6;
  }
  .acceptance-notice strong {
    color: ${accent};
  }
</style>
</head>
<body>

  <!-- ═══ BRAND HEADER ═══ -->
  <div class="brand-header">
    ${logoBlock}
    <div class="brand-tagline">${legalName}</div>
  </div>

  <!-- ═══ COVER BLOCK ═══ -->
  <div class="cover-block">
    <div class="cover-title">Offer Packet</div>
    <div class="cover-role">${roleTitle}</div>
    <div class="cover-meta">Prepared for ${candidateName} &middot; ${esc(today)}</div>
    <div class="cover-divider"></div>
  </div>

  <div class="content">

    <!-- ═══ PART A — JOB DESCRIPTION ═══ -->
    <div class="section-banner">
      <h2>Part A</h2>
      <div class="section-sub">Job Description</div>
    </div>
    <div class="doc-body">${jd_html}</div>

    <!-- ═══ PAGE BREAK ═══ -->
    <div class="page-break"></div>

    <!-- ═══ PART B HEADER (re-stamp the brand on the new page) ═══ -->
    <div class="brand-header" style="margin: 0 -48px; padding-top: 24px; padding-bottom: 18px;">
      ${logoBlock}
    </div>

    <div style="height: 16px;"></div>
    <div class="section-banner">
      <h2>Part B</h2>
      <div class="section-sub">Offer of Employment</div>
    </div>
    <div class="doc-body">${offer_letter_html}</div>

    <!-- ═══ SIGNATURES ═══ -->
    <div class="signatures">
      <div class="sig-section-title">Execution</div>

      <div class="sig-grid">
        <div class="sig-block">
          <div class="sig-label">For ${brandName}</div>
          <div class="sig-line"></div>
          <div class="sig-name">${esc(company.signatory_name || "For the Company")}</div>
          <div class="sig-title-text">${esc(company.signatory_title || "")}</div>
          <div class="sig-date">Signed electronically &middot; ${esc(today)}</div>
        </div>
        <div class="sig-block">
          <div class="sig-label">Candidate</div>
          <div class="sig-line"></div>
          <div class="sig-name">${candidateName}</div>
          <div class="sig-title-text">&nbsp;</div>
          <div class="sig-date">Date: _______________</div>
        </div>
      </div>
    </div>

    <!-- ═══ ACCEPTANCE NOTICE ═══ -->
    <div class="acceptance-notice">
      <strong>Electronic Signature Notice:</strong> By signing electronically on the offer page,
      the Candidate accepts this offer on the terms set out above. A <strong>signature certificate</strong>
      with a tamper-evident verification code is appended on completion.
    </div>

    <!-- ═══ FOOTER ═══ -->
    <div class="doc-footer">
      <p>${brandName} &middot; ${legalName}<br/>
      This document is confidential and intended solely for the named recipient.</p>
    </div>

  </div>
</body>
</html>`;
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
