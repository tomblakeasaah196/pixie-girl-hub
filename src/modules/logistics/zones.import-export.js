/**
 * Delivery zones — Excel import/export.
 *
 * Three-sheet workbook:
 *   Sheet 1 "Nigeria - States"   (35 rows: all states excl. Lagos)
 *   Sheet 2 "Lagos - LGAs"       (20 rows: Lagos local government areas)
 *   Sheet 3 "International"      (countries served via DHL)
 *
 * Columns per sheet:
 *   Zone Name | State/Country Code | 1-2 Wigs (NGN) | 3-4 Wigs (NGN) |
 *   5-6 Wigs (NGN) | Extra per 2 Wigs (NGN) | Active (Y/N)
 *
 * Import upsert key: exact (zone_name + country_code) match → UPDATE; else INSERT.
 */

"use strict";

const ExcelJS = require("exceljs");
const { query, transaction } = require("../../config/database");
const { t } = require("../../config/brands");

// Column definitions shared across all sheets.
const COLUMNS = [
  { header: "Zone Name", key: "name", width: 36 },
  { header: "Zone Code (do not change)", key: "country_code", width: 24 },
  { header: "1-2 Wigs – Base Rate (NGN)", key: "fee_1_2", width: 26 },
  { header: "3-4 Wigs (NGN)", key: "fee_3_4", width: 18 },
  { header: "5-6 Wigs (NGN)", key: "fee_5_6", width: 18 },
  { header: "Extra per 2 Wigs Add-on (NGN)", key: "addon", width: 30 },
  { header: "Active (Y/N)", key: "active", width: 14 },
];

// Header row style.
const HDR_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF690909" },
};
const HDR_FONT = { color: { argb: "FFFFFFFF" }, bold: true };

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
    // Shade alternate rows lightly.
    if (row.number % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF5F5F5" },
        };
      });
    }
  }

  // Freeze header row.
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

  // Partition into the three logical groups.
  const stateZones = zones.filter((z) => z.courier_key === "nationwide");
  const lagosZones = zones.filter((z) => z.courier_key === "safe_lagos");
  const intlZones = zones.filter((z) => z.courier_key === "dhl_express");

  const toRow = (z) => {
    const rc = z.rate_card || {};
    const tiers = Array.isArray(rc.tiers) ? rc.tiers : [];
    return {
      name: z.name,
      country_code: z.country_code || "",
      fee_1_2: tiers[0] ? tiers[0].fee_ngn : Number(z.fee_ngn),
      fee_3_4: tiers[1] ? tiers[1].fee_ngn : "",
      fee_5_6: tiers[2] ? tiers[2].fee_ngn : "",
      addon: rc.add_on_per_2_ngn || "",
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

// ── Parse a sheet ──────────────────────────────────────────

function parseSheet(ws, courierKey) {
  const parsed = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // header
    const name = String(row.getCell(1).value || "").trim();
    const code = String(row.getCell(2).value || "").trim();
    const f1 = Number(row.getCell(3).value) || 0;
    const f2 = Number(row.getCell(4).value) || 0;
    const f3 = Number(row.getCell(5).value) || 0;
    const addon = Number(row.getCell(6).value) || 0;
    const activeRaw = String(row.getCell(7).value || "Y").trim().toUpperCase();
    if (!name) return;
    parsed.push({
      name,
      country_code: code || null,
      fee_ngn: f1,
      rate_card: {
        tiers: [
          { label: "1–2 Wigs", min_qty: 1, max_qty: 2, fee_ngn: f1 },
          { label: "3–4 Wigs", min_qty: 3, max_qty: 4, fee_ngn: f2 },
          { label: "5–6 Wigs", min_qty: 5, max_qty: 6, fee_ngn: f3 },
        ],
        add_on_per_2_ngn: addon,
      },
      courier_key: courierKey,
      is_active: activeRaw !== "N",
    });
  });
  return parsed;
}

// ── Import ─────────────────────────────────────────────────

async function importFromBuffer({ brand, buffer, user_id }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheetMap = [
    { sheetName: "Nigeria - States", courierKey: "nationwide" },
    { sheetName: "Lagos - LGAs", courierKey: "safe_lagos" },
    { sheetName: "International", courierKey: "dhl_express" },
  ];

  const allRows = [];
  for (const { sheetName, courierKey } of sheetMap) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) continue;
    allRows.push(...parseSheet(ws, courierKey));
  }

  let created = 0;
  let updated = 0;
  const errors = [];

  await transaction(async (client) => {
    for (const r of allRows) {
      try {
        // Upsert by (name, courier_key) — the natural key for seeded zones.
        const { rowCount } = await client.query(
          `UPDATE ${t(brand, "delivery_zones")}
              SET fee_ngn     = $3,
                  rate_card   = $4::jsonb,
                  is_active   = $5,
                  updated_at  = now()
            WHERE name = $1 AND courier_key = $2`,
          [
            r.name,
            r.courier_key,
            r.fee_ngn,
            JSON.stringify(r.rate_card),
            r.is_active,
          ],
        );
        if (rowCount > 0) {
          updated++;
        } else {
          await client.query(
            `INSERT INTO ${t(brand, "delivery_zones")}
               (name, geometry_type, geometry, fee_ngn, country_code, priority,
                is_active, rate_card, courier_key, created_by)
             VALUES ($1,'country','{}'::jsonb,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
            [
              r.name,
              r.fee_ngn,
              r.country_code,
              r.courier_key === "dhl_express"
                ? 10
                : r.courier_key === "nationwide"
                  ? 20
                  : 30,
              r.is_active,
              JSON.stringify(r.rate_card),
              r.courier_key,
              user_id || null,
            ],
          );
          created++;
        }
      } catch (err) {
        errors.push({ name: r.name, error: err.message });
      }
    }
  });

  return { created, updated, errors, total: allRows.length };
}

module.exports = { buildTemplate, importFromBuffer };
