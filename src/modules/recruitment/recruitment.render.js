/**
 * Recruitment rendering helpers.
 *
 * ONE safe markdown→HTML renderer is the single source of truth for both the
 * generated PDFs (offer packet + contract) and the candidate-facing offer page,
 * so what the candidate reads on the web matches the signed PDF. The JD and
 * Offer Letter are authored as markdown in the Offer Studio; this module turns
 * that markdown into escaped, whitelisted HTML (no raw tags survive), then wraps
 * it in a self-contained, brand-styled print shell rendered by headless Chromium
 * (Puppeteer) — never a screen capture.
 *
 * Three formal documents can be produced from one offer:
 *   • the Job Description        (jobDescriptionHtml)
 *   • the Offer Letter           (offerLetterHtml, carries the execution block)
 *   • the full Offer Packet      (offerPacketHtml = JD + Offer Letter + signatures)
 * When the candidate has signed, the actual e-signature image (a base64 data
 * URL captured on the offer page) is stamped into the execution block, so the
 * signature rides in the PDF itself — not a "signed" placeholder.
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

/** Human date (e.g. "11 July 2026") from an ISO string / Date; today if empty. */
function humanDate(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return String(value || "");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ── Brand-styled print shell (shared by all three documents) ─────────
/** The full <style> block, tinted to the issuing brand's palette. */
function docStyles({ accent, secondary }) {
  return `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: #1a1a1a;
    font-size: 11.5px;
    line-height: 1.65;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Brand header ─────────────────────────────────── */
  .brand-header {
    padding: 30px 48px 22px;
    text-align: center;
    border-bottom: 3px solid ${accent};
    position: relative;
  }
  .brand-header::after {
    content: '';
    position: absolute;
    bottom: -6px; left: 48px; right: 48px;
    height: 1px; background: ${secondary};
  }
  .brand-logo {
    max-height: 56px; max-width: 210px;
    margin: 0 auto 12px; display: block;
  }
  .brand-logo-text {
    font-size: 22px; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; color: ${accent}; margin-bottom: 10px;
  }
  .brand-tagline {
    font-size: 9px; letter-spacing: 3px; text-transform: uppercase;
    color: #888; margin-top: 4px;
  }

  /* ── Cover block ──────────────────────────────────── */
  .cover-block { padding: 40px 48px 30px; text-align: center; }
  .cover-kicker {
    font-size: 9.5px; letter-spacing: 4px; text-transform: uppercase;
    color: ${secondary}; margin-bottom: 10px;
  }
  .cover-title {
    font-size: 25px; font-weight: 700; color: ${accent};
    margin-bottom: 6px; letter-spacing: 0.5px;
  }
  .cover-role {
    font-size: 15px; color: #333; margin-bottom: 14px; font-style: italic;
  }
  .cover-meta {
    font-size: 10px; color: #777; letter-spacing: 1px; text-transform: uppercase;
  }
  .cover-divider { width: 60px; height: 2px; background: ${accent}; margin: 18px auto 0; }
  .cover-signed {
    display: inline-block; margin-top: 18px; padding: 7px 16px;
    border: 1px solid ${accent}44; border-radius: 999px;
    background: ${accent}0d; color: ${accent};
    font-size: 9.5px; letter-spacing: 1.5px; text-transform: uppercase;
  }
  .cover-signed .vc { font-family: 'Courier New', monospace; letter-spacing: 1px; }

  /* ── Content area ─────────────────────────────────── */
  .content { padding: 0 48px; }

  /* ── Section banner ───────────────────────────────── */
  .section-banner {
    background: ${accent}; color: #fff; padding: 13px 48px;
    margin: 0 -48px 22px; position: relative;
  }
  .section-banner h2 {
    font-size: 14px; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; margin: 0; border: none; padding: 0; color: #fff;
  }
  .section-banner .section-sub {
    font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase;
    opacity: 0.85; margin-top: 2px;
  }
  .section-banner::after {
    content: ''; position: absolute; bottom: -4px; left: 48px; right: 48px;
    height: 2px; background: ${secondary};
  }

  /* ── Document body (rendered markdown) ────────────── */
  .doc-body { margin-bottom: 22px; }
  .doc-body h1 {
    font-size: 18px; color: ${accent}; margin: 20px 0 8px;
    padding-bottom: 4px; border-bottom: 1px solid #e0e0e0;
  }
  .doc-body h2 {
    font-size: 14px; color: ${accent}; margin: 18px 0 6px;
    padding-bottom: 3px; border-bottom: 1px solid #eee;
  }
  .doc-body h3 { font-size: 12.5px; color: #333; margin: 14px 0 4px; font-style: italic; }
  .doc-body h4 { font-size: 11.5px; color: #555; margin: 12px 0 4px; }
  .doc-body p { margin: 6px 0; text-align: justify; }
  .doc-body ul, .doc-body ol { margin: 6px 0 6px 20px; padding: 0; }
  .doc-body li { margin-bottom: 3px; }
  .doc-body li::marker { color: ${accent}; }
  .doc-body strong { color: #111; }
  .doc-body hr {
    border: none; height: 1px;
    background: linear-gradient(to right, transparent, ${accent}44, transparent);
    margin: 16px 0;
  }
  .doc-body table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 10.5px; }
  .doc-body th {
    background: ${accent}11; color: ${accent}; font-weight: 600; text-align: left;
    padding: 6px 10px; border-bottom: 2px solid ${accent}33;
    font-size: 10px; letter-spacing: 0.5px; text-transform: uppercase;
  }
  .doc-body td { padding: 5px 10px; border-bottom: 1px solid #f0f0f0; }
  .doc-body code {
    font-family: 'Courier New', monospace; background: #f5f5f5;
    padding: 1px 4px; border-radius: 2px; font-size: 10px;
  }

  /* ── Signature / execution block ──────────────────── */
  .signatures {
    margin-top: 30px; padding-top: 20px; border-top: 2px solid ${accent};
    page-break-inside: avoid;
  }
  .sig-section-title {
    font-size: 13px; font-weight: 700; color: ${accent};
    letter-spacing: 1px; text-transform: uppercase; margin-bottom: 18px;
  }
  .sig-grid { display: flex; gap: 40px; margin-bottom: 16px; }
  .sig-block { flex: 1; }
  .sig-label {
    font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase;
    color: #999; margin-bottom: 6px;
  }
  /* Empty (to-be-signed) line */
  .sig-line { border-bottom: 1px solid #bbb; height: 40px; margin-bottom: 6px; }
  /* Stamped signature image sits ON the ruled line */
  .sig-signed {
    height: 52px; border-bottom: 1px solid ${accent};
    display: flex; align-items: flex-end; margin-bottom: 6px;
    overflow: hidden;
  }
  .sig-image { max-height: 50px; max-width: 220px; display: block; }
  .sig-name { font-weight: 700; color: #222; }
  .sig-title-text { font-size: 10px; color: #777; font-style: italic; }
  .sig-date { font-size: 9px; color: #999; margin-top: 3px; }
  .sig-verify {
    font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 1px;
    color: ${accent}; margin-top: 4px;
  }

  /* ── Acceptance notice ────────────────────────────── */
  .acceptance-notice {
    background: ${accent}08; border: 1px solid ${accent}22; border-radius: 4px;
    padding: 13px 18px; margin: 18px 0; font-size: 10px; color: #555; line-height: 1.6;
  }
  .acceptance-notice strong { color: ${accent}; }

  /* ── Footer + page break ──────────────────────────── */
  .doc-footer {
    margin-top: 28px; padding: 16px 0; border-top: 1px solid #e0e0e0; text-align: center;
  }
  .doc-footer p { font-size: 8px; color: #999; letter-spacing: 0.5px; line-height: 1.5; }
  .page-break { page-break-before: always; }
  `;
}

/** The brand mark used in the header — logo image if we have one, else wordmark. */
function logoBlock(company) {
  const brandName = esc(company.display_name || "");
  return company.logo_base64
    ? `<img src="${company.logo_base64}" alt="${brandName}" class="brand-logo" />`
    : `<div class="brand-logo-text">${brandName}</div>`;
}

/**
 * The execution block. When a signature is supplied (offer accepted), the
 * candidate's actual e-signature image is stamped onto the ruled line, with the
 * signing date and tamper-evident verification code beneath it. Otherwise a
 * blank ruled line is shown for wet/countersignature.
 */
function executionBlock({ company, candidateName, signature }) {
  const today = humanDate();
  const signed = signature && (signature.data_url || signature.captured_signature_path);
  const candidateSide = signed && signature.data_url
    ? `
        <div class="sig-signed"><img src="${signature.data_url}" alt="Candidate signature" class="sig-image" /></div>
        <div class="sig-name">${esc(candidateName)}</div>
        <div class="sig-title-text">Accepted &amp; signed electronically</div>
        <div class="sig-date">Signed ${esc(humanDate(signature.signed_at))}</div>
        ${signature.verification_code ? `<div class="sig-verify">Verification ${esc(signature.verification_code)}</div>` : ""}`
    : `
        <div class="sig-line"></div>
        <div class="sig-name">${esc(candidateName)}</div>
        <div class="sig-title-text">&nbsp;</div>
        <div class="sig-date">Date: _______________</div>`;

  return `
    <div class="signatures">
      <div class="sig-section-title">Execution</div>
      <div class="sig-grid">
        <div class="sig-block">
          <div class="sig-label">For ${esc(company.display_name || "the Company")}</div>
          <div class="sig-line"></div>
          <div class="sig-name">${esc(company.signatory_name || "For the Company")}</div>
          <div class="sig-title-text">${esc(company.signatory_title || "")}</div>
          <div class="sig-date">Signed electronically &middot; ${esc(today)}</div>
        </div>
        <div class="sig-block">
          <div class="sig-label">Candidate</div>
          ${candidateSide}
        </div>
      </div>
    </div>

    <div class="acceptance-notice">
      <strong>Electronic Signature Notice:</strong> ${
        signed
          ? "This offer was accepted and signed electronically by the candidate. The signature above is captured on file with a tamper-evident verification code."
          : "By signing electronically on the offer page, the Candidate accepts this offer on the terms set out above. A <strong>signature certificate</strong> with a tamper-evident verification code is appended on completion."
      }
    </div>`;
}

/**
 * Wrap document body content in the full brand shell: brand header, cover block,
 * then the supplied content. Self-contained HTML (inline CSS, embedded logo),
 * so the PDF needs no network at render time.
 */
function docShell({ company, headTitle, coverKicker, coverTitle, coverRole, coverMeta, signedBadgeHtml, bodyHtml }) {
  const accent = esc(company.accent_colour || "#690909");
  const secondary = esc(company.secondary_colour || accent);
  const legalName = esc(company.legal_name || company.display_name || "");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(headTitle)}</title>
<style>${docStyles({ accent, secondary })}</style>
</head>
<body>
  <div class="brand-header">
    ${logoBlock(company)}
    <div class="brand-tagline">${legalName}</div>
  </div>

  <div class="cover-block">
    ${coverKicker ? `<div class="cover-kicker">${esc(coverKicker)}</div>` : ""}
    <div class="cover-title">${esc(coverTitle)}</div>
    ${coverRole ? `<div class="cover-role">${esc(coverRole)}</div>` : ""}
    ${coverMeta ? `<div class="cover-meta">${coverMeta}</div>` : ""}
    <div class="cover-divider"></div>
    ${signedBadgeHtml || ""}
  </div>

  <div class="content">
    ${bodyHtml}

    <div class="doc-footer">
      <p>${esc(company.display_name || "")} &middot; ${legalName}<br/>
      This document is confidential and intended solely for the named recipient.</p>
    </div>
  </div>
</body>
</html>`;
}

/** The "Signed & accepted" ribbon shown on the cover once accepted. */
function signedBadge(signature) {
  if (!signature || !(signature.data_url || signature.captured_signature_path)) return "";
  const code = signature.verification_code
    ? ` &middot; <span class="vc">${esc(signature.verification_code)}</span>`
    : "";
  return `<div class="cover-signed">Signed &amp; accepted &middot; ${esc(
    humanDate(signature.signed_at),
  )}${code}</div>`;
}

/** Common cover metadata line: "Prepared for <candidate> · <date>". */
function coverMetaLine(offer) {
  const who = esc(offer.candidate_name || offer.candidate_email || "the Candidate");
  return `Prepared for ${who} &middot; ${esc(humanDate())}`;
}

/**
 * Full offer packet PDF (Part A: Job Description + Part B: Offer Letter + the
 * execution block). When `signature` is supplied the candidate's e-signature is
 * stamped into the execution block; otherwise a blank ruled line is shown.
 */
function offerPacketHtml({ offer, company, signature = null }) {
  const { jd_html, offer_letter_html } = renderForWeb(offer);
  const roleTitle = offer.title || "Role";

  const body = `
    <div class="section-banner">
      <h2>Part A</h2>
      <div class="section-sub">Job Description</div>
    </div>
    <div class="doc-body">${jd_html}</div>

    <div class="page-break"></div>
    <div class="brand-header" style="margin: 0 -48px; padding-top: 24px; padding-bottom: 18px;">
      ${logoBlock(company)}
    </div>
    <div style="height: 16px;"></div>

    <div class="section-banner">
      <h2>Part B</h2>
      <div class="section-sub">Offer of Employment</div>
    </div>
    <div class="doc-body">${offer_letter_html}</div>

    ${executionBlock({ company, candidateName: offer.candidate_name || "the Candidate", signature })}`;

  return docShell({
    company,
    headTitle: `Offer — ${roleTitle}`,
    coverKicker: "Offer Packet",
    coverTitle: company.display_name || offer.business || "Offer",
    coverRole: roleTitle,
    coverMeta: coverMetaLine(offer),
    signedBadgeHtml: signedBadge(signature),
    bodyHtml: body,
  });
}

/** Job Description only — a standalone, branded, page-numbered document. */
function jobDescriptionHtml({ offer, company }) {
  const { jd_html } = renderForWeb(offer);
  const roleTitle = offer.title || "Role";
  const body = `
    <div class="section-banner">
      <h2>Job Description</h2>
      <div class="section-sub">${esc(roleTitle)}</div>
    </div>
    <div class="doc-body">${jd_html}</div>`;

  return docShell({
    company,
    headTitle: `Job Description — ${roleTitle}`,
    coverKicker: "Job Description",
    coverTitle: roleTitle,
    coverRole: company.display_name || offer.business || "",
    coverMeta: `Issued ${esc(humanDate())}`,
    bodyHtml: body,
  });
}

/** Offer Letter only — carries the execution block (and signature, if signed). */
function offerLetterHtml({ offer, company, signature = null }) {
  const { offer_letter_html } = renderForWeb(offer);
  const roleTitle = offer.title || "Role";
  const body = `
    <div class="section-banner">
      <h2>Offer of Employment</h2>
      <div class="section-sub">${esc(roleTitle)}</div>
    </div>
    <div class="doc-body">${offer_letter_html}</div>

    ${executionBlock({ company, candidateName: offer.candidate_name || "the Candidate", signature })}`;

  return docShell({
    company,
    headTitle: `Offer Letter — ${roleTitle}`,
    coverKicker: "Offer of Employment",
    coverTitle: roleTitle,
    coverRole: company.display_name || offer.business || "",
    coverMeta: coverMetaLine(offer),
    signedBadgeHtml: signedBadge(signature),
    bodyHtml: body,
  });
}

/**
 * PDF options for the branded recruitment documents. Full-bleed brand banners
 * need zero left/right page margin (the HTML uses `@page{margin:0}` + negative
 * margins); a bottom margin gives the page-number footer room to render. The
 * footer carries the legal name and "Page X of Y" in the brand accent.
 */
function pdfDocOptions(company) {
  const accent = esc(company.accent_colour || "#690909");
  const legalName = esc(company.legal_name || company.display_name || "");
  return {
    format: "A4",
    margin: { top: "0", bottom: "16mm", left: "0", right: "0" },
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;padding:0 14mm;font-family:Georgia,'Times New Roman',serif;font-size:8px;color:#9a9a9a;display:flex;justify-content:space-between;align-items:center;-webkit-print-color-adjust:exact;">
      <span style="color:${accent};letter-spacing:1px;">${legalName}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>`,
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
  jobDescriptionHtml,
  offerLetterHtml,
  pdfDocOptions,
  contractHtml,
};
