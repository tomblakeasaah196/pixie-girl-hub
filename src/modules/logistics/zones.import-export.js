/**
 * Delivery zones — Excel import/export.
 *
 * ── EXPORT (download template) ─────────────────────────────
 * A three-sheet workbook the owner can edit and re-upload:
 *   Sheet "Nigeria - States"  — nationwide courier (states excl. Lagos)
 *   Sheet "Lagos - LGAs"       — Safe Logistics (20 Lagos LGAs)
 *   Sheet "International"       — DHL Express (countries)
 * Columns: Zone Name | Zone Code | 1-2 | 3-4 | 5-6 | Extra per 2 | Active.
 *
 * ── IMPORT (upload) ────────────────────────────────────────
 * Deliberately format-tolerant so the owner can upload EITHER the template
 * above OR the original supplier rate cards exactly as received:
 *   • DHL Global Wig Logistics Rates  (Continent | Country | DHL Zone | tiers…)
 *   • Wig Logistics Rate Card Nationwide  (State | Geopolitical Zone | tiers…)
 *   • Safe Wig Logistics Rate Card Lekki Pickup  (LGA | Distance | tiers…)
 *
 * Each can be its own single-sheet workbook, may carry a title banner row
 * above the header, and stores money as formatted text ("₦88,100", "+ ₦84,000")
 * or "TBD (Local)" / "Use Local Courier" placeholders. The parser:
 *   1. Detects the courier (safe_lagos | nationwide | dhl_express) per sheet
 *      from the sheet name + the first few rows' header/title text.
 *   2. Locates the header row and maps columns by their header text (not a
 *      fixed position), so column order/extra columns don't matter.
 *   3. Parses ₦-formatted money; skips rows whose base rate is non-numeric
 *      (Lagos "TBD (Local)", Nigeria "Use Local Courier").
 *   4. Upserts by NORMALISED zone name within the detected courier — so the
 *      seeded zones are refreshed in place (no duplicates) even when the
 *      supplier name differs slightly (e.g. "Lagos Mainland (Yaba, etc.)").
 */

"use strict";

const ExcelJS = require("exceljs");
const { query, transaction } = require("../../config/database");
const { t } = require("../../config/brands");

// ── Shared template column layout (export) ─────────────────
const COLUMNS = [
  { header: "Zone Name", key: "name", width: 36 },
  { header: "Zone Code (do not change)", key: "country_code", width: 24 },
  { header: "1-2 Wigs – Base Rate (NGN)", key: "fee_1_2", width: 26 },
  { header: "3-4 Wigs (NGN)", key: "fee_3_4", width: 18 },
  { header: "5-6 Wigs (NGN)", key: "fee_5_6", width: 18 },
  { header: "Every Extra 2 Wigs – Add-on (NGN)", key: "addon", width: 30 },
  { header: "Active (Y/N)", key: "active", width: 14 },
];

const HDR_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF690909" } };
const HDR_FONT = { color: { argb: "FFFFFFFF" }, bold: true };
const NGN_FMT = "#,##0";

function applyHeaderStyle(row) {
  row.eachCell((cell) => {
    cell.fill = HDR_FILL;
    cell.font = HDR_FONT;
    cell.alignment = { vertical: "middle", wrapText: false };
  });
  row.height = 20;
}

function addSheet(wb, name, rows) {
  const ws = wb.addWorksheet(name);
  ws.columns = COLUMNS;
  applyHeaderStyle(ws.getRow(1));

  for (const r of rows) {
    const row = ws.addRow(r);
    for (const col of [3, 4, 5, 6]) row.getCell(col).numFmt = NGN_FMT;
    if (row.number % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
      });
    }
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return ws;
}

// ── Build template (download) ──────────────────────────────

async function buildTemplate({ brand }) {
  const { rows: zones } = await query(
    `SELECT name, country_code, fee_ngn, rate_card, courier_key, is_active
       FROM ${t(brand, "delivery_zones")}
      ORDER BY courier_key NULLS LAST, name`,
  );

  const stateZones = zones.filter((z) => z.courier_key === "nationwide");
  const lagosZones = zones.filter((z) => z.courier_key === "safe_lagos");
  const intlZones = zones.filter((z) => z.courier_key === "dhl_express");

  const toRow = (z) => {
    const rc = z.rate_card || {};
    const tiers = Array.isArray(rc.tiers) ? rc.tiers : [];
    return {
      name: z.name,
      country_code: z.country_code || "",
      fee_1_2: tiers[0] ? Number(tiers[0].fee_ngn) : Number(z.fee_ngn),
      fee_3_4: tiers[1] ? Number(tiers[1].fee_ngn) : "",
      fee_5_6: tiers[2] ? Number(tiers[2].fee_ngn) : "",
      addon: isNil(rc.add_on_per_2_ngn) ? "" : Number(rc.add_on_per_2_ngn),
      active: z.is_active ? "Y" : "N",
    };
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "Pixie Girl Hub";
  wb.created = new Date();

  addSheet(wb, "Nigeria - States", stateZones.map(toRow));
  addSheet(wb, "Lagos - LGAs", lagosZones.map(toRow));
  addSheet(wb, "International", intlZones.map(toRow));

  return wb.xlsx.writeBuffer();
}

// ── Cell / value helpers ───────────────────────────────────

const isNil = (x) => x === null || x === undefined;

/** Coerce any ExcelJS cell value (string, number, rich text, hyperlink,
 *  formula result) to plain text. */
function cellText(v) {
  if (isNil(v)) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if (Array.isArray(v.richText))
      return v.richText.map((rt) => rt.text).join("");
    if (!isNil(v.text)) return String(v.text); // hyperlink
    if (!isNil(v.result)) return String(v.result); // formula result
    return "";
  }
  return String(v);
}

