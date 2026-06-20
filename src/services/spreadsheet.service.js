/**
 * Spreadsheet service — thin, reusable wrappers over ExcelJS for the catalogue
 * import/export engine. Two jobs:
 *   • buildWorkbook(sheets) — generate an .xlsx (templates + data exports),
 *     with an optional read-only Reference sheet and per-column dropdowns that
 *     point at it, so operators can only pick names the system recognises.
 *   • parseWorkbook(buffer) — read an uploaded .xlsx back into plain rows keyed
 *     by the header cells, one array per sheet.
 *
 * Kept deliberately generic: every entity importer (styled, collections,
 * bundles, services) composes these instead of touching ExcelJS directly.
 */

"use strict";

const ExcelJS = require("exceljs");

const HEADER_FILL = "FF1B1B1B";
const HEADER_FONT = "FFFFFFFF";
const REFERENCE_SHEET = "Reference";

/**
 * @typedef {Object} ColumnSpec
 * @property {string} header   Human header shown in row 1.
 * @property {string} key      Object key used for export rows + parsed rows.
 * @property {number} [width]
 * @property {string} [note]   Cell comment on the header (guidance).
 * @property {string[]} [list] Inline dropdown values (small, fixed lists).
 * @property {string} [refColumn] Column letter on the Reference sheet whose
 *                                values become this column's dropdown.
 */

function styleHeaderRow(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: HEADER_FONT } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL },
  };
  row.alignment = { vertical: "middle" };
  row.height = 20;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/** Apply a list data-validation to a column across a generous row range. */
function applyDropdown(ws, colIndex, formulae) {
  const letter = ws.getColumn(colIndex).letter;
  for (let r = 2; r <= 1000; r++) {
    ws.getCell(`${letter}${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae,
      showErrorMessage: true,
      errorStyle: "warning",
      error: "Pick a value from the list (Reference sheet).",
    };
  }
}

/**
 * Build an .xlsx buffer.
 * @param {Object} opts
 * @param {{name:string, columns:ColumnSpec[], rows?:Object[]}[]} opts.sheets
 * @param {{title:string, values:string[]}[]} [opts.reference]  Reference blocks;
 *        each becomes a column on the read-only Reference sheet, referenced by
 *        column letter (A, B, C…) in column order.
 * @returns {Promise<Buffer>}
 */
async function buildWorkbook({ sheets, reference = [] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pixie Girl Hub";
  wb.created = new Date();

  // Reference sheet first so dropdown formulae can point at it.
  const refLetters = {};
  if (reference.length) {
    const ws = wb.addWorksheet(REFERENCE_SHEET, {
      properties: { tabColor: { argb: "FF690909" } },
    });
    ws.columns = reference.map((b) => ({ header: b.title, key: b.title, width: 28 }));
    const maxLen = Math.max(...reference.map((b) => b.values.length), 0);
    for (let r = 0; r < maxLen; r++) {
      ws.addRow(reference.map((b) => b.values[r] ?? null));
    }
    styleHeaderRow(ws);
    reference.forEach((b, idx) => {
      const letter = ws.getColumn(idx + 1).letter;
      refLetters[b.title] = { letter, count: b.values.length };
    });
    ws.state = "visible";
  }

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    ws.columns = sheet.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? 20,
    }));
    for (const row of sheet.rows ?? []) ws.addRow(row);
    styleHeaderRow(ws);

    // Header comments + dropdowns.
    sheet.columns.forEach((c, idx) => {
      const colIndex = idx + 1;
      if (c.note) {
        ws.getCell(`${ws.getColumn(colIndex).letter}1`).note = c.note;
      }
      if (c.list && c.list.length) {
        applyDropdown(ws, colIndex, [`"${c.list.join(",")}"`]);
      } else if (c.refColumn && refLetters[c.refColumn]) {
        const { letter, count } = refLetters[c.refColumn];
        const last = Math.max(count + 1, 2);
        applyDropdown(ws, colIndex, [
          `${REFERENCE_SHEET}!$${letter}$2:$${letter}$${last}`,
        ]);
      }
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * Parse an uploaded workbook into { sheetName: rows[] }, where each row is an
 * object keyed by the (trimmed) header cells. Blank rows are skipped; cell
 * values are coerced to primitives (rich text / formula results unwrapped).
 * @param {Buffer} buffer
 * @returns {Promise<Record<string, Object[]>>}
 */
async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out = {};
  wb.eachSheet((ws) => {
    if (ws.name === REFERENCE_SHEET) return; // read-only guidance, never data
    const headers = [];
    ws.getRow(1).eachCell((cell, col) => {
      headers[col] = String(cellValue(cell) ?? "").trim();
    });
    const rows = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const obj = {};
      let any = false;
      row.eachCell((cell, col) => {
        const key = headers[col];
        if (!key) return;
        const v = cellValue(cell);
        if (v !== null && v !== undefined && v !== "") any = true;
        obj[key] = v;
      });
      if (any) rows.push(obj);
    });
    out[ws.name] = rows;
  });
  return out;
}

/** Unwrap an ExcelJS cell value to a primitive. */
function cellValue(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    if (v.text !== undefined) return v.text; // hyperlink / rich text
    if (v.result !== undefined) return v.result; // formula
    if (v.richText) return v.richText.map((p) => p.text).join("");
    if (v instanceof Date) return v.toISOString();
  }
  return v;
}

module.exports = { buildWorkbook, parseWorkbook, REFERENCE_SHEET };
