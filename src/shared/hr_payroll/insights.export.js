/**
 * Performance → Insights exports.
 *
 *   • buildWorkbook(...)   — a styled multi-sheet .xlsx (Sales Exec summary,
 *                            Leaderboard, Channel Mix, Attendance). Pure
 *                            (data in → Buffer out) so it unit-tests without a
 *                            browser or DB. Maroon Noir house style, matching
 *                            the Sales Report workbook.
 *   • exportInsightsExcel  — pulls the two reports and returns { buffer, filename }.
 *   • exportWinnerPdf      — renders the "Sales Exec of the Month" certificate to
 *                            a stored PDF document (downloaded by document_id).
 */

"use strict";

const ExcelJS = require("exceljs");
const pdf = require("../../services/pdf.service");
const service = require("./insights.service");

// ── House style (mirrors sales-report.export.js) ───────────
const ACCENT = "FF690909"; // Maroon Noir deep-red
const CREAM = "FFF4E9D9";
const ZEBRA = "FFF6F2F2";
const TITLE_FILL = "FF2A0A0A";
const NGN_FMT = "#,##0.00;[Red]-#,##0.00";
const INT_FMT = "#,##0";
const PCT_FMT = '0.0"%"';

function headerRow(ws, cells) {
  const row = ws.addRow(cells);
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    cell.font = { bold: true, color: { argb: CREAM }, size: 11 };
    cell.alignment = { vertical: "middle" };
  });
  row.height = 20;
  return row;
}

function zebra(ws, fromRow) {
  for (let r = fromRow; r <= ws.rowCount; r++) {
    if ((r - fromRow) % 2 === 1) {
      ws.getRow(r).eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      });
    }
  }
}

function titleBlock(ws, title, subtitle) {
  const t = ws.addRow([title]);
  t.getCell(1).font = { bold: true, size: 16, color: { argb: CREAM } };
  t.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
  t.height = 26;
  ws.mergeCells(t.number, 1, t.number, 6);
  const s = ws.addRow([subtitle]);
  s.getCell(1).font = { italic: true, size: 10, color: { argb: "FF888888" } };
  ws.mergeCells(s.number, 1, s.number, 6);
  ws.addRow([]);
}