/** Parse a Naira amount from a cell value. Handles plain numbers and
 *  formatted text ("₦88,100", "+ ₦84,000"). Returns null for placeholders
 *  ("TBD (Local)", "Use Local Courier", "N/A", blank). */
function parseNaira(v) {
  if (isNil(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = cellText(v).trim();
  if (!s) return null;
  if (/tbd|local\s+courier|n\/a/i.test(s)) return null;
  const cleaned = s.replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Normalise a zone name for matching: lowercase, drop parenthetical
 *  qualifiers, collapse non-alphanumerics. "Lagos Mainland (Yaba, etc.)" and
 *  "Lagos Mainland (Yaba)" both → "lagos mainland". */
function normName(s) {
  return cellText(s)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugCode(prefix, name) {
  const slug = normName(name).replace(/\s+/g, "-").toUpperCase().slice(0, 24);
  return `${prefix}${slug}`;
}

// ── Sheet detection + column mapping ───────────────────────

const COURIER_PRIORITY = { dhl_express: 10, nationwide: 20, safe_lagos: 30 };

/** Decide which courier a worksheet belongs to from its name + top rows. */
function detectCourier(ws) {
  const parts = [ws.name || ""];
  for (let r = 1; r <= 4; r++) {
    const row = ws.getRow(r);
    row.eachCell({ includeEmpty: false }, (cell) => parts.push(cellText(cell.value)));
  }
  const hay = parts.join(" | ").toLowerCase();
  // Order matters: Lagos cues ("lekki"/"lga") are most specific.
  if (/lekki|local government|\blga\b|lagos - lgas|safe rates/.test(hay))
    return "safe_lagos";
  if (/geopolitical|nationwide|nigeria - states/.test(hay)) return "nationwide";
  if (/\bdhl\b|continent|international|global/.test(hay)) return "dhl_express";
  return null;
}

/** Find the header row index (1-based) and a column map by scanning the top
 *  rows for the tier headers. Returns null if no recognisable header found. */
function locateColumns(ws) {
  const maxScan = Math.min(ws.rowCount, 8) || 8;
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    const map = { name: null, code: null, t1: null, t2: null, t3: null, addon: null };
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const h = cellText(cell.value).toLowerCase().replace(/\s+/g, " ").trim();
      if (!h) return;
      if (map.t1 === null && /1\s*[-–]\s*2/.test(h)) map.t1 = col;
      else if (map.t2 === null && /3\s*[-–]\s*4/.test(h)) map.t2 = col;
      else if (map.t3 === null && /5\s*[-–]\s*6/.test(h)) map.t3 = col;
      if (map.addon === null && /(every\s+)?extra|add[\s-]?on/.test(h))
        map.addon = col;
      if (map.code === null && /zone code/.test(h)) map.code = col;
      if (
        map.name === null &&
        /(zone name|^state$|^country$|local government|\blga\b)/.test(h)
      )
        map.name = col;
    });
    // A real header row has at least the base tier; treat the first column as
    // the name column when no explicit name header was matched.
    if (map.t1 !== null) {
      if (map.name === null) map.name = 1;
      return { headerRow: r, map };
    }
  }
  return null;
}

function buildRateCard(f1, f2, f3, addon) {
  return {
    tiers: [
      { label: "1–2 Wigs", min_qty: 1, max_qty: 2, fee_ngn: f1 },
      { label: "3–4 Wigs", min_qty: 3, max_qty: 4, fee_ngn: f2 === null ? f1 : f2 },
      {
        label: "5–6 Wigs",
        min_qty: 5,
        max_qty: 6,
        fee_ngn: f3 === null ? (f2 === null ? f1 : f2) : f3,
      },
    ],
    add_on_per_2_ngn: addon === null ? 0 : addon,
  };
}

/** Parse one worksheet into zone rows for the given courier.
 *  Returns { rows, skipped } — skipped counts named rows with no usable base
 *  rate (the Lagos "TBD (Local)" / Nigeria "Use Local Courier" placeholders). */
function parseSheet(ws, courierKey) {
  const located = locateColumns(ws);
  if (!located) return { rows: [], skipped: 0 };
  const { headerRow, map } = located;
  const out = [];
  let skipped = 0;

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum <= headerRow) return;
    const name = cellText(row.getCell(map.name).value).trim();
    if (!name) return;
    const f1 = parseNaira(row.getCell(map.t1).value);
    // No usable base rate → placeholder row (Lagos "TBD", Nigeria "Use Local
    // Courier") — skip it rather than seeding a zero fee.
    if (f1 === null || f1 <= 0) {
      skipped++;
      return;
    }
    const f2 = map.t2 ? parseNaira(row.getCell(map.t2).value) : null;
    const f3 = map.t3 ? parseNaira(row.getCell(map.t3).value) : null;
    const addon = map.addon ? parseNaira(row.getCell(map.addon).value) : null;
    const code = map.code ? cellText(row.getCell(map.code).value).trim() : "";

    out.push({
      name,
      norm: normName(name),
      country_code: code || null,
      fee_ngn: f1,
      rate_card: buildRateCard(f1, f2, f3, addon),
      courier_key: courierKey,
    });
  });
  return { rows: out, skipped };
}

