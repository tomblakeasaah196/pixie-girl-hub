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
    ws.columns = reference.map((b) => ({
      header: b.title,
      key: b.title,
      width: 28,
    }));
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

// ════════════════════════════════════════════════════════════
// CSV — a single-sheet, Excel-friendly text format. Templates and exports
// are emitted as CSV (every spreadsheet app opens it, no library needed to
// edit), while imports accept BOTH CSV and .xlsx (auto-detected by magic
// bytes — an .xlsx is a ZIP archive starting "PK\x03\x04").
// ════════════════════════════════════════════════════════════

/** Quote a CSV cell per RFC 4180 (escape embedded quotes, wrap if needed). */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a CSV buffer (UTF-8 with a BOM so Excel renders Naira names / accents
 * correctly). Rows are objects keyed by each column's `key`.
 * @param {{columns:{header:string,key:string}[], rows?:Object[]}} opts
 * @returns {Buffer}
 */
function buildCsv({ columns, rows = [] }) {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c.key])).join(","));
  }
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

/**
 * Parse CSV text (RFC 4180: quoted fields, "" escapes, CRLF/LF, BOM) into an
 * array of objects keyed by the trimmed header row. Fully blank rows skipped.
 * @param {string|Buffer} input
 * @returns {Object[]}
 */
function parseCsv(input) {
  let text = Buffer.isBuffer(input) ? input.toString("utf8") : String(input);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  const grid = [];
  let row = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    grid.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      if (text[i + 1] !== "\n") endRow(); // lone CR = EOL; CRLF handled by \n
    } else field += ch;
  }
  if (field !== "" || row.length) endRow(); // flush trailing field/row

  if (!grid.length) return [];
  const headers = grid[0].map((h) => String(h ?? "").trim());
  const out = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    if (cells.every((c) => String(c ?? "").trim() === "")) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = cells[idx] ?? "";
    });
    out.push(obj);
  }
  return out;
}

/** An .xlsx is a ZIP — its first bytes are the local-file-header magic "PK". */
function looksLikeXlsx(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 2 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b
  );
}

/**
 * Parse an uploaded import file (CSV or .xlsx) into a single array of header-
 * keyed rows. Format is auto-detected by content, so the same import endpoint
 * accepts either — the filename is advisory only.
 * @param {{buffer:Buffer, filename?:string}} opts
 * @returns {Promise<Object[]>}
 */
async function parseUpload({ buffer, filename = "" }) {
  if (looksLikeXlsx(buffer)) {
    const sheets = await parseWorkbook(buffer);
    const names = Object.keys(sheets);
    return names.length ? sheets[names[0]] : [];
  }
  // Extension is a last-resort hint; content detection above is authoritative.
  void filename;
  return parseCsv(buffer);
}

module.exports = {
  buildWorkbook,
  parseWorkbook,
  buildCsv,
  parseCsv,
  parseUpload,
  REFERENCE_SHEET,
};
