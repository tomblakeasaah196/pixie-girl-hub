/**
 * Catalogue import/export engine (PR-B).
 *
 * Styled products use a rich multi-sheet .xlsx (Styled Products + Colours +
 * a read-only Reference sheet with dropdowns) so operators only ever reference
 * EXISTING bases / collections / bundles / lace — never invent a base name the
 * backend would reject. Collections and bundles use a simple single sheet and
 * are created independently (members/components are managed in-app afterwards).
 *
 * Composition over duplication: this layer parses sheets and delegates writes
 * to the existing services (styled, colours, variant generation, collection
 * members, bundle components), so imported rows behave exactly like UI input.
 */

"use strict";

const { query } = require("../../config/database");
const { VALID } = require("../../config/brands");
const {
  buildWorkbook,
  parseWorkbook,
} = require("../../services/spreadsheet.service");
const styledService = require("./styled.service");
const styledRepo = require("./styled.repo");
const variantsService = require("./styled_variants.service");
const variantsRepo = require("./styled_variants.repo");
const catalogueService = require("./catalogue.service");
const catalogueRepo = require("./catalogue.repo");
const bundleService = require("../retention/bundle.service");
const bundleRepo = require("../retention/bundle.repo");

const t = (b, tbl) => {
  if (!VALID.has(b)) throw new Error(`Invalid brand: ${b}`);
  return `${b}.${tbl}`;
};

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const str = (v) => (isBlank(v) ? undefined : String(v).trim());
const num = (v) => (isBlank(v) ? undefined : Number(v));
const bool = (v) =>
  isBlank(v) ? undefined : /^(y|yes|true|1)$/i.test(String(v).trim());
const csv = (v) =>
  isBlank(v)
    ? undefined
    : String(v)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
const yn = (b) => (b ? "yes" : "no");
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// ════════════════════════════════════════════════════════════
// Reference data (names operators may safely cite)
// ════════════════════════════════════════════════════════════
async function referenceLists(brand) {
  const [bases, collections, bundles, sizes, lace] = await Promise.all([
    query(
      `SELECT name FROM ${t(brand, "products")} WHERE is_deleted = false ORDER BY name`,
    ),
    query(
      `SELECT name FROM ${t(brand, "product_collections")} WHERE is_active = true ORDER BY name`,
    ),
    query(
      `SELECT display_name FROM ${t(brand, "bundle_offers")} WHERE is_active = true ORDER BY display_name`,
    ),
    variantsRepo.listSizeTiers({ brand, activeOnly: true }),
    variantsRepo.listLaceSizes({ brand, activeOnly: true }),
  ]);
  return {
    bases: bases.rows.map((r) => r.name),
    collections: collections.rows.map((r) => r.name),
    bundles: bundles.rows.map((r) => r.display_name),
    sizes: sizes.map((s) => s.size_code),
    lace: lace.map((l) => l.lace_code),
  };
}

const lc = (s) => String(s ?? "").trim().toLowerCase();
function nameIndex(rows, key) {
  const map = new Map();
  for (const r of rows) map.set(lc(r[key]), r);
  return map;
}

// ════════════════════════════════════════════════════════════
// Styled products (multi-sheet)
// ════════════════════════════════════════════════════════════
const STYLED_SHEET = "Styled Products";
const COLOUR_SHEET = "Colours";

const STYLED_COLUMNS = [
  { header: "Base product*", key: "base", width: 28, ref: "Existing base products" },
  { header: "Name*", key: "name", width: 28 },
  { header: "Slug", key: "slug", width: 22 },
  { header: "Short description", key: "short_description", width: 32 },
  { header: "Long description", key: "long_description", width: 40 },
  { header: "Retail price (NGN)", key: "retail_price_ngn", width: 16 },
  { header: "Compare-at price", key: "compare_at_price_ngn", width: 16 },
  { header: "Lace codes (comma)", key: "lace_size_codes", width: 18 },
  { header: "Collections (comma)", key: "collections", width: 24 },
  { header: "Bundles (comma)", key: "bundles", width: 24 },
  { header: "Meta title", key: "meta_title", width: 22 },
  { header: "Meta description", key: "meta_description", width: 30 },
  { header: "Status", key: "status", width: 12, list: ["draft", "live"] },
];

