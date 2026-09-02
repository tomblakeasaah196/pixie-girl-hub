"use strict";

/**
 * Read a count sheet (.xlsx / .csv) into header→cell objects.
 *
 * Kept apart from `stock-count-sheet.js` (which stays pure) because this is
 * the only part that touches the filesystem — and it is the part that has to
 * cope with what a real workbook contains: a title row above the headers,
 * formula cells, rich-text cells, and the empty rows an operator leaves
 * between colour blocks.
 */

const path = require("path");
const ExcelJS = require("exceljs");

/** The value an operator saw on screen, whatever shape ExcelJS stored it in. */
function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v !== "object") return v;
  // Formula cells carry the cached result; hyperlink/rich-text carry `text`.
  if ("result" in v) return v.result ?? "";
  if ("text" in v) return v.text ?? "";
  if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
  return "";
}

/**
 * The header row is the first row carrying at least two non-empty cells — a
 * one-cell row above the table is a title ("Pixie Wig Products", a date), not
 * headers. Everything below it is data.
 */
function isHeaderRow(values) {
  return values.filter((v) => String(v).trim()).length >= 2;
}

async function readCountSheet(file, sheetName) {
  const wb = new ExcelJS.Workbook();
  const ext = path.extname(file).toLowerCase();
  if (ext === ".csv") await wb.csv.readFile(file);
  else await wb.xlsx.readFile(file);

  const ws = sheetName
    ? wb.getWorksheet(sheetName)
    : wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws)
    throw new Error(
      sheetName
        ? `No worksheet named '${sheetName}' in ${path.basename(file)}`
        : `No readable worksheet in ${path.basename(file)}`,
    );

  const width = Math.max(ws.columnCount, 1);
  let headers = null;
  const rows = [];

  ws.eachRow({ includeEmpty: true }, (row) => {
    const values = [];
    for (let c = 1; c <= width; c++) values.push(cellText(row.getCell(c)));
    if (!headers) {
      if (isHeaderRow(values)) headers = values.map(String);
      return;
    }
    const obj = {};
    headers.forEach((h, i) => {
      if (String(h).trim()) obj[h] = values[i];
    });
    rows.push(obj);
  });

  if (!headers)
    throw new Error(
      `'${ws.name}' has no header row — expected Color / Texture / ` +
        `Cap Construction / Size / Units No.`,
    );

  return { sheetName: ws.name, headers, rows };
}

module.exports = { readCountSheet, cellText, isHeaderRow };
