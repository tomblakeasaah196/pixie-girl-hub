/**
 * Product Shades — import/export engine, mirroring the Collections importer but
 * with styled-product membership baked in. Operators bulk-load many shades with
 * all their copy (short + long description, cover, SEO) AND the styled products
 * that belong to each shade, all in one .xlsx; export emits the same shape so a
 * download re-imports 1:1.
 *
 * The template is two sheets:
 *   • "Reference" (read-only, first tab) — every styled product in the system
 *     plus the small validation lists, so operators only ever cite names the
 *     backend recognises.
 *   • "Shades" — the actual template, including a comma-separated "Products"
 *     column. The styled products in a shade are what lets the storefront
 *     "shop by shade".
 *
 * Composition over duplication: parsing delegates writes to shades.service so
 * imported rows behave exactly like UI input (slug de-collision, audit, events),
 * and membership goes through the same bulk-assign the Shades tab uses.
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
const lc = (s) => String(s ?? "").trim().toLowerCase();
// Split a comma-separated cell into trimmed, non-empty tokens.
const csv = (v) =>
  isBlank(v)
    ? []
    : String(v)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

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
  {
    header: "Products (comma)",
    key: "products",
    width: 48,
    note:
      "Styled products in this shade — comma-separated names (or codes). " +
      "Pick from the 'Styled products' column on the Reference sheet. Listed " +
      "products are added to the shade; products already in it are kept.",
  },
];

// Reference sheet (first tab): everything the operator may safely cite, plus the
// validation value lists used by the Shades sheet.
async function referenceBlocks(brand) {
  const styled = await shadesRepo.listStyledLookup({ brand });
  return [
    { title: "Styled products", values: styled.map((s) => s.name) },
    { title: "Active (yes/no)", values: ["yes", "no"] },
  ];
}

function templateCols(cols) {
  return cols.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    list: c.list,
    note: c.note,
  }));
}

async function shadesTemplate({ brand }) {
  const reference = await referenceBlocks(brand);
  const productSample = reference[0].values.slice(0, 3).join(", ");
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
            // Pre-fill the membership cell with real product names so the
            // comma format is obvious (blank when the brand has no styled yet).
            products: productSample || undefined,
          },
        ],
      },
    ],
    reference,
  });
}

async function exportShades({ brand }) {
  const [shades, namesByShade] = await Promise.all([
    shadesRepo.list({ brand }),
    shadesRepo.styledNamesByShade({ brand }),
  ]);
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
    products: (namesByShade.get(s.shade_id) ?? []).join(", "),
  }));
  return buildWorkbook({
    sheets: [{ name: SHADE_SHEET, columns: templateCols(SHADE_COLUMNS), rows }],
    reference: await referenceBlocks(brand),
  });
}

async function importShades({ brand, user, request_id, buffer }) {
  const sheets = await parseWorkbook(buffer);
  const rows = sheets[SHADE_SHEET] ?? Object.values(sheets)[0] ?? [];

  // Resolve styled product names/codes → ids once (the Products column),
  // indexed by both so an operator can cite either.
  const styled = await shadesRepo.listStyledLookup({ brand });
  const styledByKey = new Map();
  for (const sp of styled) {
    styledByKey.set(lc(sp.name), sp.styled_id);
    if (sp.styled_code) styledByKey.set(lc(sp.styled_code), sp.styled_id);
  }

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
      let shadeId;
      if (existing) {
        await shadesService.update({
          brand,
          user,
          request_id,
          id: existing.shade_id,
          patch: input,
        });
        shadeId = existing.shade_id;
        updated++;
        results.push({ row: line, status: "updated", name });
      } else {
        const shade = await shadesService.create({
          brand,
          user,
          request_id,
          input,
        });
        shadeId = shade.shade_id;
        created++;
        results.push({ row: line, status: "created", name });
      }

      // Assign the styled products listed in the Products column. Additive +
      // re-homing (the same bulk-assign the Shades tab uses); products already
      // in the shade are kept, never silently removed.
      const tokens = csv(raw["Products (comma)"]);
      if (tokens.length) {
        const ids = [];
        for (const tok of tokens) {
          const id = styledByKey.get(lc(tok));
          if (id) ids.push(id);
          else
            results.push({
              row: line,
              status: "warn",
              name,
              reason: `product "${tok}" not found`,
            });
        }
        if (ids.length) {
          await shadesService.assignMembers({
            brand,
            user,
            request_id,
            id: shadeId,
            styled_ids: ids,
          });
          results.push({
            row: line,
            status: "info",
            name,
            reason: `${ids.length} product${ids.length === 1 ? "" : "s"} assigned`,
          });
        }
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
