/**
 * Shared HTML templates for PDF rendering (pdf.service).
 *
 * Small, dependency-free, inline-CSS templates so any module can produce a
 * branded PDF by calling pdf.service.renderAndStore(reportHtml(...)) etc.
 * Keep markup self-contained (no external assets) so Chromium needs no network.
 */

"use strict";

function esc(s) {
  return String(s === null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ngn = (v) =>
  `₦${Number(v || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

function shell(title, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
         color: #1a1a1a; font-size: 12px; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 18px 0 6px; border-bottom: 1px solid #e5e5e5; padding-bottom: 3px; }
  .muted { color: #777; }
  .meta { color: #666; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 11px; }
  th { background: #fafafa; color: #555; font-weight: 600; }
  .right { text-align: right; }
  .totals td { border: none; padding: 3px 8px; }
  .brandbar { height: 4px; background: #d6336c; margin-bottom: 14px; }
</style></head><body><div class="brandbar"></div>${bodyHtml}</body></html>`;
}

/** Generic key/value report (used by J-7 report-generate). */
function reportHtml({ title, subtitle, generated_at, sections = [] }) {
  const body = `
    <h1>${esc(title || "Report")}</h1>
    ${subtitle ? `<div class="meta">${esc(subtitle)}</div>` : ""}
    <div class="meta">Generated ${esc(generated_at || new Date().toISOString())} — Pixie Girl Hub</div>
    ${sections
      .map((sec) => {
        if (sec.rows) {
          const rows = sec.rows
            .map(
              ([k, v]) =>
                `<tr><td>${esc(k)}</td><td class="right">${esc(v)}</td></tr>`,
            )
            .join("");
          return `<h2>${esc(sec.heading || "")}</h2><table>${rows}</table>`;
        }
        if (sec.table) {
          const head = `<tr>${sec.table.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
          const rows = sec.table.data
            .map(
              (r) =>
                `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`,
            )
            .join("");
          return `<h2>${esc(sec.heading || "")}</h2><table>${head}${rows}</table>`;
        }
        return `<h2>${esc(sec.heading || "")}</h2><p>${esc(sec.text || "")}</p>`;
      })
      .join("")}
  `;
  return shell(title || "Report", body);
}

/** Delivery letter / waybill (used by X-1). */
function deliveryLetterHtml({ brand, delivery }) {
  const d = delivery || {};
  const items = Array.isArray(d.items) ? d.items : [];
  const itemRows = items.length
    ? `<h2>Items</h2><table>
         <tr><th>Item</th><th class="right">Qty</th></tr>
         ${items
           .map(
             (it) =>
               `<tr><td>${esc(it.description || it.name || it.sku || "—")}</td><td class="right">${esc(it.quantity ?? "")}</td></tr>`,
           )
           .join("")}
       </table>`
    : "";
  const body = `
    <h1>Delivery Letter</h1>
    <div class="meta">${esc(brand)} · Waybill ${esc(d.tracking_number || d.delivery_number || d.delivery_id || "")}</div>
    <h2>Recipient</h2>
    <table>
      <tr><td>Name</td><td class="right">${esc(d.recipient_name || d.contact_name || "—")}</td></tr>
      <tr><td>Phone</td><td class="right">${esc(d.recipient_phone || d.contact_phone || "—")}</td></tr>
      <tr><td>Address</td><td class="right">${esc(d.delivery_address || d.address || "—")}</td></tr>
      <tr><td>Courier</td><td class="right">${esc(d.courier_name || d.courier_id || "—")}</td></tr>
      <tr><td>Order</td><td class="right">${esc(d.order_number || d.order_id || "—")}</td></tr>
      ${d.cod_amount_ngn !== null ? `<tr><td>Cash on delivery</td><td class="right">${esc(ngn(d.cod_amount_ngn))}</td></tr>` : ""}
    </table>
    ${itemRows}
    <h2>Sign on receipt</h2>
    <p class="muted">Received in good condition by: ____________________________  Date: ____________</p>
  `;
  return shell("Delivery Letter", body);
}

module.exports = { reportHtml, deliveryLetterHtml, shell, esc, ngn };
