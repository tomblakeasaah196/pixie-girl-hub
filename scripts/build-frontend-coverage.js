#!/usr/bin/env node
/**
 * Frontend module coverage tracker.
 *
 * Reads docs/frontend-modules.json (the source of truth) and regenerates:
 *   - docs/Frontend_Module_Coverage.xlsx   (open in Excel; check the Built? box)
 *   - docs/FRONTEND_MODULE_COVERAGE.md      (viewable on GitHub)
 *
 * The .xlsx is written as raw OOXML + the system `zip` (no npm deps), so any
 * branch/agent can regenerate it. The Built? column is a Yes/Partial/No
 * dropdown and the weighted coverage % is a live formula
 * ((Yes + ½·Partial) / Total) that recalculates as you toggle cells.
 *
 * Usage:
 *   node scripts/build-frontend-coverage.js                 # regenerate
 *   node scripts/build-frontend-coverage.js --set sales=done,crm=partial
 *   node scripts/build-frontend-coverage.js --list          # print to console
 *
 * Status values: done | partial | todo  (synonyms: yes/built→done, no→todo).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const JSON_PATH = path.join(ROOT, "docs", "frontend-modules.json");
const XLSX_PATH = path.join(ROOT, "docs", "Frontend_Module_Coverage.xlsx");
const MD_PATH = path.join(ROOT, "docs", "FRONTEND_MODULE_COVERAGE.md");

const STATUS = {
  done: { weight: 1, built: "Yes", md: "✅ Done" },
  partial: { weight: 0.5, built: "Partial", md: "🟡 Partial" },
  todo: { weight: 0, built: "No", md: "⬜ To-do" },
};
const SYNONYM = {
  yes: "done",
  built: "done",
  complete: "done",
  no: "todo",
  "": "todo",
};

function normStatus(s) {
  const k = String(s || "")
    .toLowerCase()
    .trim();
  const v = SYNONYM[k] || k;
  return STATUS[v] ? v : "todo";
}

function loadData() {
  const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
  data.modules.forEach((m) => (m.status = normStatus(m.status)));
  return data;
}

// ── CLI: --set key=status,... mutates the JSON, then regenerates ──
function applySet(data, spec) {
  const byKey = new Map(data.modules.map((m) => [m.key, m]));
  let changed = 0;
  for (const pair of spec.split(",")) {
    const [key, val] = pair.split("=").map((s) => s && s.trim());
    if (!key) continue;
    const m = byKey.get(key);
    if (!m) {
      process.stderr.write(`  ! unknown module key: ${key}\n`);
      continue;
    }
    m.status = normStatus(val);
    changed++;
  }
  if (changed) {
    fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2) + "\n");
    process.stdout.write(
      `  updated ${changed} module(s) in frontend-modules.json\n`,
    );
  }
  return data;
}

function shortLabel(name) {
  return String(name)
    .split(/[(/·&]| - /)[0]
    .trim();
}

function tally(modules) {
  const c = { done: 0, partial: 0, todo: 0 };
  modules.forEach((m) => (c[m.status] += 1));
  const total = modules.length;
  const weighted = total ? (c.done + 0.5 * c.partial) / total : 0;
  return { ...c, total, weighted };
}

// ════════════════════════════════════════════════════════════
// XLSX (OOXML) writer — no deps
// ════════════════════════════════════════════════════════════
const xesc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const colLetter = (n) => {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const cellStr = (col, row, style, text) =>
  `<c r="${colLetter(col)}${row}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xesc(text)}</t></is></c>`;
const cellNum = (col, row, style, val) =>
  `<c r="${colLetter(col)}${row}" s="${style}"><v>${val}</v></c>`;
const cellFormula = (col, row, style, formula, cached) =>
  `<c r="${colLetter(col)}${row}" s="${style}"><f>${xesc(formula)}</f><v>${cached}</v></c>`;

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="15"/><color rgb="FF690909"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF690909"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD9D2C8"/></left><right style="thin"><color rgb="FFD9D2C8"/></right><top style="thin"><color rgb="FFD9D2C8"/></top><bottom style="thin"><color rgb="FFD9D2C8"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="9" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
</cellXfs>
</styleSheet>`;
}

function sheetXml(data) {
  const mods = data.modules;
  const byKey = new Map(mods.map((m) => [m.key, m]));
  const t = tally(mods);
  const headerRow = 4;
  const first = headerRow + 1;
  const last = headerRow + mods.length;
  const builtRange = `F${first}:F${last}`;
  const rows = [];

  // Row 1 — title (merged across A1:G1)
  rows.push(
    `<row r="1" ht="24" customHeight="1">${cellStr(1, 1, 1, data.title)}</row>`,
  );

  // Row 2 — weighted coverage + built count
  rows.push(
    `<row r="2" ht="18" customHeight="1">` +
      cellStr(1, 2, 5, "Weighted coverage") +
      cellFormula(
        2,
        2,
        3,
        `(COUNTIF(${builtRange},"Yes")+0.5*COUNTIF(${builtRange},"Partial"))/${mods.length}`,
        t.weighted.toFixed(6),
      ) +
      cellStr(4, 2, 5, "Built (Yes)") +
      cellFormula(5, 2, 5, `COUNTIF(${builtRange},"Yes")`, t.done) +
      `</row>`,
  );
  // Row 3 — totals breakdown
  rows.push(
    `<row r="3" ht="18" customHeight="1">` +
      cellStr(1, 3, 5, "Total modules") +
      cellNum(2, 3, 5, mods.length) +
      cellStr(4, 3, 5, "Partial") +
      cellFormula(5, 3, 5, `COUNTIF(${builtRange},"Partial")`, t.partial) +
      cellStr(6, 3, 5, "To-do") +
      cellFormula(7, 3, 5, `COUNTIF(${builtRange},"No")`, t.todo) +
      `</row>`,
  );

  // Row 4 — header
  const headers = [
    "#",
    "Module",
    "Group",
    "Primary route",
    "Connects with",
    "Built?",
    "Notes",
  ];
  rows.push(
    `<row r="4" ht="22" customHeight="1">` +
      headers.map((h, i) => cellStr(i + 1, 4, 2, h)).join("") +
      `</row>`,
  );

  // Data rows
  mods.forEach((m, idx) => {
    const r = first + idx;
    const connects = (m.connects || [])
      .map((k) => (byKey.get(k) ? shortLabel(byKey.get(k).name) : k))
      .join(", ");
    rows.push(
      `<row r="${r}">` +
        cellNum(1, r, 6, idx + 1) +
        cellStr(2, r, 4, m.name) +
        cellStr(3, r, 4, m.group) +
        cellStr(4, r, 4, m.route) +
        cellStr(5, r, 4, connects) +
        cellStr(6, r, 6, STATUS[m.status].built) +
        cellStr(7, r, 4, m.notes || "") +
        `</row>`,
    );
  });

  const cols =
    `<cols>` +
    `<col min="1" max="1" width="5" customWidth="1"/>` +
    `<col min="2" max="2" width="46" customWidth="1"/>` +
    `<col min="3" max="3" width="20" customWidth="1"/>` +
    `<col min="4" max="4" width="20" customWidth="1"/>` +
    `<col min="5" max="5" width="46" customWidth="1"/>` +
    `<col min="6" max="6" width="12" customWidth="1"/>` +
    `<col min="7" max="7" width="52" customWidth="1"/>` +
    `</cols>`;

  const merge = `<mergeCells count="1"><mergeCell ref="A1:G1"/></mergeCells>`;
  const validation =
    `<dataValidations count="1">` +
    `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${builtRange}">` +
    `<formula1>"Yes,Partial,No"</formula1></dataValidation></dataValidations>`;
  const freeze = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:G${last}"/>
${freeze}
${cols}
<sheetData>${rows.join("")}</sheetData>
${merge}
${validation}
</worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Coverage" sheetId="1" r:id="rId1"/></sheets>
<calcPr fullCalcOnLoad="1"/>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

// Minimal ZIP writer (pure Node, no `zip` binary → works on Windows too).
// Deflated entries with a precomputed CRC32 table; enough for a valid .xlsx.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipSync(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf-8");
    const crc = crc32(data);
    const comp = zlib.deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    chunks.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // local header offset
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

function writeXlsx(data) {
  const entries = [
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES) },
    { name: "_rels/.rels", data: Buffer.from(ROOT_RELS) },
    { name: "xl/workbook.xml", data: Buffer.from(WORKBOOK) },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(WORKBOOK_RELS) },
    { name: "xl/styles.xml", data: Buffer.from(stylesXml()) },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml(data)) },
  ];
  fs.writeFileSync(XLSX_PATH, zipSync(entries));
}

// ════════════════════════════════════════════════════════════
// Markdown mirror
// ════════════════════════════════════════════════════════════
function writeMarkdown(data) {
  const mods = data.modules;
  const byKey = new Map(mods.map((m) => [m.key, m]));
  const t = tally(mods);
  const pct = Math.round(t.weighted * 100);
  const lines = [];
  lines.push(`# ${data.title}`);
  lines.push("");
  lines.push(
    `**Weighted coverage: ${pct}%** &nbsp;·&nbsp; ✅ Done **${t.done}** · 🟡 Partial **${t.partial}** · ⬜ To-do **${t.todo}** · Total **${t.total}**`,
  );
  lines.push("");
  lines.push(
    `> Weighted = (Done + ½·Partial) / Total. Edit \`docs/frontend-modules.json\` and run \`node scripts/build-frontend-coverage.js\` to update (or \`--set key=done\`). The \`.xlsx\` has a Yes/Partial/No dropdown and a live coverage formula.`,
  );
  lines.push("");
  lines.push("| # | Module | Group | Route | Connects with | Built? | Notes |");
  lines.push("|--:|--------|-------|-------|---------------|:------:|-------|");
  mods.forEach((m, i) => {
    const connects = (m.connects || [])
      .map((k) => (byKey.get(k) ? shortLabel(byKey.get(k).name) : k))
      .join(", ");
    lines.push(
      `| ${i + 1} | ${m.name} | ${m.group} | \`${m.route}\` | ${connects} | ${STATUS[m.status].md} | ${m.notes || ""} |`,
    );
  });
  lines.push("");
  lines.push(`_Last generated: ${new Date().toISOString().slice(0, 10)}._`);
  lines.push("");
  fs.writeFileSync(MD_PATH, lines.join("\n"));
}

// ════════════════════════════════════════════════════════════
function main() {
  const args = process.argv.slice(2);
  let data = loadData();

  const setArg = args.find((a) => a.startsWith("--set"));
  if (setArg) {
    const spec = setArg.includes("=")
      ? setArg.slice(setArg.indexOf("=") + 1)
      : args[args.indexOf(setArg) + 1];
    if (spec) data = applySet(data, spec);
  }

  const t = tally(data.modules);
  if (args.includes("--list")) {
    process.stdout.write(
      data.modules
        .map(
          (m) => `  [${STATUS[m.status].built.padEnd(7)}] ${m.key} — ${m.name}`,
        )
        .join("\n") + "\n",
    );
  }

  writeXlsx(data);
  writeMarkdown(data);
  process.stdout.write(
    `Coverage: ${Math.round(t.weighted * 100)}% — Done ${t.done}, Partial ${t.partial}, To-do ${t.todo}, Total ${t.total}\n` +
      `Wrote docs/Frontend_Module_Coverage.xlsx and docs/FRONTEND_MODULE_COVERAGE.md\n`,
  );
}

main();