// ── Import ─────────────────────────────────────────────────

async function importFromBuffer({ brand, buffer, user_id }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  // Collect parsed rows across every worksheet, detecting each sheet's courier.
  const parsed = [];
  const detected = [];
  const errors = [];
  let skipped = 0;

  wb.eachSheet((ws) => {
    const courierKey = detectCourier(ws);
    if (!courierKey) {
      detected.push({ sheet: ws.name, courier: null, rows: 0, unrecognised: true });
      return;
    }
    const { rows, skipped: sk } = parseSheet(ws, courierKey);
    skipped += sk;
    detected.push({ sheet: ws.name, courier: courierKey, rows: rows.length });
    parsed.push(...rows);
  });

  if (!parsed.length) {
    return {
      created: 0,
      updated: 0,
      skipped,
      total: 0,
      detected,
      errors: [
        {
          error:
            "No recognisable rate rows found. Upload the DHL / Nationwide / Lagos rate card, or the downloaded template.",
        },
      ],
    };
  }

  let created = 0;
  let updated = 0;

  await transaction(async (client) => {
    // Pre-load existing zones per courier so we can match by normalised name.
    const { rows: existing } = await client.query(
      `SELECT zone_id, name, courier_key, country_code
         FROM ${t(brand, "delivery_zones")}`,
    );
    const index = new Map(); // `${courier}::${normName}` -> zone row
    for (const z of existing) {
      index.set(`${z.courier_key}::${normName(z.name)}`, z);
    }

    for (const r of parsed) {
      try {
        const hit = index.get(`${r.courier_key}::${r.norm}`);
        if (hit) {
          await client.query(
            `UPDATE ${t(brand, "delivery_zones")}
                SET fee_ngn    = $2,
                    rate_card  = $3::jsonb,
                    is_active  = true,
                    -- backfill a code only when the zone has none yet
                    country_code = COALESCE(country_code, $4),
                    updated_at = now()
              WHERE zone_id = $1`,
            [hit.zone_id, r.fee_ngn, JSON.stringify(r.rate_card), r.country_code],
          );
          updated++;
        } else {
          const code =
            r.country_code ||
            (r.courier_key === "safe_lagos"
              ? slugCode("NG-LA-", r.name)
              : r.courier_key === "nationwide"
                ? slugCode("NG-", r.name)
                : slugCode("X-", r.name));
          await client.query(
            `INSERT INTO ${t(brand, "delivery_zones")}
               (name, geometry_type, geometry, fee_ngn, country_code, priority,
                is_active, rate_card, courier_key, created_by)
             VALUES ($1,'country','{}'::jsonb,$2,$3,$4,true,$5::jsonb,$6,$7)`,
            [
              r.name,
              r.fee_ngn,
              code,
              COURIER_PRIORITY[r.courier_key] || 0,
              JSON.stringify(r.rate_card),
              r.courier_key,
              user_id || null,
            ],
          );
          // Index the new zone so a duplicate later in the same file updates it.
          index.set(`${r.courier_key}::${r.norm}`, {
            zone_id: null,
            name: r.name,
            courier_key: r.courier_key,
            country_code: code,
          });
          created++;
        }
      } catch (err) {
        errors.push({ name: r.name, error: err.message });
      }
    }
  });

  return {
    created,
    updated,
    skipped,
    total: parsed.length,
    detected,
    errors,
  };
}

module.exports = { buildTemplate, importFromBuffer };

// Exposed for unit tests (parse-level verification without a DB).
module.exports._internals = {
  cellText,
  parseNaira,
  normName,
  detectCourier,
  locateColumns,
  parseSheet,
};