const COLOUR_COLUMNS = [
  { header: "Styled name*", key: "styled", width: 28 },
  { header: "Colour name*", key: "name", width: 22 },
  { header: "Hex", key: "hex", width: 12 },
  { header: "Premium (NGN)", key: "premium_ngn", width: 14 },
  { header: "Video URL", key: "external_video_url", width: 28 },
  { header: "Image URLs (comma)", key: "images", width: 40 },
  { header: "Default?", key: "is_default", width: 10, list: ["yes", "no"] },
];

function templateCols(cols, refLetters) {
  return cols.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    list: c.list,
    refColumn: c.ref && refLetters?.includes(c.ref) ? c.ref : undefined,
  }));
}

async function styledTemplate({ brand }) {
  const ref = await referenceLists(brand);
  const reference = [
    { title: "Existing base products", values: ref.bases },
    { title: "Existing collections", values: ref.collections },
    { title: "Existing bundles", values: ref.bundles },
    { title: "Size codes", values: ref.sizes },
    { title: "Lace codes", values: ref.lace },
  ];
  const refTitles = reference.map((r) => r.title);
  return buildWorkbook({
    sheets: [
      {
        name: STYLED_SHEET,
        columns: templateCols(STYLED_COLUMNS, refTitles),
        rows: [
          {
            base: ref.bases[0] ?? "",
            name: "Full Frontal Curly Pixie",
            retail_price_ngn: 180000,
            lace_size_codes: ref.lace.slice(0, 2).join(", "),
            collections: ref.collections[0] ?? "",
            status: "draft",
          },
        ],
      },
      {
        name: COLOUR_SHEET,
        columns: templateCols(COLOUR_COLUMNS),
        rows: [
          {
            styled: "Full Frontal Curly Pixie",
            name: "Natural Black",
            hex: "#1B1B1B",
            is_default: "yes",
          },
        ],
      },
    ],
    reference,
  });
}

async function exportStyled({ brand }) {
  const { data } = await styledRepo.list({ brand, page_size: 1000 });
  const rows = data.map((s) => ({
    base: s.base_name,
    name: s.name,
    slug: s.slug,
    short_description: s.short_description,
    long_description: s.long_description,
    retail_price_ngn: s.retail_price_ngn,
    compare_at_price_ngn: s.compare_at_price_ngn,
    lace_size_codes: Array.isArray(s.lace_size_codes)
      ? s.lace_size_codes.join(", ")
      : "",
    status: s.status,
  }));
  return buildWorkbook({
    sheets: [{ name: STYLED_SHEET, columns: templateCols(STYLED_COLUMNS), rows }],
  });
}

