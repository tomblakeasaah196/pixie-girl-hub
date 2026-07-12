/**
 * Documents & Signatures (V2.2 §6.13) — signature certificate page.
 *
 * Renders the "signature block" the signer page promises: an A4 page showing
 * each signer's drawn signature, name/role, timestamp, masked IP, and the
 * tamper-proof verification code, plus a VERIFIED seal. Puppeteer turns this
 * HTML into a PDF page which is appended to the signed document (see
 * documents.esign.signed-pdf). Pure — no I/O — so it's unit-testable.
 */

"use strict";

const { formatDateTime } = require("../../utils/dates");

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** "102.89.44.21" → "102.89.44.***"; IPv6 → keep first 3 groups. null → "—". */
function maskIp(ip) {
  if (!ip) return "—";
  const s = String(ip).replace(/^::ffff:/i, "");
  if (s.includes(".")) {
    const p = s.split(".");
    if (p.length === 4) return `${p[0]}.${p[1]}.${p[2]}.***`;
    return s;
  }
  if (s.includes(":")) {
    const p = s.split(":").filter(Boolean);
    return `${p.slice(0, 3).join(":")}:****`;
  }
  return s;
}

function fmtWat(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Canonical "23:57, 11/07/2026" in the operating timezone, tagged WAT so the
  // legal record keeps its explicit West Africa Time reference.
  return `${formatDateTime(d)} WAT`;
}

const brandLabel = (b) =>
  b === "faitlynhair"
    ? "Faitlyn Hair"
    : b === "pixiegirl"
      ? "Pixie Girl Global"
      : "Pixie Girl Hub";

const humanType = (t) =>
  String(t || "document")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * @param {object} p
 * @param {string} p.brand
 * @param {object} p.request  { subject, request_type, request_id, fully_signed_at }
 * @param {object} p.document { title, document_number }
 * @param {Array}  p.signers  each: { display_name, signer_role, signed_at, signed_ip,
 *                                     verification_code, signature_src } (signature_src = data URL or null)
 * @returns {string} full HTML document
 */
function signatureCertificateHtml({ brand, request, document, signers }) {
  const rows = (signers || [])
    .map((s) => {
      const img = s.signature_src
        ? `<img class="sig-img" src="${esc(s.signature_src)}" alt="signature" />`
        : `<div class="sig-img sig-typed">${esc(s.display_name)}</div>`;
      return `
      <div class="sig-block">
        <div class="sig-role-label">${esc(s.signer_role || "Signer")}</div>
        <div class="sig-img-wrap">${img}</div>
        <div class="sig-line"></div>
        <div class="sig-name">${esc(s.display_name)}</div>
        <div class="sig-meta">
          <div class="mrow"><span>Signed</span><b>${esc(fmtWat(s.signed_at))}</b></div>
          <div class="mrow"><span>IP</span><b>${esc(maskIp(s.signed_ip))}</b></div>
          <div class="mrow"><span>Verify</span><b class="hash">${esc(s.verification_code || "—")}</b></div>
        </div>
        <div class="seal">✓ VERIFIED</div>
      </div>`;
    })
    .join("");

  const title = document?.title || request?.subject || "Signed Document";
  const docNo = document?.document_number || "";
  const generated = fmtWat(new Date().toISOString());

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color:#1A1816; padding:6mm 4mm; }
  .head { text-align:center; border-bottom:2px solid #690909; padding-bottom:10px; margin-bottom:18px; }
  .co { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#690909; margin-bottom:4px; }
  .h1 { font-size:20px; font-weight:700; }
  .sub { font-family: Arial, sans-serif; font-size:11px; color:#666; margin-top:4px; }
  .intro { font-family: Arial, sans-serif; font-size:11.5px; color:#444; line-height:1.6; margin-bottom:16px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:22px 28px; }
  .sig-block { break-inside:avoid; }
  .sig-role-label { font-family:Arial, sans-serif; font-size:8.5px; letter-spacing:.12em; text-transform:uppercase; color:#9a9490; margin-bottom:6px; }
  .sig-img-wrap { height:60px; display:flex; align-items:flex-end; }
  .sig-img { max-height:60px; max-width:100%; object-fit:contain; }
  .sig-typed { font-family:'Segoe Script','Brush Script MT',cursive; font-size:26px; color:#1A1816; }
  .sig-line { height:1.5px; background:#690909; margin:4px 0 8px; }
  .sig-name { font-size:13px; font-weight:700; }
  .sig-meta { margin-top:8px; background:#F9F7F5; border:1px solid #E8E4E0; border-radius:4px; padding:8px 10px; }
  .mrow { display:flex; justify-content:space-between; align-items:baseline; font-family:Arial, sans-serif; font-size:9.5px; line-height:1.9; }
  .mrow span { color:#9a9490; }
  .mrow b { color:#1A1816; font-weight:600; }
  .mrow b.hash { font-family:'Courier New', monospace; color:#690909; font-size:9.5px; }
  .seal { display:inline-block; margin-top:8px; border:1.5px solid #1B6B35; color:#1B6B35; font-family:Arial, sans-serif; font-size:8.5px; font-weight:700; letter-spacing:.1em; border-radius:3px; padding:3px 8px; }
  .foot { margin-top:26px; padding-top:12px; border-top:1px solid #E8E4E0; display:flex; justify-content:space-between; align-items:flex-end; font-family:Arial, sans-serif; }
  .foot .l { font-family:'Courier New', monospace; font-size:8px; color:#9a9490; line-height:1.6; }
  .foot .r { text-align:right; }
  .foot .brand { font-family:Georgia, serif; font-size:10px; color:#690909; font-weight:700; }
  .foot .pw { font-size:8px; color:#9a9490; }
</style></head>
<body>
  <div class="head">
    <div class="co">${esc(brandLabel(brand))}</div>
    <div class="h1">Signature Certificate</div>
    <div class="sub">${esc(title)}${docNo ? ` · ${esc(docNo)}` : ""} · ${esc(humanType(request?.request_type))}</div>
  </div>
  <p class="intro">
    This certificate records the electronic signatures applied to the document above.
    Each signature is bound to a timestamp and a tamper-proof verification code that can be
    checked at <b>/verify/&lt;code&gt;</b>. Altering the document or any signature invalidates its code.
  </p>
  <div class="grid">${rows}</div>
  <div class="foot">
    <div class="l">
      Request ${esc(request?.request_id || "")}<br />
      Completed ${esc(fmtWat(request?.fully_signed_at))}<br />
      Generated ${esc(generated)}
    </div>
    <div class="r">
      <div class="brand">${esc(brandLabel(brand))}</div>
      <div class="pw">Powered by Pixie Girl Hub · E-Sign</div>
    </div>
  </div>
</body></html>`;
}

module.exports = { signatureCertificateHtml, maskIp, fmtWat };
