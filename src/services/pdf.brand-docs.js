/**
 * Brand-driven document renderer (V2.2 §6.5) — portrait A4 invoices + receipts.
 *
 * Pure functions, no I/O. Takes a resolved brand identity (the same tokens
 * email-render.resolveBrandTokens produces from business_config) + a normalised
 * document, and returns a print-ready A4 portrait HTML doc that reskins per
 * brand (accent, secondary, logo, name, address). Every money line — discount,
 * delivery, VAT — renders (the legacy pdf.templates invoice/receipt dropped
 * them); zero rows auto-hide. A diagonal PAID stamp shows when doc.watermark is
 * set. Editable copy (notes + curated thank-you) is resolved upstream by
 * services/document-copy.js, so the Invoicing → Settings tab drives the wording.
 *
 * Consumed by invoicing.service (invoice PDF) + sales.service (receipt PDF).
 */
"use strict";

// ── colour helpers ──────────────────────────────────────────────
function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
function hex2rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  const n = m ? parseInt(m[1], 16) : 0x690909;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb2hex([r, g, b]) {
  return "#" + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("");
}
/** mix a hex toward white by ratio (0=hex, 1=white) */
function tint(hex, ratio) {
  const [r, g, b] = hex2rgb(hex);
  return rgb2hex([r + (255 - r) * ratio, g + (255 - g) * ratio, b + (255 - b) * ratio]);
}
/** darken a hex by ratio */
function shade(hex, ratio) {
  const [r, g, b] = hex2rgb(hex);
  const f = 1 - ratio;
  return rgb2hex([r * f, g * f, b * f]);
}