/** Build the workbook Buffer from already-computed reports. */
async function buildWorkbook({ sales, attendance, brand }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pixie Girl Hub";
  wb.created = new Date();
  const periodLabel = `${sales.period.from} → ${sales.period.to}`;
  const brandLabel = brand === "faitlynhair" ? "Faitlynhair" : "Pixie Girl Global";

  // ── Sheet 1: Sales Exec summary ──────────────────────────
  const s1 = wb.addWorksheet("Sales Exec");
  s1.columns = [{ width: 34 }, { width: 18 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }];
  titleBlock(s1, `Sales Exec of the Month — ${brandLabel}`, periodLabel);
  if (sales.winner) {
    const w = s1.addRow(["🏆 Winner", sales.winner.staff_name]);
    w.getCell(1).font = { bold: true, size: 12 };
    w.getCell(2).font = { bold: true, size: 12, color: { argb: ACCENT } };
    s1.addRow(["Sales closed", sales.winner.closed_count]).getCell(2).numFmt = INT_FMT;
    s1.addRow(["Share of all sales", sales.winner.share_pct]).getCell(2).numFmt = PCT_FMT;
    s1.addRow(["Value closed (₦)", Number(sales.winner.total_ngn)]).getCell(2).numFmt = NGN_FMT;
  } else {
    s1.addRow(["No staff-closed sales in this period."]);
  }
  s1.addRow([]);
  headerRow(s1, ["Totals", "Value"]);
  const totalsStart = s1.rowCount + 1;
  s1.addRow(["Total sales (all channels)", sales.totals.total_closed]).getCell(2).numFmt = INT_FMT;
  s1.addRow(["Staff-closed sales", sales.totals.attributed_closed]).getCell(2).numFmt = INT_FMT;
  s1.addRow(["Online / self-service (unattributed)", sales.totals.unattributed_closed]).getCell(2).numFmt = INT_FMT;
  s1.addRow(["Total value (₦)", Number(sales.totals.total_ngn)]).getCell(2).numFmt = NGN_FMT;
  s1.addRow(["Reps who closed at least one sale", sales.totals.rep_count]).getCell(2).numFmt = INT_FMT;
  zebra(s1, totalsStart);

  // ── Sheet 2: Leaderboard ─────────────────────────────────
  const s2 = wb.addWorksheet("Leaderboard");
  s2.columns = [{ width: 8 }, { width: 32 }, { width: 16 }, { width: 16 }, { width: 18 }];
  headerRow(s2, ["Rank", "Staff", "Sales closed", "Share of all sales", "Value closed (₦)"]);
  const l2Start = s2.rowCount + 1;
  for (const r of sales.leaderboard) {
    const row = s2.addRow([r.rank, r.staff_name, r.closed_count, r.share_pct, Number(r.total_ngn)]);
    row.getCell(3).numFmt = INT_FMT;
    row.getCell(4).numFmt = PCT_FMT;
    row.getCell(5).numFmt = NGN_FMT;
  }
  // Online bucket as a final, visually distinct row.
  const online = s2.addRow([
    "—",
    sales.unattributed.label,
    sales.unattributed.closed_count,
    sales.unattributed.share_pct,
    Number(sales.unattributed.total_ngn),
  ]);
  online.eachCell((cell) => (cell.font = { italic: true, color: { argb: "FF888888" } }));
  online.getCell(3).numFmt = INT_FMT;
  online.getCell(4).numFmt = PCT_FMT;
  online.getCell(5).numFmt = NGN_FMT;
  zebra(s2, l2Start);
  s2.views = [{ state: "frozen", ySplit: 1 }];

  // ── Sheet 3: Channel Mix ─────────────────────────────────
  const s3 = wb.addWorksheet("Channel Mix");
  s3.columns = [{ width: 26 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 18 }];
  headerRow(s3, ["Channel", "Sales", "Attributed", "Share", "Value (₦)"]);
  const l3Start = s3.rowCount + 1;
  for (const c of sales.channel_mix) {
    const row = s3.addRow([
      c.label + (c.self_service ? " (self-service)" : ""),
      c.closed_count,
      c.attributed_count,
      c.share_pct,
      Number(c.total_ngn),
    ]);
    row.getCell(2).numFmt = INT_FMT;
    row.getCell(3).numFmt = INT_FMT;
    row.getCell(4).numFmt = PCT_FMT;
    row.getCell(5).numFmt = NGN_FMT;
  }
  zebra(s3, l3Start);
  s3.views = [{ state: "frozen", ySplit: 1 }];

  // ── Sheet 4: Attendance ──────────────────────────────────
  const s4 = wb.addWorksheet("Attendance");
  s4.columns = [
    { width: 32 }, { width: 12 }, { width: 10 }, { width: 10 },
    { width: 10 }, { width: 12 }, { width: 14 }, { width: 14 },
  ];
  headerRow(s4, ["Staff", "Present", "Late", "Absent", "Leave", "Off-site", "On-time %", "Hours worked"]);
  const l4Start = s4.rowCount + 1;
  for (const s of attendance.staff) {
    const row = s4.addRow([
      s.staff_name,
      s.present_days,
      s.late_days,
      s.absent_days,
      s.leave_days,
      s.offsite_days,
      s.on_time_pct === null ? "—" : s.on_time_pct,
      s.hours_worked,
    ]);
    if (typeof row.getCell(7).value === "number") row.getCell(7).numFmt = PCT_FMT;
    row.getCell(8).numFmt = "#,##0.0";
  }
  zebra(s4, l4Start);
  s4.views = [{ state: "frozen", ySplit: 1 }];

  return wb.xlsx.writeBuffer();
}