async function findStyledBySlug(brand, slug) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "styled_products")}
      WHERE slug = $1 AND is_deleted = false LIMIT 1`,
    [slug],
  );
  return rows[0] || null;
}

async function importStyled({ brand, user, request_id, buffer }) {
  const sheets = await parseWorkbook(buffer);
  const styledRows = sheets[STYLED_SHEET] ?? [];
  const colourRows = sheets[COLOUR_SHEET] ?? [];

  const baseRes = await query(
    `SELECT product_id, name FROM ${t(brand, "products")} WHERE is_deleted = false`,
  );
  const baseByName = nameIndex(baseRes.rows, "name");
  const colRes = await query(
    `SELECT collection_id, name FROM ${t(brand, "product_collections")} WHERE is_active = true`,
  );
  const collectionByName = nameIndex(colRes.rows, "name");
  const bundleRes = await query(
    `SELECT bundle_id, display_name FROM ${t(brand, "bundle_offers")} WHERE is_active = true`,
  );
  const bundleByName = nameIndex(bundleRes.rows, "display_name");

  const results = [];
  const styledByName = new Map(); // name(lc) → { styled_id, base_product_id, hasLace }
  let created = 0;
  let updated = 0;

  // ── Pass 1: styled products ──
  for (let i = 0; i < styledRows.length; i++) {
    const raw = styledRows[i];
    const line = i + 2;
    const name = str(raw["Name*"]);
    const baseName = str(raw["Base product*"]);
    if (!name || !baseName) {
      results.push({ sheet: STYLED_SHEET, row: line, status: "skipped", reason: "name + base required" });
      continue;
    }
    const base = baseByName.get(lc(baseName));
    if (!base) {
      results.push({ sheet: STYLED_SHEET, row: line, status: "error", reason: `base "${baseName}" not found` });
      continue;
    }
    const laceCodes = csv(raw["Lace codes (comma)"]);
    const input = {
      base_product_id: base.product_id,
      name,
      slug: str(raw["Slug"]) || slugify(name),
      short_description: str(raw["Short description"]) ?? null,
      long_description: str(raw["Long description"]) ?? null,
      retail_price_ngn: num(raw["Retail price (NGN)"]) ?? null,
      compare_at_price_ngn: num(raw["Compare-at price"]) ?? null,
      lace_size_codes: laceCodes ?? null,
      meta_title: str(raw["Meta title"]) ?? null,
      meta_description: str(raw["Meta description"]) ?? null,
    };
    try {
      const existing = await findStyledBySlug(brand, input.slug);
      let styled;
      if (existing) {
        styled = await styledRepo.update({
          brand,
          id: existing.styled_id,
          patch: input,
        });
        updated++;
        results.push({ sheet: STYLED_SHEET, row: line, status: "updated", name });
      } else {
        styled = await styledService.create({ brand, user, request_id, input });
        created++;
        results.push({ sheet: STYLED_SHEET, row: line, status: "created", name });
      }
      styledByName.set(lc(name), {
        styled_id: styled.styled_id,
        base_product_id: base.product_id,
        hasLace: !!(laceCodes && laceCodes.length),
      });

      // Join collections (membership is keyed on the base product).
      for (const cName of csv(raw["Collections (comma)"]) ?? []) {
        const col = collectionByName.get(lc(cName));
        if (!col) {
          results.push({ sheet: STYLED_SHEET, row: line, status: "warn", reason: `collection "${cName}" not found` });
          continue;
        }
        await catalogueService
          .addCollectionMember({
            brand,
            user,
            request_id,
            id: col.collection_id,
            input: { product_id: base.product_id },
          })
          .catch(() => {});
      }
      // Join bundles (the styled's base becomes a bundle component).
      for (const bName of csv(raw["Bundles (comma)"]) ?? []) {
        const bdl = bundleByName.get(lc(bName));
        if (!bdl) {
          results.push({ sheet: STYLED_SHEET, row: line, status: "warn", reason: `bundle "${bName}" not found` });
          continue;
        }
        await bundleService
          .addComponent({
            brand,
            id: bdl.bundle_id,
            component: { product_id: base.product_id, quantity: 1, role: "core" },
          })
          .catch(() => {});
      }
    } catch (err) {
      results.push({ sheet: STYLED_SHEET, row: line, status: "error", reason: err.userMessage || err.message });
    }
  }

  // ── Pass 2: colours (+ image URLs) ──
  for (let i = 0; i < colourRows.length; i++) {
    const raw = colourRows[i];
    const line = i + 2;
    const styledName = str(raw["Styled name*"]);
    const colourName = str(raw["Colour name*"]);
    if (!styledName || !colourName) continue;
    const target = styledByName.get(lc(styledName));
    if (!target) {
      results.push({ sheet: COLOUR_SHEET, row: line, status: "warn", reason: `styled "${styledName}" not in import` });
      continue;
    }
    try {
      const colour = await variantsService.createColour({
        brand,
        user,
        request_id,
        styled_id: target.styled_id,
        input: {
          name: colourName,
          hex: str(raw["Hex"]) ?? null,
          premium_ngn: num(raw["Premium (NGN)"]) ?? 0,
          external_video_url: str(raw["Video URL"]) ?? null,
          is_default: bool(raw["Default?"]) ?? false,
        },
      });
      for (const url of csv(raw["Image URLs (comma)"]) ?? []) {
        await catalogueRepo
          .addImage({
            brand,
            image: {
              product_id: target.base_product_id,
              styled_id: target.styled_id,
              styled_colour_id: colour.colour_id,
              file_path: url,
              cdn_url: url,
              is_primary: false,
              uploaded_by: user.user_id,
            },
          })
          .catch(() => {});
      }
    } catch (err) {
      results.push({ sheet: COLOUR_SHEET, row: line, status: "error", reason: err.userMessage || err.message });
    }
  }

  // ── Pass 3: auto-generate the variant matrix for each new styled ──
  for (const target of styledByName.values()) {
    await variantsService
      .bulkCreateVariants({
        brand,
        user,
        request_id,
        styled_id: target.styled_id,
        input: { all_sizes: true, all_lace: target.hasLace },
      })
      .catch(() => {});
  }

  return { created, updated, styled_total: styledRows.length, colour_total: colourRows.length, results };
}

// ════════════════════════════════════════════════════════════
// Collections (single sheet, created independently)
// ════════════════════════════════════════════════════════════
const COLLECTION_SHEET = "Collections";
const COLLECTION_COLUMNS = [
  { header: "Name*", key: "name", width: 28 },
  { header: "Slug", key: "slug", width: 22 },
  { header: "Description", key: "description", width: 40 },
  { header: "Mode", key: "mode", width: 12, list: ["manual", "rule"] },
  { header: "Visible on website?", key: "is_visible_storefront", width: 18, list: ["yes", "no"] },
  { header: "Cover image URL", key: "hero_image_url", width: 30 },
];

async function collectionsTemplate() {
  return buildWorkbook({
    sheets: [
      {
        name: COLLECTION_SHEET,
        columns: templateCols(COLLECTION_COLUMNS),
        rows: [{ name: "Summer Edit", mode: "manual", is_visible_storefront: "yes" }],
      },
    ],
  });
}

async function exportCollections({ brand }) {
  const cols = await catalogueRepo.listCollections({ brand });
  const rows = cols.map((c) => ({
    name: c.name,
    slug: c.slug,
    description: c.description,
    mode: c.mode,
    is_visible_storefront: yn(c.is_visible_storefront),
    hero_image_url: c.hero_image_url,
  }));
  return buildWorkbook({
    sheets: [{ name: COLLECTION_SHEET, columns: templateCols(COLLECTION_COLUMNS), rows }],
  });
}

async function importCollections({ brand, user, request_id, buffer }) {
  const sheets = await parseWorkbook(buffer);
  const rows = sheets[COLLECTION_SHEET] ?? Object.values(sheets)[0] ?? [];
  const results = [];
  let created = 0;
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const line = i + 2;
    const name = str(raw["Name*"]);
    if (!name) {
      results.push({ row: line, status: "skipped", reason: "missing name" });
      continue;
    }
    try {
      await catalogueService.createCollection({
        brand,
        user,
        request_id,
        input: {
          name,
          slug: str(raw["Slug"]) || slugify(name),
          description: str(raw["Description"]) ?? null,
          mode: str(raw["Mode"]) || "manual",
          is_visible_storefront: bool(raw["Visible on website?"]) ?? false,
          hero_image_url: str(raw["Cover image URL"]) ?? null,
        },
      });
      created++;
      results.push({ row: line, status: "created", name });
    } catch (err) {
      results.push({ row: line, status: "error", name, reason: err.userMessage || err.message });
    }
  }
  return { created, total: rows.length, results };
}

// ════════════════════════════════════════════════════════════
// Bundles (single sheet, header-only — components added in-app)
// ════════════════════════════════════════════════════════════
const BUNDLE_SHEET = "Bundles";
const BUNDLE_COLUMNS = [
  { header: "Bundle code", key: "bundle_code", width: 20 },
  { header: "Display name*", key: "display_name", width: 28 },
  { header: "Description", key: "description", width: 40 },
  { header: "Pricing model", key: "pricing_model", width: 18, list: ["fixed_bundle_price", "pct_off", "amount_off"] },
  { header: "Bundle price (NGN)", key: "bundle_price_ngn", width: 16 },
  { header: "Discount value", key: "discount_value", width: 14 },
  { header: "Visible on website?", key: "is_visible_storefront", width: 18, list: ["yes", "no"] },
  { header: "Cover image URL", key: "hero_image_url", width: 30 },
];

async function bundlesTemplate() {
  return buildWorkbook({
    sheets: [
      {
        name: BUNDLE_SHEET,
        columns: templateCols(BUNDLE_COLUMNS),
        rows: [{ display_name: "Wig Care Kit", pricing_model: "fixed_bundle_price", bundle_price_ngn: 35000, is_visible_storefront: "yes" }],
      },
    ],
  });
}

async function exportBundles({ brand }) {
  const { rows: bundles } = await query(
    `SELECT bundle_code, display_name, description, pricing_model,
            bundle_price_ngn, discount_value, is_visible_storefront, hero_image_url
       FROM ${t(brand, "bundle_offers")} ORDER BY display_order, display_name`,
  );
  const rows = bundles.map((b) => ({
    ...b,
    is_visible_storefront: yn(b.is_visible_storefront),
  }));
  return buildWorkbook({
    sheets: [{ name: BUNDLE_SHEET, columns: templateCols(BUNDLE_COLUMNS), rows }],
  });
}

async function importBundles({ brand, user, buffer }) {
  const sheets = await parseWorkbook(buffer);
  const rows = sheets[BUNDLE_SHEET] ?? Object.values(sheets)[0] ?? [];
  const results = [];
  let created = 0;
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const line = i + 2;
    const display_name = str(raw["Display name*"]);
    if (!display_name) {
      results.push({ row: line, status: "skipped", reason: "missing display name" });
      continue;
    }
    try {
      // Header-only create (components are added in-app), so go straight to the
      // repo — the bundle service requires ≥1 component.
      await bundleRepo.createBundle({
        brand,
        user_id: user.user_id,
        input: {
          bundle_code:
            str(raw["Bundle code"]) ||
            `BDL-${slugify(display_name).toUpperCase().replace(/-/g, "").slice(0, 16)}`,
          display_name,
          description: str(raw["Description"]) ?? null,
          pricing_model: str(raw["Pricing model"]) || "fixed_bundle_price",
          bundle_price_ngn: num(raw["Bundle price (NGN)"]) ?? null,
          discount_value: num(raw["Discount value"]) ?? null,
          is_visible_storefront: bool(raw["Visible on website?"]) ?? false,
          hero_image_url: str(raw["Cover image URL"]) ?? null,
        },
      });
      created++;
      results.push({ row: line, status: "created", name: display_name });
    } catch (err) {
      results.push({ row: line, status: "error", name: display_name, reason: err.userMessage || err.message });
    }
  }
  return { created, total: rows.length, results };
}

module.exports = {
  styledTemplate,
  exportStyled,
  importStyled,
  collectionsTemplate,
  exportCollections,
  importCollections,
  bundlesTemplate,
  exportBundles,
  importBundles,
};
