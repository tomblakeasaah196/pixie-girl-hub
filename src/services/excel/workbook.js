/**
 * Shared ExcelJS workbook toolkit — the Maroon Noir house style for every
 * .xlsx the platform exports (deep-red #690909 header + cream text, frozen
 * header rows, zebra striping, ₦ number formats, bold totals, autofilter).
 *
 * Extracted as cross-module infrastructure for the dashboards module; the
 * sales report exporter (src/modules/sales/sales-report.export.js) predates
 * this file and keeps its local copy of the same conventions.
 *
 * Builders are pure (rows in → sheet out) so exports unit-test without a DB.
 */

"use strict";

const ExcelJS = require("exceljs");
const { formatTz } = require("../../utils/dates");

// House style
const ACCENT = "FF690909"; // Maroon Noir deep-red
const CREAM = "FFF4E9D9";
const ZEBRA = "FFF6F2F2";
const TITLE_FILL = "FF2A0A0A";
const NGN_FMT = "#,##0.00;[Red]-#,##0.00";
const INT_FMT = "#,##0";
const NUM_FMT = "#,##0.0";
const PCT_FMT = '#,##0.0"%"';

/** Postgres NUMERIC comes back as a string — coerce for an Excel number cell. */
const num = (v) =>
  v === null || v === undefined || v === "" ? null : Number(v);
const fmtDate = (v) => (v ? formatTz(new Date(v), "yyyy-MM-dd HH:mm") : "");
const fmtDay = (v) => (v ? formatTz(new Date(v), "yyyy-MM-dd") : "");

/** numFmt + coercer for the manifest formats used across dashboards. */
function cellSpec(format) {
  switch (format) {
    case "money":
      return { fmt: NGN_FMT, coerce: num, align: "right" };
    case "int":
      return { fmt: INT_FMT, coerce: num, align: "right" };
    case "num":
      return { fmt: NUM_FMT, coerce: num, align: "right" };
    case "pct":
      return { fmt: PCT_FMT, coerce: num, align: "right" };
    case "date":
      return { coerce: fmtDay };
    case "datetime":
      return { coerce: fmtDate };
    case "bool":
      return { coerce: (v) => (v === true ? "Yes" : v === false ? "No" : "") };
    default:
      return { coerce: (v) => (v === null || v === undefined ? "" : String(v)) };
  }
}

function styleHeader(ws, rowNumber = 1) {
  const row = ws.getRow(rowNumber);
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    cell.font = { bold: true, color: { argb: CREAM } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: ACCENT } } };
  });
  row.height = 22;
}

/**
 * Title banner + meta rows at the top of a summary sheet.
 * `meta` is [[label, value], ...].
 */
function addTitleBlock(ws, title, subtitle, meta = []) {
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 26;
  ws.getColumn(3).width = 20;
  ws.getColumn(4).width = 20;

  ws.mergeCells("A1:D1");
  const cell = ws.getCell("A1");
  cell.value = title;
  cell.font = { name: "Playfair Display", size: 20, bold: true, color: { argb: CREAM } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
  cell.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 34;

  if (subtitle) {
    ws.mergeCells("A2:D2");
    const sub = ws.getCell("A2");
    sub.value = subtitle;
    sub.font = { italic: true, color: { argb: ACCENT } };
    ws.getRow(2).height = 18;
  }

  let r = subtitle ? 4 : 3;
  for (const [label, value] of meta) {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).value = value;
    r += 1;
  }
  return r + 1; // first free row
}

/**
 * Data sheet with a styled header, per-column formats (via manifest
 * `columns: [{key,label,format}]`), zebra striping and autofilter.
 */
function addManifestTable(wb, name, columns, rows) {
  // Sheet names: ≤31 chars, no []:*?/\, unique within the workbook.
  let safe = String(name).replace(/[[\]:*?/\\]/g, " ").slice(0, 31);
  let n = 2;
  while (wb.getWorksheet(safe)) {
    const suffix = ` (${n})`;
    safe = `${String(name).replace(/[[\]:*?/\\]/g, " ").slice(0, 31 - suffix.length)}${suffix}`;
    n += 1;
  }
  const ws = wb.addWorksheet(safe, { views: [{ state: "frozen", ySplit: 1 }] });
  const specs = columns.map((c) => cellSpec(c.format));
  ws.columns = columns.map((c, i) => ({
    header: c.label,
    key: c.key,
    width: Math.max(12, Math.min(34, c.label.length + 8)),
    style: specs[i].fmt ? { numFmt: specs[i].fmt } : undefined,
  }));
  styleHeader(ws);

  for (const r of rows) {
    const values = {};
    columns.forEach((c, i) => {
      values[c.key] = specs[i].coerce(r[c.key]);
    });
    const row = ws.addRow(values);
    columns.forEach((c, i) => {
      if (specs[i].align) {
        row.getCell(i + 1).alignment = { horizontal: specs[i].align };
      }
    });
    if (row.number % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      });
    }
  }
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
  return ws;
}

/** KPI block on a summary sheet: label · value (+Δ%). Returns next free row. */
function addKpiRows(ws, startRow, kpis) {
  let r = startRow;
  ws.getCell(r, 1).value = "KPI";
  ws.getCell(r, 2).value = "Value";
  ws.getCell(r, 3).value = "Previous";
  ws.getCell(r, 4).value = "Δ %";
  styleHeader(ws, r);
  r += 1;
  for (const k of kpis) {
    const spec = cellSpec(k.format);
    ws.getCell(r, 1).value = k.label;
    const v = ws.getCell(r, 2);
    v.value = spec.coerce ? spec.coerce(k.value) : k.value;
    if (spec.fmt) v.numFmt = spec.fmt;
    if (k.previous !== null && k.previous !== undefined) {
      const pv = ws.getCell(r, 3);
      pv.value = spec.coerce ? spec.coerce(k.previous) : k.previous;
      if (spec.fmt) pv.numFmt = spec.fmt;
    }
    if (k.delta_pct !== null && k.delta_pct !== undefined) {
      const d = ws.getCell(r, 4);
      d.value = num(k.delta_pct);
      d.numFmt = '+#,##0.0"%";-#,##0.0"%"';
    }
    if (r % 2 === 0) {
      for (let c = 1; c <= 4; c += 1) {
        ws.getCell(r, c).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: ZEBRA },
        };
      }
    }
    r += 1;
  }
  return r + 1;
}

function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pixie Girl Hub";
  wb.created = new Date();
  return wb;
}

async function toBuffer(wb) {
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

module.exports = {
  ACCENT,
  CREAM,
  ZEBRA,
  TITLE_FILL,
  NGN_FMT,
  INT_FMT,
  NUM_FMT,
  PCT_FMT,
  num,
  fmtDate,
  fmtDay,
  cellSpec,
  styleHeader,
  addTitleBlock,
  addManifestTable,
  addKpiRows,
  newWorkbook,
  toBuffer,
};