/** Pull both reports and produce the workbook Buffer + filename. */
async function exportInsightsExcel({ brand, from, to }) {
  const [sales, attendance] = await Promise.all([
    service.salesReport({ brand, from, to, withCompare: false }),
    service.attendanceReport({ brand, from, to }),
  ]);
  const buffer = await buildWorkbook({ sales, attendance, brand });
  const filename = `performance-insights-${sales.period.from}_${sales.period.to}.xlsx`;
  return { buffer, filename };
}

// ── Winner PDF certificate ─────────────────────────────────
function esc(s) {
  return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function winnerPdfHtml({ sales, brand }) {
  const brandLabel = brand === "faitlynhair" ? "Faitlynhair" : "Pixie Girl Global";
  const w = sales.winner;
  const ngn = (v) => "₦" + Number(v || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rows = sales.leaderboard
    .slice(0, 10)
    .map(
      (r) =>
        `<tr><td>${r.rank}</td><td>${esc(r.staff_name)}</td><td class="num">${r.closed_count}</td><td class="num">${r.share_pct}%</td><td class="num">${ngn(r.total_ngn)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:'Helvetica Neue',Arial,sans-serif;color:#2A0A0A;margin:0;padding:40px;background:#fff;}
    .cert{border:3px solid #690909;border-radius:16px;padding:36px;text-align:center;}
    .brand{letter-spacing:3px;text-transform:uppercase;color:#888;font-size:12px;}
    h1{font-size:26px;color:#690909;margin:10px 0 4px;}
    .period{color:#888;font-size:13px;margin-bottom:24px;}
    .winner{font-size:40px;font-weight:800;color:#2A0A0A;margin:8px 0;}
    .stat{display:inline-block;margin:8px 18px;}
    .stat .v{font-size:24px;font-weight:800;color:#690909;}
    .stat .l{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;}
    table{width:100%;border-collapse:collapse;margin-top:28px;font-size:12px;}
    th{background:#690909;color:#F4E9D9;padding:8px;text-align:left;}
    td{padding:7px 8px;border-bottom:1px solid #eee;text-align:left;}
    td.num,th.num{text-align:right;}
    .foot{margin-top:22px;color:#aaa;font-size:10px;}
  </style></head><body>
    <div class="cert">
      <div class="brand">${esc(brandLabel)}</div>
      <h1>🏆 Sales Exec of the Month</h1>
      <div class="period">${esc(sales.period.from)} → ${esc(sales.period.to)}</div>
      ${
        w
          ? `<div class="winner">${esc(w.staff_name)}</div>
             <div>
               <span class="stat"><div class="v">${w.closed_count}</div><div class="l">Sales closed</div></span>
               <span class="stat"><div class="v">${w.share_pct}%</div><div class="l">Of all sales</div></span>
               <span class="stat"><div class="v">${ngn(w.total_ngn)}</div><div class="l">Value closed</div></span>
             </div>`
          : `<div class="winner">—</div><div class="period">No staff-closed sales in this period.</div>`
      }
      <table>
        <thead><tr><th>#</th><th>Staff</th><th class="num">Closed</th><th class="num">Share</th><th class="num">Value</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5">No sales attributed.</td></tr>`}</tbody>
      </table>
      <div class="foot">Online / self-service sales (${sales.unattributed.closed_count}) are counted in the total but credited to no individual.</div>
    </div>
  </body></html>`;
}

/** Render + store the winner certificate. Returns { document_id, title }. */
async function exportWinnerPdf({ brand, user, from, to }) {
  const sales = await service.salesReport({ brand, from, to, withCompare: false });
  const html = winnerPdfHtml({ sales, brand });
  const stored = await pdf.renderAndStore({
    brand,
    user_id: user ? user.user_id : null,
    html,
    title: `Sales Exec of the Month — ${sales.period.from} to ${sales.period.to}`,
    document_type: "performance_insight",
    reference_type: "performance_insight",
    reference_id: null,
  });
  return { document_id: stored.document_id, title: stored.title, winner: sales.winner };
}

module.exports = { buildWorkbook, exportInsightsExcel, winnerPdfHtml, exportWinnerPdf };
