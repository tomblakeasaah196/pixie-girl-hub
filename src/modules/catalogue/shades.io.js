/**
 * Product Shades — import/export engine (single sheet), mirroring the
 * Collections importer. Operators bulk-load many shades with all their copy
 * (short + long description, cover, SEO) in one .xlsx; export emits the same
 * shape so a download re-imports 1:1. Styled-product membership is managed
 * in-app afterwards (the Flow-2 bulk-assign drawer).
 *
 * Composition over duplication: parsing delegates writes to shades.service so
 * imported rows behave exactly like UI input (slug de-collision, audit, events).
 */

"use strict";

const {
  buildWorkbook,
  parseWorkbook,
} = require("../../services/spreadsheet.service");
const shadesService = require("./shades.service");
const shadesRepo = require("./shades.repo");

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const str = (v) => (isBlank(v) ? undefined : String(v).trim());
const num = (v) => (isBlank(v) ? undefined : Number(v));
const bool = (v) =>
  isBlank(v) ? undefined : /^(y|yes|true|1)$/i.test(String(v).trim());
const yn = (b) => (b ? "yes" : "no");

const SHADE_SHEET = "Shades";
const SHADE_COLUMNS = [
  { header: "Name*", key: "name", width: 24 },
  { header: "Slug", key: "slug", width: 22 },
  { header: "Short Description", key: "short_description", width: 36 },
  { header: "Long Description", key: "long_description", width: 50 },
  { header: "Cover image URL", key: "cover_image_url", width: 30 },
  { header: "Display order", key: "display_order", width: 14 },
  { header: "Active", key: "is_active", width: 10, list: ["yes", "no"] },
  { header: "Meta title", key: "meta_title", width: 28 },
  { header: "Meta description", key: "meta_description", width: 40 },
];

function templateCols(cols) {
  return cols.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    list: c.list,
  }));
}

async function shadesTemplate() {
  return buildWorkbook({
    sheets: [
      {
        name: SHADE_SHEET,
        columns: templateCols(SHADE_COLUMNS),
        rows: [
          {
            name: "Icy Grey",
            short_description: "A cool ashen grey.",
            long_description:
              "A cool, ashen grey hand-mixed in the studio and colour-matched to your skin. Blend it by melting the roots a half-shade darker for a lived-in finish.",
            is_active: "yes",
            meta_title: "Icy Grey Wigs — Shop by Shade",
          },
        ],
      },
    ],
  });
}

async function exportShades({ brand }) {
  const shades = await shadesRepo.list({ brand });
  const rows = shades.map((s) => ({
    name: s.name,
    slug: s.slug,
    short_description: s.short_description,
    long_description: s.long_description,
    cover_image_url: s.cover_image_url,
    display_order: s.display_order,
    is_active: yn(s.is_active),
    meta_title: s.meta_title,
    meta_description: s.meta_description,
  }));
  return buildWorkbook({
    sheets: [{ name: SHADE_SHEET, columns: templateCols(SHADE_COLUMNS), rows }],
  });
}

async function importShades({ brand, user, request_id, buffer }) {
  const sheets = await parseWorkbook(buffer);
  const rows = sheets[SHADE_SHEET] ?? Object.values(sheets)[0] ?? [];
  const results = [];
  let created = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const line = i + 2;
    const name = str(raw["Name*"]);
    if (!name) {
      results.push({ row: line, status: "skipped", reason: "missing name" });
      continue;
    }
    const input = {
      name,
      slug: str(raw["Slug"]),
      short_description: str(raw["Short Description"]) ?? null,
      long_description: str(raw["Long Description"]) ?? null,
      cover_image_url: str(raw["Cover image URL"]) ?? null,
      display_order: num(raw["Display order"]),
      is_active: bool(raw["Active"]) ?? true,
      meta_title: str(raw["Meta title"]) ?? null,
      meta_description: str(raw["Meta description"]) ?? null,
    };
    try {
      // Update-in-place when a shade with the same slug already exists, so a
      // re-import edits rather than duplicates (the round-trip operators rely on).
      const slug = input.slug || shadesService.slugify(name);
      const existing = await shadesRepo.getBySlug({ brand, slug });
      if (existing) {
        await shadesService.update({
          brand,
          user,
          request_id,
          id: existing.shade_id,
          patch: input,
        });
        updated++;
        results.push({ row: line, status: "updated", name });
      } else {
        await shadesService.create({ brand, user, request_id, input });
        created++;
        results.push({ row: line, status: "created", name });
      }
    } catch (err) {
      results.push({
        row: line,
        status: "error",
        name,
        reason: err.userMessage || err.message,
      });
    }
  }
  return { created, updated, total: rows.length, results };
}

module.exports = {
  shadesTemplate,
  exportShades,
  importShades,
  SHADE_SHEET,
  SHADE_COLUMNS,
  templateCols,
};