function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const present = (v) => v !== null && v !== undefined && v !== "";
/** Escape, then turn newlines into <br> — for operator-editable copy. */
function safeMultiline(s) {
  return esc(s).replace(/\r?\n/g, "<br/>");
}
function ngn(v) {
  const n = Number(v || 0);
  return "₦" + (Number.isFinite(n) ? n : 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

// Brand monogram tile (stands in for a real logo_url when none is set).
function monogram(brand) {
  if (brand.logo_url) {
    return `<img src="${esc(brand.logo_url)}" alt="${esc(brand.brand_name)}" style="height:46px;width:auto;display:block" />`;
  }
  const initials = String(brand.brand_name || "Brand")
    .split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return `<div style="width:46px;height:46px;border-radius:9px;background:${brand.accent};
    display:flex;align-items:center;justify-content:center;color:#fff;
    font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:600;letter-spacing:1px">${esc(initials)}</div>`;
}

function partyBlock(label, p, accent) {
  if (!p) return "";
  const lines = [p.name, p.company, p.address, p.cityline, p.phone, p.email]
    .filter(present).map((l) => `<div>${esc(l)}</div>`).join("");
  return `<td style="vertical-align:top;padding-right:20px">
    <div class="eyebrow" style="color:${accent}">${esc(label)}</div>
    <div class="party">${lines}</div>
  </td>`;
}

function totalsRows(doc, accent) {
  const rows = [];
  const r = (label, val, opts = {}) => `<tr class="${opts.cls || ""}">
      <td class="t-label" style="${opts.strong ? `color:${accent};font-weight:700` : ""}">${esc(label)}</td>
      <td class="t-val" style="${opts.strong ? `color:${accent};font-weight:700;font-size:15px` : ""}">${esc(val)}</td>
    </tr>`;
  rows.push(r("Subtotal", ngn(doc.subtotal_ngn)));
  if (Number(doc.discount_amount_ngn) > 0) rows.push(r("Discount", "−" + ngn(doc.discount_amount_ngn)));
  if (Number(doc.shipping_fee_ngn) > 0) rows.push(r("Delivery", ngn(doc.shipping_fee_ngn)));
  else if (doc.show_free_delivery) rows.push(r("Delivery", "Free"));
  if (Number(doc.tax_amount_ngn) > 0) {
    const rate = present(doc.tax_rate) ? ` (${(Number(doc.tax_rate) * 100).toFixed(Number(doc.tax_rate) * 100 % 1 ? 1 : 0)}%)` : "";
    rows.push(r("VAT" + rate, ngn(doc.tax_amount_ngn)));
  }
  rows.push(r("Total", ngn(doc.total_ngn), { strong: true, cls: "t-total" }));
  if (present(doc.amount_paid_ngn)) rows.push(r("Amount paid", ngn(doc.amount_paid_ngn)));
  if (present(doc.balance_due_ngn)) rows.push(r("Balance due", ngn(doc.balance_due_ngn)));
  return rows.join("");
}

function lineRows(doc) {
  const lines = Array.isArray(doc.lines) ? doc.lines : [];
  if (!lines.length) return `<tr><td colspan="4" class="muted" style="padding:18px 12px">No line items</td></tr>`;
  return lines.map((l, i) => `<tr${i % 2 ? ' class="zebra"' : ""}>
    <td class="c-desc">${esc(l.description)}</td>
    <td class="c-qty">${esc(l.quantity)}</td>
    <td class="c-num">${esc(ngn(l.unit_price_ngn))}</td>
    <td class="c-num">${esc(ngn(l.line_total_ngn))}</td>
  </tr>`).join("");
}

// Delivery-note items: no prices — Item (+ optional SKU) and Qty only.
function lineRowsDelivery(doc) {
  const lines = Array.isArray(doc.lines) ? doc.lines : [];
  if (!lines.length) return `<tr><td colspan="2" class="muted" style="padding:18px 12px">No items</td></tr>`;
  return lines.map((l, i) => `<tr${i % 2 ? ' class="zebra"' : ""}>
    <td class="c-desc">${esc(l.description)}${l.sku ? `<div style="font-size:10px;color:#9b9088">${esc(l.sku)}</div>` : ""}</td>
    <td class="c-qty">${esc(l.quantity)}</td>
  </tr>`).join("");
}

// Right-hand acknowledgement block for delivery notes (replaces the totals).
function signatureBlock(doc, accent, hairline, muted) {
  const cod =
    Number(doc.cod_amount_ngn || 0) > 0
      ? `<div style="margin-bottom:14px;font-size:12px;color:${accent};font-weight:700">Cash on delivery: ${ngn(doc.cod_amount_ngn)}</div>`
      : "";
  const line = (label) =>
    `<div style="margin-top:20px;border-bottom:1px solid ${hairline};height:1px"></div>
     <div style="font-size:10px;color:${muted};margin-top:4px;text-transform:uppercase;letter-spacing:1px">${esc(label)}</div>`;
  return `<div style="width:280px">
    ${cod}
    <div class="eyebrow" style="color:${accent}">Received in good condition</div>
    ${line("Name")}${line("Signature")}${line("Date")}
  </div>`;
}

/**
 * @param {object} brand  { brand_name, brand_legal_name, accent, secondary,
 *                          logo_url, website_url, support_email, brand_address,
 *                          brand_phone, year }
 * @param {object} doc    document data (kind 'INVOICE'|'RECEIPT' + fields)
 */
function documentHtml(brand, doc) {
  const accent = brand.accent || "#690909";
  const accentDeep = brand.accent_deep || shade(accent, 0.28);
  const hairline = "#E7E1DA";
  const ink = "#1B1714";
  const muted = "#7C736B";
  const isReceipt = doc.kind === "RECEIPT";
  const statusPill = doc.status_label
    ? `<span class="pill" style="background:${doc.status_tone === "paid" ? "#1E7A4D" : accent}">${esc(doc.status_label)}</span>`
    : "";

  const metaRows = (doc.meta || []).map(
    (m) => `<tr><td class="m-k">${esc(m[0])}</td><td class="m-v">${esc(m[1])}</td></tr>`,
  ).join("");

  // Diagonal ghosted stamp (shown on paid documents). Sits on top at low
  // opacity so it reads like an ink stamp without hurting legibility.
  const watermark = doc.watermark
    ? `<div class="stamp" style="color:${doc.watermark_tone === "paid" ? "#1E7A4D" : accent}">${esc(doc.watermark)}</div>`
    : "";

  // Delivery notes carry no money: a 2-column item list + an acknowledgement
  // block instead of priced columns + a totals table.
  const isDelivery = (doc.itemsMode || "priced") === "delivery";
  const itemsHead = isDelivery
    ? `<th>Item</th><th class="r" style="text-align:center;width:90px">Qty</th>`
    : `<th>Description</th><th class="r" style="text-align:center">Qty</th>
       <th class="r">Unit Price</th><th class="r">Amount</th>`;
  const itemsBody = isDelivery ? lineRowsDelivery(doc) : lineRows(doc);
  const lowerRight = isDelivery
    ? signatureBlock(doc, accent, hairline, muted)
    : `<table class="totals">${totalsRows(doc, accent)}</table>`;

  // NOTE: no external @font-face / @import / <link>. The PDF engine renders with
  // waitUntil:'networkidle0', so ANY network request (e.g. Google Fonts) makes
  // it hang until timeout on a locked-down server → "failed to generate PDF".
  // We name the brand fonts first (used if installed on the host) and always
  // fall back to bundled system fonts, so rendering is fully offline + instant.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; background:#EDE9E4; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { font-family:'Montserrat','Helvetica Neue',Arial,sans-serif; color:${ink}; font-size:12px; }
  .sheet { width:210mm; min-height:297mm; margin:0 auto; background:#fff; padding:17mm 16mm 14mm; position:relative; }
  .serif { font-family:'Playfair Display',Georgia,serif; }
  .mono  { font-family:'JetBrains Mono','SFMono-Regular',Consolas,monospace; }
  .muted { color:${muted}; }
  .eyebrow { font-size:9.5px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin-bottom:6px; }
  /* header */
  .head { display:flex; justify-content:space-between; align-items:flex-start; }
  .brandrow { display:flex; align-items:center; gap:13px; }
  .coname { font-size:25px; font-weight:600; color:${accentDeep}; line-height:1.05; }
  .cotag  { font-size:10.5px; color:${muted}; margin-top:2px; letter-spacing:.5px; }
  .doctitle { font-size:34px; font-weight:700; color:${accent}; letter-spacing:1px; text-align:right; line-height:1; }
  .pill { display:inline-block; margin-top:9px; color:#fff; font-size:9.5px; font-weight:700; letter-spacing:1.5px;
          text-transform:uppercase; padding:4px 11px; border-radius:20px; }
  .rule { height:2px; background:${accent}; margin:14px 0 0; }
  .rule-soft { height:1px; background:${hairline}; }
  /* meta + parties */
  .band { display:flex; justify-content:space-between; margin-top:18px; }
  table.parties { border-collapse:collapse; }
  .party { font-size:11px; line-height:1.55; color:${ink}; }
  .party div:first-child { font-weight:600; }
  table.meta { border-collapse:collapse; min-width:188px; }
  table.meta .m-k { color:${muted}; padding:3px 0; font-size:11px; }
  table.meta .m-v { text-align:right; padding:3px 0 3px 22px; font-weight:600; font-size:11px; white-space:nowrap; }
  /* items */
  table.items { width:100%; border-collapse:collapse; margin-top:20px; }
  table.items thead th { background:${accent}; color:#fff; text-align:left; font-size:10px; font-weight:600;
        letter-spacing:1px; text-transform:uppercase; padding:9px 12px; }
  table.items thead th.r { text-align:right; }
  table.items td { padding:11px 12px; border-bottom:1px solid ${hairline}; font-size:11.5px; vertical-align:top; }
  tr.zebra td { background:${tint(accent, 0.965)}; }
  .c-qty { text-align:center; width:46px; color:${muted}; }
  .c-num { text-align:right; font-family:'JetBrains Mono',monospace; white-space:nowrap; width:120px; }
  .c-desc { color:${ink}; }
  /* totals */
  .lower { display:flex; justify-content:space-between; margin-top:18px; gap:24px; }
  .notes { flex:1; }
  .notebox { border:1px solid ${hairline}; border-left:3px solid ${accent}; border-radius:6px; padding:13px 15px;
        font-size:10.5px; line-height:1.6; color:${ink}; background:${tint(accent, 0.975)}; }
  table.totals { width:280px; border-collapse:collapse; }
  table.totals td { padding:6px 0; font-size:12px; }
  table.totals .t-label { color:${muted}; }
  table.totals .t-val { text-align:right; font-family:'JetBrains Mono',monospace; color:${ink}; white-space:nowrap; }
  tr.t-total td { border-top:2px solid ${accent}; padding-top:11px; }
  tr.t-total .t-val { font-family:'Playfair Display',Georgia,serif; }
  .thanks { text-align:right; margin-top:14px; color:${accent}; font-family:'Playfair Display',Georgia,serif;
        font-size:17px; font-weight:600; }
  /* footer */
  .foot { position:absolute; left:16mm; right:16mm; bottom:11mm; }
  .foot .rule-soft { margin-bottom:8px; }
  .foot .row { display:flex; justify-content:space-between; font-size:10px; color:${muted}; }
  .foot a { color:${muted}; text-decoration:none; }
  /* paid stamp */
  .stamp { position:absolute; top:46%; left:0; right:0; text-align:center;
        font-family:'Playfair Display',Georgia,serif; font-size:150px; font-weight:700;
        letter-spacing:14px; text-transform:uppercase; opacity:.08;
        transform:rotate(-24deg); transform-origin:center; pointer-events:none;
        z-index:9; white-space:nowrap; }
</style></head>
<body>
  <div class="sheet">
    ${watermark}
    <div class="head">
      <div class="brandrow">
        ${monogram(brand)}
        ${
          // When a logo image is set it already shows the brand name, so we drop
          // the repeated name text from the header (the name then lives in the
          // "From" block). With no logo we keep the monogram + name. The tagline,
          // if any, still shows alongside the logo.
          !brand.logo_url || brand.tagline
            ? `<div>
          ${!brand.logo_url ? `<div class="coname serif">${esc(brand.brand_name)}</div>` : ""}
          ${brand.tagline ? `<div class="cotag">${esc(brand.tagline)}</div>` : ""}
        </div>`
            : ""
        }
      </div>
      <div>
        <div class="doctitle serif">${esc(doc.kind)}</div>
        <div style="text-align:right">${statusPill}</div>
      </div>
    </div>
    <div class="rule"></div>

    <div class="band">
      <table class="parties"><tr>
        ${partyBlock("From", doc.from, accent)}
        ${partyBlock("Bill to", doc.bill_to, accent)}
        ${!isReceipt && doc.ship_to ? partyBlock("Ship to", doc.ship_to, accent) : ""}
      </tr></table>
      <table class="meta">${metaRows}</table>
    </div>

    <table class="items">
      <thead><tr>${itemsHead}</tr></thead>
      <tbody>${itemsBody}</tbody>
    </table>

    <div class="lower">
      <div class="notes">
        ${doc.notes ? `<div class="eyebrow" style="color:${accent}">${esc(doc.notes_label || "Notes")}</div>
          <div class="notebox">${safeMultiline(doc.notes)}</div>` : ""}
      </div>
      ${lowerRight}
    </div>

    ${doc.thanks ? `<div class="thanks">${esc(doc.thanks)}</div>` : ""}

    <div class="foot">
      <div class="rule-soft"></div>
      <div class="row">
        <div>${esc(brand.brand_legal_name || brand.brand_name)}${brand.brand_phone ? " · " + esc(brand.brand_phone) : ""}</div>
        <div>${brand.website_url ? `<a href="${esc(brand.website_url)}">${esc(brand.website_url.replace(/^https?:\/\//, ""))}</a> · ` : ""}${esc(brand.support_email || "")}</div>
      </div>
    </div>
  </div>
</body></html>`;
}

const invoiceHtml = (brand, doc) => documentHtml(brand, { ...doc, kind: "INVOICE" });
const receiptHtml = (brand, doc) => documentHtml(brand, { ...doc, kind: "RECEIPT" });
const quotationHtml = (brand, doc) =>
  documentHtml(brand, { ...doc, kind: "QUOTATION" });
const deliveryNoteHtml = (brand, doc) =>
  documentHtml(brand, { ...doc, kind: "DELIVERY NOTE", itemsMode: "delivery" });

/**
 * Map email-render.resolveBrandTokens() output → the brand identity shape this
 * renderer expects. Keeps the document skin and the email skin reading from one
 * source of brand truth (business_config), so they never drift.
 */
function brandFromTokens(t = {}) {
  return {
    brand_name: t.brand_name,
    brand_legal_name: t.brand_legal_name || t.brand_name,
    logo_url: t.logo_url || null,
    accent: t.brand_color || "#690909",
    accent_deep: t.brand_color_deep || null,
    secondary: t.brand_secondary || null,
    website_url: t.website_url || null,
    support_email: t.support_email || null,
    brand_address: t.brand_address || null,
    brand_phone: t.brand_phone || null,
    tagline: t.tagline || null,
    year: t.year || String(new Date().getFullYear()),
  };
}

// The renderer draws its own full-bleed A4 "sheet" (210×297mm with internal
// padding), so the PDF engine must apply ZERO page margins — otherwise the
// sheet sits inside the engine's default margins and overflows/clips. Pass this
// as renderAndStore({ pdfOptions }) for every brand document.
const PDF_OPTIONS = {
  format: "A4",
  margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
};

module.exports = {
  invoiceHtml,
  receiptHtml,
  quotationHtml,
  deliveryNoteHtml,
  documentHtml,
  brandFromTokens,
  PDF_OPTIONS,
  tint,
  shade,
};
